// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IVerifiableFactory} from "@ensdomains/verifiable-factory/IVerifiableFactory.sol";
import {Grant, IEACGrantInitializable} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

/// @title LanyardRegistrar
/// @notice Owns the emancipated edition registry (`mumbai2026.lanyard.eth`) and is its only
///         registry-wide REGISTRAR and RENEW holder. The organizer drives it; it cannot be upgraded and
///         keeps no bootstrap authority after `seal()`.
/// @dev Setup order, one transaction each, all organizer-only:
///      1. `bootstrapEdition()` deploys the edition registry and reserves the protected labels.
///      2. The organizer registers the edition label in the base registry to this contract, with
///         `editionNameRoles()` and the edition registry as its subregistry (done by the deploy script).
///      3. `seal()` verifies step 2, sets the parent pointer, revokes every temporary role and checks
///         the final role set.
///      4. `setPublicationResolver()` (A2) sets the edition's resolver and gives up the roles to change it.
contract LanyardRegistrar {
    ////////////////////////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////////////////////////

    enum Phase {
        Created,
        Bootstrapped,
        Sealed
    }

    ////////////////////////////////////////////////////////////////////////
    // Errors and events
    ////////////////////////////////////////////////////////////////////////

    error NotOrganizer(address caller);
    error WrongPhase(Phase current);
    error ZeroAddress();
    error EmptyEditionLabel();
    error InvalidTimes();
    error EditionNotAttached(string reason);
    error UnexpectedRootRoles(uint256 roleCount);
    error NotEmancipated();
    error PublicationResolverAlreadySet();
    error ResolverHasNoCode(address resolver);
    error UnexpectedToken();

    event EditionBootstrapped(address indexed edition, string label);
    event EditionSealed(address indexed edition);
    event PublicationResolverSet(address indexed resolver);

    ////////////////////////////////////////////////////////////////////////
    // Constants
    ////////////////////////////////////////////////////////////////////////

    /// @dev Same grace as `NAMESPACE_GRACE_SECONDS` in `src/shared/config/validate.ts`.
    uint64 public constant NAMESPACE_GRACE = 30 days;
    uint64 internal constant FAR_FUTURE = type(uint64).max;

    /// @dev Roles this contract holds on the edition registry root while bootstrapping. Everything
    ///      except REGISTRAR and RENEW is revoked by `seal()`.
    uint256 internal constant BOOTSTRAP_ROOT_ROLES =
        R.ROLE_REGISTRAR | R.ROLE_RENEW | R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN;
    /// @dev Roles that must remain on the edition registry root after sealing, held by this contract only.
    uint256 internal constant FINAL_ROOT_ROLES = R.ROLE_REGISTRAR | R.ROLE_RENEW;
    /// @dev Name-level roles this contract must hold on the edition label in the base registry.
    ///      Deliberately no set-subregistry, unregister or transfer.
    uint256 internal constant EDITION_NAME_ROLES =
        R.ROLE_RENEW | R.ROLE_SET_RESOLVER | R.ROLE_SET_RESOLVER_ADMIN;

    ////////////////////////////////////////////////////////////////////////
    // Immutables and storage
    ////////////////////////////////////////////////////////////////////////

    address public immutable organizer;
    IVerifiableFactory public immutable factory;
    address public immutable userRegistryImplementation;
    IPermissionedRegistry public immutable baseRegistry;
    uint64 public immutable eventEnd;
    uint64 public immutable freezeDeadline;
    /// @notice `max(eventEnd, freezeDeadline) + 30 days`, the same formula as `namespaceExpiry` in
    ///         `src/shared/config/validate.ts`.
    uint64 public immutable namespaceExpiry;

    /// @notice The edition label in the base registry (strings cannot be immutable).
    string public editionLabel;
    Phase public phase;
    IPermissionedRegistry public edition;
    address public publicationResolver;

    ////////////////////////////////////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////////////////////////////////////

    constructor(
        address organizer_,
        IVerifiableFactory factory_,
        address userRegistryImplementation_,
        IPermissionedRegistry baseRegistry_,
        string memory editionLabel_,
        uint64 eventEnd_,
        uint64 freezeDeadline_
    ) {
        if (
            organizer_ == address(0) || address(factory_) == address(0)
                || userRegistryImplementation_ == address(0) || address(baseRegistry_) == address(0)
        ) revert ZeroAddress();
        if (bytes(editionLabel_).length == 0) revert EmptyEditionLabel();
        if (eventEnd_ == 0 || freezeDeadline_ == 0) revert InvalidTimes();
        organizer = organizer_;
        factory = factory_;
        userRegistryImplementation = userRegistryImplementation_;
        baseRegistry = baseRegistry_;
        editionLabel = editionLabel_;
        eventEnd = eventEnd_;
        freezeDeadline = freezeDeadline_;
        namespaceExpiry = (eventEnd_ > freezeDeadline_ ? eventEnd_ : freezeDeadline_) + NAMESPACE_GRACE;
    }

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer(msg.sender);
        _;
    }

    modifier inPhase(Phase expected) {
        if (phase != expected) revert WrongPhase(phase);
        _;
    }

    ////////////////////////////////////////////////////////////////////////
    // Setup
    ////////////////////////////////////////////////////////////////////////

    /// @notice One-shot. Deploys the edition registry and reserves the protected labels.
    function bootstrapEdition() external onlyOrganizer inPhase(Phase.Created) {
        phase = Phase.Bootstrapped;

        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: address(this), roleBitmap: BOOTSTRAP_ROOT_ROLES});
        address proxy = factory.deployProxy(
            userRegistryImplementation,
            uint256(keccak256(abi.encode("lanyard.edition", editionLabel))),
            abi.encodeCall(IEACGrantInitializable.initialize, (grants))
        );
        edition = IPermissionedRegistry(proxy);

        string[5] memory protectedLabels = ["admin", "staff", "lanyard", "ethglobal", "winner"];
        for (uint256 i; i < protectedLabels.length; ++i) {
            // Owner 0 and no roles: reserved. Nobody holds ROLE_REGISTER_RESERVED, so these stay unregistrable.
            edition.register(protectedLabels[i], address(0), IRegistry(address(0)), address(0), 0, FAR_FUTURE);
        }
        emit EditionBootstrapped(proxy, editionLabel);
    }

    /// @notice One-shot. Requires the edition label to be registered in the base registry to this
    ///         contract (see the contract note), then locks the edition registry down.
    function seal() external onlyOrganizer inPhase(Phase.Bootstrapped) {
        phase = Phase.Sealed;
        IPermissionedRegistry edition_ = edition;
        IPermissionedRegistry base = baseRegistry;
        string memory label = editionLabel;
        uint256 labelId = uint256(keccak256(bytes(label)));

        if (address(base.getSubregistry(label)) != address(edition_)) {
            revert EditionNotAttached("subregistry is not the edition registry");
        }
        if (base.getOwner(labelId) != address(this)) {
            revert EditionNotAttached("name is not owned by the registrar");
        }
        if (base.getExpiry(labelId) < namespaceExpiry) {
            revert EditionNotAttached("name expires before namespaceExpiry");
        }
        if (base.roles(labelId, address(this)) != EDITION_NAME_ROLES) {
            revert EditionNotAttached("name roles are not the expected set");
        }

        edition_.setParent(IRegistry(address(base)), label);
        edition_.revokeRootRoles(R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN, address(this));

        // Exactly one holder each of REGISTRAR and RENEW (this contract) and nothing else, which also
        // rules out ROLE_UPGRADE and every admin role.
        uint256 counts = edition_.roleCount(0);
        if (counts != FINAL_ROOT_ROLES || !edition_.hasRootRoles(FINAL_ROOT_ROLES, address(this))) {
            revert UnexpectedRootRoles(counts);
        }
        if (!edition_.isEmancipated()) revert NotEmancipated();
        emit EditionSealed(address(edition_));
    }

    /// @notice One-shot. Sets the edition's resolver and gives up this contract's own roles to change it.
    function setPublicationResolver(address resolver) external onlyOrganizer inPhase(Phase.Sealed) {
        if (publicationResolver != address(0)) revert PublicationResolverAlreadySet();
        if (resolver == address(0)) revert ZeroAddress();
        if (resolver.code.length == 0) revert ResolverHasNoCode(resolver);
        publicationResolver = resolver;

        uint256 labelId = uint256(keccak256(bytes(editionLabel)));
        baseRegistry.setResolver(labelId, resolver);
        baseRegistry.revokeRoles(labelId, R.ROLE_SET_RESOLVER | R.ROLE_SET_RESOLVER_ADMIN, address(this));
        emit PublicationResolverSet(resolver);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    /// @notice The name-level roles the base registry registration must grant this contract.
    function editionNameRoles() external pure returns (uint256) {
        return EDITION_NAME_ROLES;
    }

    ////////////////////////////////////////////////////////////////////////
    // ERC-1155 receiver
    ////////////////////////////////////////////////////////////////////////

    /// @dev The base registry mints (and re-mints, whenever roles change) the edition name to this
    ///      contract. Accept tokens from that registry only.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(baseRegistry)) revert UnexpectedToken();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert UnexpectedToken();
    }
}
