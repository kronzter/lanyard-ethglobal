// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";
import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";
import {IContractNamer} from "ens-v2/reverse-registrar/interfaces/IContractNamer.sol";
import {Grant, IEACGrantInitializable} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {UserRegistry} from "ens-v2/registry/UserRegistry.sol";
import {LabelStore} from "ens-v2/utils/LabelStore.sol";

/// A local ENSv2 stack: label store, UserRegistry implementation, VerifiableFactory and a base
/// registry standing in for `lanyard.eth`'s subregistry. Everything here is the real ENSv2 code
/// pinned in foundry.toml, nothing is mocked.
abstract contract EnsFixture is Test {
    // Placeholder edition times from src/shared/event.config.ts (kept in sync by a vitest).
    uint64 internal constant EVENT_END = 1_796_560_200;
    uint64 internal constant FREEZE_DEADLINE = 1_796_567_400;
    uint64 internal constant NAMESPACE_EXPIRY = FREEZE_DEADLINE + 30 days;
    uint64 internal constant FAR_FUTURE = type(uint64).max;

    address internal organizer = makeAddr("organizer");
    address internal stranger = makeAddr("stranger");

    LabelStore internal labelStore;
    UserRegistry internal userRegistryImpl;
    VerifiableFactory internal factory;
    IPermissionedRegistry internal base;

    function setUpEns() internal {
        vm.warp(1_790_000_000); // before the placeholder event, so nothing starts expired
        labelStore = new LabelStore(IContractNamer(address(0)));
        userRegistryImpl = new UserRegistry(labelStore, address(1));
        factory = new VerifiableFactory();
        // The base registry as the deploy script creates it: the organizer may register and renew
        // in it, nothing else.
        base = deployRegistry(organizer, R.ROLE_REGISTRAR | R.ROLE_RENEW, 0xba5e);
    }

    function deployRegistry(address account, uint256 roleBitmap, uint256 salt)
        internal
        returns (IPermissionedRegistry)
    {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: account, roleBitmap: roleBitmap});
        vm.prank(organizer);
        address proxy = factory.deployProxy(
            address(userRegistryImpl), salt, abi.encodeCall(IEACGrantInitializable.initialize, (grants))
        );
        return IPermissionedRegistry(proxy);
    }

    function id(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }
}
