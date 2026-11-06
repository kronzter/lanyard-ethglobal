// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";
import {IVerifiableFactory} from "@ensdomains/verifiable-factory/IVerifiableFactory.sol";
import {Grant, IEACGrantInitializable} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

import {LanyardRegistrar} from "../../../src/ens/LanyardRegistrar.sol";

/// Runs the edition setup against the real ENSv2 deployment on a Sepolia fork. Skipped (not failed)
/// when SEPOLIA_RPC_URL is unset, so `forge test` and CI stay offline. The URL is read from the
/// environment only; Forge can echo it in error messages, so run this suite yourself:
///
///   SEPOLIA_RPC_URL=... forge test --root contracts --match-path 'test/ens/fork/*'
///
/// Mode A replays the whole setup on a throwaway `.eth` label registered under impersonation of the
/// ETH registrar. Mode B inspects an already deployed edition: LANYARD_EDITION_REGISTRY=<address>.
contract EditionForkTest is Test {
    // ENSv2 Sepolia, tag sepolia-deployment-2026-09-15 (mirrors src/ens/ensv2-sepolia.ts).
    address internal constant ETH_REGISTRY = 0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E;
    address internal constant ETH_REGISTRAR = 0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca;
    address internal constant FACTORY = 0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C;
    address internal constant USER_REGISTRY_IMPL = 0xA80338aAA8D23831cEa25E858D1774534aBb0263;

    uint64 internal constant EVENT_END = 1_796_560_200;
    uint64 internal constant FREEZE_DEADLINE = 1_796_567_400;
    uint64 internal constant FAR_FUTURE = type(uint64).max;
    string internal constant EDITION = "mumbai2026";

    address internal organizer = makeAddr("fork-organizer");

    function _forkOrSkip() internal {
        string memory url = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(url).length == 0) vm.skip(true, "SEPOLIA_RPC_URL not set");
        vm.createSelectFork(url);
    }

    function _id(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }

    // ------------------------------------------------------------------ Mode A

    function test_modeA_fullSetupOnRealEnsv2() public {
        _forkOrSkip();
        IPermissionedRegistry eth = IPermissionedRegistry(ETH_REGISTRY);
        string memory baseLabel = string.concat("lanyardfork", vm.toString(block.timestamp));
        uint256 baseId = _id(baseLabel);

        // A throwaway .eth name for the organizer. Real registrations go through the ETH registrar, which
        // holds the registry's registrar role; the roles granted here are the ones the script relies on.
        vm.prank(ETH_REGISTRAR);
        eth.register(
            baseLabel,
            organizer,
            IRegistry(address(0)),
            address(0),
            R.ROLE_SET_SUBREGISTRY | R.ROLE_SET_RESOLVER | R.ROLE_RENEW,
            FAR_FUTURE
        );

        // Base registry, attached and with its parent pointer locked (what deploy-edition.ts does).
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({
            account: organizer,
            roleBitmap: R.ROLE_REGISTRAR | R.ROLE_RENEW | R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN
        });
        vm.startPrank(organizer);
        IPermissionedRegistry base = IPermissionedRegistry(
            IVerifiableFactory(FACTORY)
                .deployProxy(
                    USER_REGISTRY_IMPL, 1, abi.encodeCall(IEACGrantInitializable.initialize, (grants))
                )
        );
        eth.setSubregistry(baseId, IRegistry(address(base)));
        base.setParent(IRegistry(ETH_REGISTRY), baseLabel);
        base.revokeRootRoles(R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN, organizer);
        vm.stopPrank();

        LanyardRegistrar registrar = new LanyardRegistrar(
            organizer,
            IVerifiableFactory(FACTORY),
            USER_REGISTRY_IMPL,
            base,
            EDITION,
            EVENT_END,
            FREEZE_DEADLINE
        );
        uint256 nameRoles = registrar.editionNameRoles();

        vm.startPrank(organizer);
        registrar.bootstrapEdition();
        IPermissionedRegistry edition = registrar.edition();
        base.register(
            EDITION, address(registrar), IRegistry(address(edition)), address(0), nameRoles, FAR_FUTURE
        );
        registrar.seal();
        vm.stopPrank();

        // The same assertions as the local suite, now against the real implementation and factory.
        assertEq(IVerifiableFactory(FACTORY).verifyContract(address(edition)), USER_REGISTRY_IMPL);
        assertEq(address(eth.getSubregistry(baseLabel)), address(base));
        assertEq(address(base.getSubregistry(EDITION)), address(edition));
        assertTrue(edition.isEmancipated());
        assertEq(edition.roleCount(0), R.ROLE_REGISTRAR | R.ROLE_RENEW);
        assertEq(edition.roles(0, address(registrar)), R.ROLE_REGISTRAR | R.ROLE_RENEW);
        assertEq(edition.roles(0, organizer), 0);
        assertFalse(edition.hasRootRoles(R.ROLE_UPGRADE, address(registrar)));
        string[5] memory labels = ["admin", "staff", "lanyard", "ethglobal", "winner"];
        for (uint256 i; i < labels.length; ++i) {
            assertEq(uint8(edition.getStatus(_id(labels[i]))), uint8(IPermissionedRegistry.Status.RESERVED));
        }
    }

    // ------------------------------------------------------------------ Mode B

    function test_modeB_deployedEditionHasExactlyTheDocumentedRoles() public {
        _forkOrSkip();
        address deployed = vm.envOr("LANYARD_EDITION_REGISTRY", address(0));
        if (deployed == address(0)) vm.skip(true, "LANYARD_EDITION_REGISTRY not set");
        IPermissionedRegistry edition = IPermissionedRegistry(deployed);

        assertEq(
            IVerifiableFactory(FACTORY).verifyContract(deployed), USER_REGISTRY_IMPL, "not a factory proxy"
        );
        assertTrue(edition.isEmancipated(), "edition is not emancipated");
        assertEq(edition.roleCount(0), R.ROLE_REGISTRAR | R.ROLE_RENEW, "unexpected root role holders");
        (IRegistry parent, string memory label) = edition.getParent();
        assertTrue(address(parent) != address(0), "parent pointer not set");
        assertEq(label, EDITION);
        assertEq(
            address(parent.getSubregistry(EDITION)), deployed, "parent does not point back at the edition"
        );
        string[5] memory labels = ["admin", "staff", "lanyard", "ethglobal", "winner"];
        for (uint256 i; i < labels.length; ++i) {
            assertEq(uint8(edition.getStatus(_id(labels[i]))), uint8(IPermissionedRegistry.Status.RESERVED));
        }
    }
}
