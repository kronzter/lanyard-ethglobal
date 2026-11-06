// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {EACBaseRolesLib} from "ens-v2/access-control/libraries/EACBaseRolesLib.sol";
import {Grant, IEACGrantInitializable} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {InvalidOwner} from "ens-v2/CommonErrors.sol";
import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {CloneProxyBytecode} from "@ensdomains/verifiable-factory/CloneProxyBytecode.sol";

import {EnsFixture} from "./helpers/EnsFixture.sol";

/// A1.1 step 0: proves the pinned ENSv2 build resolves, compiles at its exact pragma, and still
/// has the role layout and factory behaviour the registrar relies on. If a pin moves, these fail
/// first.
contract Ensv2WiringTest is EnsFixture {
    function setUp() public {
        setUpEns();
    }

    function test_roleConstantsMatchTheLayoutWeRelyOn() public pure {
        assertEq(R.ROLE_REGISTRAR, 1 << 0);
        assertEq(R.ROLE_REGISTER_RESERVED, 1 << 4);
        assertEq(R.ROLE_SET_PARENT, 1 << 8);
        assertEq(R.ROLE_UNREGISTER, 1 << 12);
        assertEq(R.ROLE_RENEW, 1 << 16);
        assertEq(R.ROLE_SET_SUBREGISTRY, 1 << 20);
        assertEq(R.ROLE_SET_RESOLVER, 1 << 24);
        assertEq(R.ROLE_UPGRADE, 1 << 124);
        assertEq(R.ROLE_CAN_TRANSFER_ADMIN, (1 << 28) << 128);
        assertEq(R.ROLE_SET_RESOLVER_ADMIN, R.ROLE_SET_RESOLVER << 128);
        assertEq(R.ROLE_SET_PARENT_ADMIN, R.ROLE_SET_PARENT << 128);
    }

    function test_renewIsTheOnlyRootRoleThatKeepsARegistryEmancipated() public pure {
        uint256 bad = R.UNEMANCIPATED_ROLE_BITMAP;
        assertEq(bad & R.ROLE_RENEW, 0);
        assertEq(bad & R.ROLE_REGISTRAR, 0);
        assertEq(bad & R.ROLE_SET_PARENT, 0);
        assertTrue(bad & R.ROLE_UNREGISTER != 0);
        assertTrue(bad & R.ROLE_SET_RESOLVER != 0);
        assertTrue(bad & R.ROLE_SET_SUBREGISTRY != 0);
        assertTrue(bad & R.ROLE_UPGRADE != 0);
    }

    function test_factoryDeploysAnInitializedRegistryProxy() public view {
        assertEq(factory.verifyContract(address(base)), address(userRegistryImpl));
        assertTrue(base.hasRootRoles(R.ROLE_REGISTRAR | R.ROLE_RENEW, organizer));
        assertEq(base.roleCount(0), R.ROLE_REGISTRAR | R.ROLE_RENEW);
    }

    function test_registryWithoutAnyRootHolderCannotBeCreated() public {
        Grant[] memory none = new Grant[](0);
        vm.expectRevert(InvalidOwner.selector);
        factory.deployProxy(
            address(userRegistryImpl), 1, abi.encodeCall(IEACGrantInitializable.initialize, (none))
        );
    }

    function test_adminRoleRevokesItselfAndItsRegularRole() public {
        // The seal relies on one admin bit being enough to revoke both the role and the admin.
        address holder = makeAddr("holder");
        IEnhancedAccessControl reg = IEnhancedAccessControl(
            address(deployRegistry(holder, R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN | R.ROLE_REGISTRAR, 7))
        );
        vm.prank(holder);
        reg.revokeRootRoles(R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN, holder);
        assertEq(reg.roleCount(0), R.ROLE_REGISTRAR);
        assertEq(EACBaseRolesLib.ALL_ROLES & reg.roleCount(0), R.ROLE_REGISTRAR);
    }

    /// The deploy script predicts proxy addresses off-chain (src/ens/edition-plan.ts); this pins the
    /// formula it copies. The vector in edition-plan.test.ts is printed by this test.
    function test_proxyAddressFollowsTheCreate2FormulaTheScriptCopies() public {
        address logic = factory.proxyLogic();
        bytes32 outerSalt = keccak256(abi.encode(organizer, uint256(0xba5e)));
        bytes memory code = CloneProxyBytecode.creationCode(logic, outerSalt);
        assertEq(code.length, 0x57);
        assertEq(Create2.computeAddress(outerSalt, keccak256(code), address(factory)), address(base));
        emit log_named_address("factory", address(factory));
        emit log_named_address("proxyLogic", logic);
        emit log_named_address("sender", organizer);
        emit log_named_address("proxy", address(base));
        emit log_named_bytes("creationCode", code);
    }
}
