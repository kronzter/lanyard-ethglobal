// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IVerifiableFactory} from "@ensdomains/verifiable-factory/IVerifiableFactory.sol";
import {Grant, IEACGrantInitializable} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

/// @notice Fixed bootstrap companion, created by and callable only by LanyardRegistrar.
/// @dev Keeps the registrar below EIP-170. It retains no role on any registry it returns, has no
///      upgrade/general-call entrypoint, and installs the registrar as the stable final authority.
contract LanyardRegistrySetup {
    error NotRegistrar();
    error UnexpectedRootRoles(uint256 counts);
    error InvalidTeamLabel();
    error InvalidIssuanceConfiguration();
    address public immutable registrar;
    address public immutable organizer;
    IVerifiableFactory public immutable factory;
    address public immutable implementation;
    uint256 private constant PARENT_SETUP = R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN;
    uint256 private constant STABLE = R.ROLE_REGISTRAR | R.ROLE_RENEW;
    uint256 private constant ORGANIZER =
        R.ROLE_REGISTRAR | R.ROLE_UNREGISTER | R.ROLE_RENEW | R.ROLE_SET_RESOLVER;
    uint256 private constant MANAGED_COUNTS =
        2 * R.ROLE_REGISTRAR + R.ROLE_UNREGISTER + 2 * R.ROLE_RENEW + R.ROLE_SET_RESOLVER;

    constructor(IVerifiableFactory factory_, address implementation_, address organizer_) {
        registrar = msg.sender;
        factory = factory_;
        implementation = implementation_;
        organizer = organizer_;
    }

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    function _deploy(Grant[] memory grants, uint256 salt) private returns (IPermissionedRegistry) {
        return IPermissionedRegistry(
            factory.deployProxy(
                implementation, salt, abi.encodeCall(IEACGrantInitializable.initialize, (grants))
            )
        );
    }

    function _finish(IPermissionedRegistry registry, uint256 expected) private view {
        uint256 counts = registry.roleCount(0);
        if (counts != expected || registry.roles(0, address(this)) != 0) revert UnexpectedRootRoles(counts);
    }

    function createManaged(string calldata label, IRegistry parent, address delegate, uint256 salt)
        external
        onlyRegistrar
        returns (IPermissionedRegistry registry)
    {
        Grant[] memory grants = new Grant[](delegate == address(0) ? 3 : 4);
        grants[0] = Grant({account: address(this), roleBitmap: PARENT_SETUP});
        grants[1] = Grant({account: registrar, roleBitmap: STABLE});
        grants[2] = Grant({account: organizer, roleBitmap: ORGANIZER});
        if (delegate != address(0)) grants[3] = Grant({account: delegate, roleBitmap: R.ROLE_UNREGISTER});
        registry = _deploy(grants, salt);
        registry.setParent(parent, label);
        registry.revokeRootRoles(PARENT_SETUP, address(this));
        _finish(registry, MANAGED_COUNTS + (delegate == address(0) ? 0 : R.ROLE_UNREGISTER));
    }

    function createPartner(string calldata label, IRegistry parent, uint256 salt)
        external
        onlyRegistrar
        returns (IPermissionedRegistry registry)
    {
        Grant[] memory grants = new Grant[](2);
        grants[0] = Grant({account: address(this), roleBitmap: PARENT_SETUP});
        grants[1] = Grant({account: registrar, roleBitmap: STABLE});
        registry = _deploy(grants, salt);
        registry.setParent(parent, label);
        registry.revokeRootRoles(PARENT_SETUP, address(this));
        _finish(registry, STABLE);
    }

    function createTeam(string calldata label, IRegistry parent, address lead, uint256 salt)
        external
        onlyRegistrar
        returns (IPermissionedRegistry registry)
    {
        uint256 temporary = PARENT_SETUP | R.ROLE_REGISTRAR | R.ROLE_REGISTRAR_ADMIN;
        Grant[] memory grants = new Grant[](2);
        grants[0] = Grant({account: address(this), roleBitmap: temporary});
        grants[1] = Grant({account: registrar, roleBitmap: R.ROLE_REGISTER_RESERVED | R.ROLE_RENEW});
        registry = _deploy(grants, salt);
        registry.setParent(parent, label);
        registry.register("winner", address(0), IRegistry(address(0)), address(0), 0, type(uint64).max);
        registry.grantRootRoles(R.ROLE_REGISTRAR, lead);
        registry.revokeRootRoles(temporary, address(this));
        _finish(registry, R.ROLE_REGISTRAR | R.ROLE_REGISTER_RESERVED | R.ROLE_RENEW);
    }

    function _canonical(bytes calldata b, uint256 start, uint256 end) private pure returns (bool) {
        if (end <= start || end - start > 63 || b[start] == "-" || b[end - 1] == "-") return false;
        if (end - start >= 4 && b[start + 2] == "-" && b[start + 3] == "-") return false;
        for (uint256 i = start; i < end; ++i) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) return false;
        }
        return true;
    }

    function validateBaseName(string calldata name) external pure {
        bytes calldata b = bytes(name);
        uint256 n = b.length;
        if (n < 5 || n > 253 || b[n - 4] != "." || b[n - 3] != "e" || b[n - 2] != "t" || b[n - 1] != "h") {
            revert InvalidIssuanceConfiguration();
        }
        uint256 start;
        for (uint256 i; i <= n; ++i) {
            if (i == n || b[i] == ".") {
                if (!_canonical(b, start, i)) revert InvalidIssuanceConfiguration();
                start = i + 1;
            }
        }
    }

    function validatePartnerLabel(string calldata label) external pure {
        if (!_canonical(bytes(label), 0, bytes(label).length)) revert InvalidIssuanceConfiguration();
    }

    function validateTeamLabel(string calldata label) external pure {
        bytes calldata b = bytes(label);
        if (b.length < 3 || b.length > 32 || !_canonical(b, 0, b.length)) revert InvalidTeamLabel();
        bytes32 h = keccak256(b);
        if (
            h == keccak256("hackers") || h == keccak256("judges") || h == keccak256("volunteers")
                || h == keccak256("partners") || h == keccak256("admin") || h == keccak256("staff")
                || h == keccak256("lanyard") || h == keccak256("ethglobal") || h == keccak256("winner")
        ) {
            revert InvalidTeamLabel();
        }
    }
}
