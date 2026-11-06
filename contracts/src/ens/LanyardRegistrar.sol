// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IVerifiableFactory} from "@ensdomains/verifiable-factory/IVerifiableFactory.sol";
import {Grant, IEACGrantInitializable} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IPermissionedResolver} from "ens-v2/resolver/interfaces/IPermissionedResolver.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {PermissionedResolverLib as P} from "ens-v2/resolver/libraries/PermissionedResolverLib.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {LanyardRegistrySetup} from "./LanyardRegistrySetup.sol";

/// @title LanyardRegistrar
/// @notice Owns the emancipated edition registry (`mumbai2026.lanyard.eth`) and is its only
///         registry-wide REGISTRAR and RENEW holder. The organizer drives it; it cannot be upgraded and
///         keeps no bootstrap authority after `seal()`.
/// @dev Setup order, one transaction each, all organizer-only:
///      0. `configureIssuance()` freezes the fixed resolvers, head judge and base name required by A2.
///      1. `bootstrapEdition()` deploys the edition registry, reserves the protected labels and creates
///         the four badge books (each a separate registry, registered to the organizer).
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
    error UnexpectedBookRoles(bytes32 book, uint256 roleCount);
    error UnknownBook(bytes32 book);
    /// @dev The partners book holds structural parents, created only through onboardPartner.
    error BookNotOpen(bytes32 book);
    error InvalidBadgeLabel();
    error RenewalNotInFuture(uint64 requested, uint64 nowTimestamp);
    error ExpiryAboveNamespace(uint64 requested, uint64 namespaceExpiry);
    error RenewalNotLonger(uint64 requested, uint64 current);
    /// @dev The label was never issued, or was unregistered or is only reserved: nobody to revive.
    error NoBadgeToRevive(string label);
    error UnsupportedResolver(address resolver);
    error InvalidTeamLabel();
    error InvalidTeamLead();
    error TeamAlreadyRegistered(bytes32 labelHash);
    error UnexpectedTeamRoles(uint256 roleCount);
    error WinnerRegistrarAlreadySet();
    error WinnerRegistrarHasNoCode(address winner);
    error NotWinnerRegistrar(address caller);
    error PublicationResolverNotSet();
    error UnknownTeam(bytes32 labelHash);
    error TeamIdentityChanged(bytes32 labelHash);
    error WinnerNotReserved(bytes32 labelHash);
    error WinnerExpiryNotFarFuture(uint64 expiry);
    error IssuanceNotConfigured();
    error IssuanceAlreadyConfigured();
    error InvalidIssuanceConfiguration();
    error MissingAddressAuthority(address resolver);
    error NotHeadJudge(address caller);
    error NotPartner(address caller);
    error PartnerAlreadyConfigured(bytes32 partner);
    error UnknownPartner(bytes32 partner);
    error InvalidPartnerBook(bytes32 sub);
    error PartnerHierarchyChanged(bytes32 partner);
    error UnexpectedBadgeResolver();

    event EditionBootstrapped(address indexed edition, string label);
    event BookCreated(bytes32 indexed book, string label, address registry);
    event BadgeIssued(bytes32 indexed book, string label, address indexed owner, uint64 expiry);
    event EditionSealed(address indexed edition);
    event PublicationResolverSet(address indexed resolver);
    event TeamRegistered(string label, address indexed lead, address registry, uint64 expiry);
    event WinnerRegistrarSet(address indexed winner);
    event IssuanceConfigured(
        address hackersResolver, address staffResolver, address headJudge, string baseName
    );
    event PartnerOnboarded(bytes32 indexed partner, string label, address indexed wallet, address registry);

    ////////////////////////////////////////////////////////////////////////
    // Constants
    ////////////////////////////////////////////////////////////////////////

    /// @dev Same grace as `NAMESPACE_GRACE_SECONDS` in `src/shared/config/validate.ts`.
    uint64 public constant NAMESPACE_GRACE = 30 days;
    uint64 public constant HACKER_GRACE = 7 days;
    uint64 internal constant FAR_FUTURE = type(uint64).max;

    /// @dev Roles this contract holds on the edition registry root while bootstrapping. Everything
    ///      except REGISTRAR and RENEW is revoked by `seal()`.
    uint256 internal constant BOOTSTRAP_ROOT_ROLES =
        R.ROLE_REGISTRAR | R.ROLE_RENEW | R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN;
    bytes32 public constant HACKERS = keccak256("hackers");
    bytes32 public constant JUDGES = keccak256("judges");
    bytes32 public constant VOLUNTEERS = keccak256("volunteers");
    bytes32 public constant PARTNERS = keccak256("partners");
    bytes32 public constant STAFF = keccak256("staff");

    /// @dev What the organizer holds on each book name in the edition: renew it, set its resolver. No
    ///      transfer, no unregister, no set-subregistry.
    uint256 internal constant BOOK_NAME_ROLES = R.ROLE_RENEW | R.ROLE_SET_RESOLVER;

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
    LanyardRegistrySetup public immutable registrySetup;

    /// @notice The edition label in the base registry (strings cannot be immutable).
    string public editionLabel;
    Phase public phase;
    IPermissionedRegistry public edition;
    address public publicationResolver;
    address public winnerRegistrar;
    address public hackersResolver;
    address public staffResolver;
    address public headJudge;
    string public baseName;
    /// @notice Book registries by `keccak256(label)` (HACKERS, JUDGES, VOLUNTEERS, PARTNERS).
    mapping(bytes32 book => IPermissionedRegistry) public bookRegistry;
    mapping(bytes32 labelHash => IPermissionedRegistry) public teamRegistry;
    mapping(bytes32 labelHash => address) public teamLead;
    mapping(bytes32 labelHash => uint256) internal teamResource;
    mapping(bytes32 partner => address) public partnerWallet;
    mapping(bytes32 partner => IPermissionedRegistry) public partnerRegistry;
    mapping(bytes32 partner => uint256) internal partnerResource;
    mapping(bytes32 partner => mapping(bytes32 sub => IPermissionedRegistry)) public partnerBookRegistry;

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
        registrySetup = new LanyardRegistrySetup(factory_, userRegistryImplementation_, organizer_);
        // Records are written under this label's node, so a bad label would be unrepairable.
        registrySetup.validatePartnerLabel(editionLabel_);
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

    function version() external pure returns (string memory) {
        return "lanyard.registrar/2";
    }

    /// @notice Required one-shot A2 policy, frozen before any registry bootstrap or issuance.
    function configureIssuance(address hackers, address staff, address chief, string calldata baseName_)
        external
        onlyOrganizer
        inPhase(Phase.Created)
    {
        if (hackersResolver != address(0)) revert IssuanceAlreadyConfigured();
        if (hackers == address(0) || staff == address(0) || chief == address(0)) revert ZeroAddress();
        if (
            hackers == staff || chief == organizer || chief == address(this)
                || chief == address(registrySetup)
        ) revert InvalidIssuanceConfiguration();
        _checkResolver(hackers);
        _checkResolver(staff);
        _checkAddressAuthority(hackers);
        _checkAddressAuthority(staff);
        registrySetup.validateBaseName(baseName_);
        hackersResolver = hackers;
        staffResolver = staff;
        headJudge = chief;
        baseName = baseName_;
        emit IssuanceConfigured(hackers, staff, chief, baseName_);
    }

    function _checkResolver(address resolver) internal view {
        if (resolver.code.length == 0) revert ResolverHasNoCode(resolver);
        try IERC165(resolver).supportsInterface(type(IPermissionedResolver).interfaceId) returns (bool ok) {
            if (!ok) revert UnsupportedResolver(resolver);
        } catch {
            revert UnsupportedResolver(resolver);
        }
    }

    function _checkAddressAuthority(address resolver) internal view {
        if (!IPermissionedResolver(resolver)
                .hasRoles(P.resource(uint256(60)), P.ROLE_SET_ADDRESS, address(this))) {
            revert MissingAddressAuthority(resolver);
        }
    }

    /// @notice One-shot. Deploys the edition registry and reserves the protected labels.
    function bootstrapEdition() external onlyOrganizer inPhase(Phase.Created) {
        if (hackersResolver == address(0)) revert IssuanceNotConfigured();
        _checkAddressAuthority(hackersResolver);
        _checkAddressAuthority(staffResolver);
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
        string[4] memory books = ["hackers", "judges", "volunteers", "partners"];
        for (uint256 i; i < books.length; ++i) {
            _createBook(books[i]);
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
        // The locked results hang off this name, and nothing here can renew it later (A1.1-R4).
        if (base.getExpiry(labelId) != FAR_FUTURE) {
            revert EditionNotAttached("name expiry is not far-future");
        }
        uint256 held = base.roles(labelId, address(this));
        if (held & R.ROLE_WAS_RESERVED != 0) {
            revert EditionNotAttached("name was reserved before registration");
        }
        if (held != EDITION_NAME_ROLES) revert EditionNotAttached("name roles are not the expected set");
        // Nobody else may hold any role on the name: the assignee counts equal exactly one holder per role.
        if (base.roleCount(labelId) != EDITION_NAME_ROLES) {
            revert EditionNotAttached("name has unexpected role holders");
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
        if (resolver == hackersResolver || resolver == staffResolver) revert InvalidIssuanceConfiguration();
        _checkResolver(resolver);
        publicationResolver = resolver;

        uint256 labelId = uint256(keccak256(bytes(editionLabel)));
        baseRegistry.setResolver(labelId, resolver);
        baseRegistry.revokeRoles(labelId, R.ROLE_SET_RESOLVER | R.ROLE_SET_RESOLVER_ADMIN, address(this));
        emit PublicationResolverSet(resolver);
    }

    /// @dev The fixed setup companion installs each managed registry and removes all its temporary
    ///      permissions. The judges book also installs the head judge's final UNREGISTER role here.
    function _createBook(string memory label) internal {
        bytes32 book = keccak256(bytes(label));
        IPermissionedRegistry edition_ = edition;

        IPermissionedRegistry registry = _newManagedRegistry(
            label,
            IRegistry(address(edition_)),
            book == JUDGES ? headJudge : address(0),
            uint256(keccak256(abi.encode("lanyard.book", editionLabel, label)))
        );
        edition_.register(
            label,
            organizer,
            IRegistry(address(registry)),
            _bookResolver(book),
            BOOK_NAME_ROLES,
            namespaceExpiry
        );
        bookRegistry[book] = registry;
        emit BookCreated(book, label, address(registry));
    }

    function _newManagedRegistry(string memory label, IRegistry parent, address delegate, uint256 salt)
        internal
        returns (IPermissionedRegistry registry)
    {
        return registrySetup.createManaged(label, parent, delegate, salt);
    }

    ////////////////////////////////////////////////////////////////////////
    // Teams
    ////////////////////////////////////////////////////////////////////////

    /// @notice One-shot authority handoff. The configured contract uses fixed forwarding methods only.
    function setWinnerRegistrar(address winner) external onlyOrganizer inPhase(Phase.Sealed) {
        if (winnerRegistrar != address(0)) revert WinnerRegistrarAlreadySet();
        if (winner == address(0)) revert ZeroAddress();
        if (winner.code.length == 0) revert WinnerRegistrarHasNoCode(winner);
        winnerRegistrar = winner;
        emit WinnerRegistrarSet(winner);
    }

    modifier onlyWinnerRegistrar() {
        if (msg.sender != winnerRegistrar || winnerRegistrar == address(0)) {
            revert NotWinnerRegistrar(msg.sender);
        }
        _;
    }

    /// @notice Promotes only this team's reserved winner, with the fixed publication resolver and no
    ///         authorizing name roles. ENSv2 adds its non-authorizing WAS_RESERVED marker automatically.
    function promoteWinner(string calldata team, address lead, uint64 expiry) external onlyWinnerRegistrar {
        if (publicationResolver == address(0)) revert PublicationResolverNotSet();
        bytes32 labelHash = keccak256(bytes(team));
        IPermissionedRegistry child = _registeredTeam(labelHash);
        if (lead != teamLead[labelHash] || lead == address(0)) revert InvalidTeamLead();
        // A lapsed winner could be re-registered by the lead, who holds root REGISTRAR on the team registry.
        if (expiry != FAR_FUTURE) revert WinnerExpiryNotFarFuture(expiry);
        if (child.getStatus(uint256(keccak256("winner"))) != IPermissionedRegistry.Status.RESERVED) {
            revert WinnerNotReserved(labelHash);
        }
        child.register("winner", lead, IRegistry(address(0)), publicationResolver, 0, expiry);
    }

    /// @notice Extends (or revives) the original team parent. Equality is a safe reconciliation no-op.
    function renewWinningTeam(string calldata team, uint64 expiry) external onlyWinnerRegistrar {
        bytes32 labelHash = keccak256(bytes(team));
        _registeredTeam(labelHash);
        if (expiry <= block.timestamp) revert RenewalNotInFuture(expiry, uint64(block.timestamp));
        uint64 current = edition.getExpiry(uint256(labelHash));
        if (expiry < current) revert RenewalNotLonger(expiry, current);
        if (expiry > current) edition.renew(uint256(labelHash), expiry);
    }

    /// @dev latestOwnerOf keeps expired-original renewal possible; the resource binds the registration
    ///      identity despite token regeneration when a holder changes its own roles.
    function _registeredTeam(bytes32 labelHash) internal view returns (IPermissionedRegistry child) {
        child = teamRegistry[labelHash];
        if (address(child) == address(0)) revert UnknownTeam(labelHash);
        uint256 labelId = uint256(labelHash);
        // ENSv2 exposes the NEXT permission resource while expired, even before re-registration.
        // Revival restores the original resource; actual re-registration increments its stored version.
        uint256 expectedResource = teamResource[labelHash];
        if (edition.getExpiry(labelId) <= block.timestamp) ++expectedResource;
        if (
            edition.getResource(labelId) != expectedResource
                || edition.latestOwnerOf(edition.getTokenId(labelId)) != teamLead[labelHash]
        ) revert TeamIdentityChanged(labelHash);
    }

    /// @notice Creates an emancipated team registry with a reserved winner slot in one transaction.
    /// @dev The lead can issue member names, but cannot replace the child registry or claim winner.
    ///      The stable registrar keeps only reserved promotion and renewal authority on the child.
    function registerTeam(string calldata label, address lead)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
        returns (address)
    {
        registrySetup.validateTeamLabel(label);
        if (lead == address(0)) revert ZeroAddress();
        if (lead == address(this) || lead == address(registrySetup)) revert InvalidTeamLead();
        bytes32 labelHash = keccak256(bytes(label));
        if (address(teamRegistry[labelHash]) != address(0)) revert TeamAlreadyRegistered(labelHash);

        IPermissionedRegistry child = registrySetup.createTeam(
            label,
            IRegistry(address(edition)),
            lead,
            uint256(keccak256(abi.encode("lanyard.team", editionLabel, label)))
        );
        if (!child.isEmancipated()) revert NotEmancipated();

        // Record identity before the external ERC1155 receiver callback. A callback cannot create
        // this label a second time, and it observes an already-sealed child registry.
        teamRegistry[labelHash] = child;
        teamLead[labelHash] = lead;
        edition.register(
            label, lead, IRegistry(address(child)), hackersResolver, BOOK_NAME_ROLES, namespaceExpiry
        );
        teamResource[labelHash] = edition.getResource(uint256(labelHash));
        _writeAddress(hackersResolver, label, lead);
        emit TeamRegistered(label, lead, address(child), namespaceExpiry);
        return address(child);
    }

    ////////////////////////////////////////////////////////////////////////
    // Badges
    ////////////////////////////////////////////////////////////////////////

    /// @notice Issues a badge: registers `label` in `book` to `owner`. The policy is fixed here: zero
    ///         name roles (no transfer, resolver control or subregistry control) and the book's expiry.
    ///         The fixed resolver and explicit holder address are initialized in the same transaction.
    ///         Callers choose neither roles nor expiry. Organizer only, after sealing.
    /// @dev Direct issuance through the organizer's own raw role on a book bypasses this policy; that is
    ///      issuer trust, tested in RegisterBadge.t.sol and disclosed in A2.
    function registerBadge(bytes32 book, string calldata label, address owner)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
        returns (uint256 tokenId)
    {
        if (owner == address(0)) revert ZeroAddress(); // owner 0 would reserve the label, not issue it
        _checkBadgeLabel(label);
        uint64 expiry = badgeExpiry(book);
        tokenId = _issue(bookRegistry[book], _bookLabel(book), _bookResolver(book), label, owner, expiry);
        emit BadgeIssued(book, label, owner, expiry);
    }

    function registerJudge(string calldata label, address owner)
        external
        inPhase(Phase.Sealed)
        returns (uint256)
    {
        if (msg.sender != headJudge) revert NotHeadJudge(msg.sender);
        uint256 tokenId = _issue(bookRegistry[JUDGES], "judges", staffResolver, label, owner, freezeDeadline);
        emit BadgeIssued(JUDGES, label, owner, freezeDeadline);
        return tokenId;
    }

    function _bookResolver(bytes32 book) internal view returns (address) {
        return book == HACKERS ? hackersResolver : staffResolver;
    }

    function _bookLabel(bytes32 book) internal pure returns (string memory) {
        if (book == HACKERS) return "hackers";
        if (book == JUDGES) return "judges";
        if (book == VOLUNTEERS) return "volunteers";
        revert UnknownBook(book);
    }

    function _issue(
        IPermissionedRegistry registry,
        string memory suffix,
        address resolver,
        string calldata label,
        address owner,
        uint64 expiry
    ) internal returns (uint256 tokenId) {
        if (owner == address(0)) revert ZeroAddress();
        _checkBadgeLabel(label);
        tokenId = registry.register(label, owner, IRegistry(address(0)), resolver, 0, expiry);
        _writeAddress(resolver, string.concat(label, ".", suffix), owner);
    }

    function _writeAddress(address resolver, string memory relative, address owner) internal {
        IPermissionedResolver(resolver)
            .setAddress(
                NameCoder.encode(string.concat(relative, ".", editionLabel, ".", baseName)),
                60,
                abi.encodePacked(owner)
            );
    }

    /// @notice Completes the trusted raw organizer issue path without granting the holder shared-resolver rights.
    function initializeBadgeAddress(bytes32 book, string calldata label)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
    {
        if (book == PARTNERS) revert BookNotOpen(book);
        IPermissionedRegistry registry = bookRegistry[book];
        if (address(registry) == address(0)) revert UnknownBook(book);
        _initializeAddress(registry, _bookResolver(book), _bookLabel(book), label);
    }

    function initializePartnerBadgeAddress(bytes32 partner, bytes32 sub, string calldata label)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
    {
        IPermissionedRegistry registry = _partnerBook(partner, sub);
        _initializeAddress(
            registry,
            staffResolver,
            string.concat(sub == JUDGES ? "judges." : "staff.", _partnerLabel(partner), ".partners"),
            label
        );
    }

    function _initializeAddress(
        IPermissionedRegistry registry,
        address resolver,
        string memory suffix,
        string calldata label
    ) internal {
        _checkBadgeLabel(label);
        address owner = registry.getOwner(uint256(keccak256(bytes(label))));
        if (owner == address(0)) revert NoBadgeToRevive(label);
        if (registry.getResolver(label) != resolver) revert UnexpectedBadgeResolver();
        _writeAddress(resolver, string.concat(label, ".", suffix), owner);
    }

    function onboardPartner(string calldata label, address wallet)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
        returns (address)
    {
        if (wallet == address(0)) revert ZeroAddress();
        if (wallet == organizer || wallet == address(this) || wallet == address(registrySetup)) {
            revert InvalidIssuanceConfiguration();
        }
        registrySetup.validatePartnerLabel(label);
        bytes32 partner = keccak256(bytes(label));
        if (address(partnerRegistry[partner]) != address(0)) revert PartnerAlreadyConfigured(partner);
        IPermissionedRegistry parent = registrySetup.createPartner(
            label,
            IRegistry(address(bookRegistry[PARTNERS])),
            uint256(keccak256(abi.encode("lanyard.partner", editionLabel, label)))
        );
        partnerRegistry[partner] = parent;
        partnerWallet[partner] = wallet;
        _createPartnerBook(partner, label, parent, wallet, JUDGES, "judges");
        _createPartnerBook(partner, label, parent, wallet, STAFF, "staff");
        bookRegistry[PARTNERS].register(
            label, wallet, IRegistry(address(parent)), staffResolver, 0, namespaceExpiry
        );
        partnerResource[partner] = bookRegistry[PARTNERS].getResource(uint256(partner));
        _writeAddress(staffResolver, string.concat(label, ".partners"), wallet);
        emit PartnerOnboarded(partner, label, wallet, address(parent));
        return address(parent);
    }

    function _createPartnerBook(
        bytes32 partner,
        string calldata label,
        IPermissionedRegistry parent,
        address wallet,
        bytes32 sub,
        string memory subLabel
    ) internal {
        IPermissionedRegistry child = _newManagedRegistry(
            subLabel,
            IRegistry(address(parent)),
            wallet,
            uint256(keccak256(abi.encode("lanyard.partner.book", editionLabel, label, subLabel)))
        );
        partnerBookRegistry[partner][sub] = child;
        parent.register(
            subLabel, organizer, IRegistry(address(child)), staffResolver, BOOK_NAME_ROLES, namespaceExpiry
        );
        _writeAddress(staffResolver, string.concat(subLabel, ".", label, ".partners"), organizer);
    }

    function _partnerBook(bytes32 partner, bytes32 sub)
        internal
        view
        returns (IPermissionedRegistry registry)
    {
        IPermissionedRegistry parent = partnerRegistry[partner];
        if (address(parent) == address(0)) revert UnknownPartner(partner);
        if (sub != JUDGES && sub != STAFF) revert InvalidPartnerBook(sub);
        registry = partnerBookRegistry[partner][sub];
        // Structural parent revocation, replacement or a short-lived ancestor invalidates the route.
        IPermissionedRegistry partners = bookRegistry[PARTNERS];
        string memory subLabel = sub == JUDGES ? "judges" : "staff";
        if (
            partners.getOwner(uint256(partner)) != partnerWallet[partner]
                || partners.getResource(uint256(partner)) != partnerResource[partner]
                || address(partners.getSubregistry(_partnerLabel(partner))) != address(parent)
                || partners.getExpiry(uint256(partner)) < namespaceExpiry
                || parent.getExpiry(uint256(sub)) < namespaceExpiry
                || address(parent.getSubregistry(subLabel)) != address(registry)
        ) revert PartnerHierarchyChanged(partner);
    }

    function registerPartnerBadge(bytes32 partner, bytes32 sub, string calldata label, address owner)
        external
        inPhase(Phase.Sealed)
        returns (uint256)
    {
        IPermissionedRegistry registry = _partnerBook(partner, sub);
        if (msg.sender != partnerWallet[partner]) revert NotPartner(msg.sender);
        string memory parentLabel = _partnerLabel(partner);
        string memory suffix = string.concat(sub == JUDGES ? "judges." : "staff.", parentLabel, ".partners");
        uint64 expiry = sub == JUDGES ? freezeDeadline : eventEnd;
        uint256 tokenId = _issue(registry, suffix, staffResolver, label, owner, expiry);
        // As for global books, hash the full edition-relative book label to preserve partner scope.
        emit BadgeIssued(keccak256(bytes(suffix)), label, owner, expiry);
        return tokenId;
    }

    function _partnerLabel(bytes32 partner) internal view returns (string memory label) {
        (, label) = partnerRegistry[partner].getParent();
    }

    function renewPartnerBadge(bytes32 partner, bytes32 sub, string calldata label, uint64 expiry)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
    {
        _renewBadge(_partnerBook(partner, sub), label, expiry);
    }

    /// @notice Extends a badge, or revives an expired one with its previous owner (A2.3). The new expiry must
    ///         be in the future, later than the current one, and no later than `namespaceExpiry` (the tree's
    ///         lifetime, deliberately not the issue policy, so a lapsed badge can be restored for a later
    ///         event window). The label must still have an owner: unregistered or merely reserved labels
    ///         revert. Organizer only, after sealing; the partners book stays closed until A2.2.
    function renew(bytes32 book, string calldata label, uint64 newExpiry)
        external
        onlyOrganizer
        inPhase(Phase.Sealed)
    {
        if (book == PARTNERS) revert BookNotOpen(book);
        IPermissionedRegistry registry = bookRegistry[book];
        if (address(registry) == address(0)) revert UnknownBook(book);
        _renewBadge(registry, label, newExpiry);
    }

    function _renewBadge(IPermissionedRegistry registry, string calldata label, uint64 newExpiry) internal {
        _checkBadgeLabel(label);
        if (newExpiry <= block.timestamp) revert RenewalNotInFuture(newExpiry, uint64(block.timestamp));
        if (newExpiry > namespaceExpiry) revert ExpiryAboveNamespace(newExpiry, namespaceExpiry);

        uint256 labelId = uint256(keccak256(bytes(label)));
        if (registry.latestOwnerOf(registry.getTokenId(labelId)) == address(0)) {
            revert NoBadgeToRevive(label);
        }
        uint64 current = registry.getExpiry(labelId);
        if (newExpiry <= current) revert RenewalNotLonger(newExpiry, current);
        registry.renew(labelId, newExpiry);
    }

    /// @notice The frozen expiry of badges in `book`: hackers end 7 days after the event, judges at the
    ///         freeze deadline, volunteers with the event. Partners reverts until A2.2.
    function badgeExpiry(bytes32 book) public view returns (uint64) {
        if (book == HACKERS) return eventEnd + HACKER_GRACE;
        if (book == JUDGES) return freezeDeadline;
        if (book == VOLUNTEERS) return eventEnd;
        if (book == PARTNERS) revert BookNotOpen(book);
        revert UnknownBook(book);
    }

    /// @dev A badge label is one non-empty label: no dots, so it cannot smuggle in a deeper name.
    function _checkBadgeLabel(string calldata label) internal pure {
        bytes calldata b = bytes(label);
        if (b.length == 0) revert InvalidBadgeLabel();
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == 0x2e) revert InvalidBadgeLabel();
        }
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
    ///      contract. Accept only mints from that registry.
    function onERC1155Received(address, address from, uint256, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        // Mints and regenerations only (from == 0); a holder transferring a base name in is refused.
        if (msg.sender != address(baseRegistry) || from != address(0)) revert UnexpectedToken();
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
