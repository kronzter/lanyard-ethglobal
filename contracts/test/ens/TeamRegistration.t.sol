// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Vm} from "forge-std/Vm.sol";

import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";

// An interface keeps the first test run executable against the pre-A1.3 contract.
interface ITeamRegistrar {
    function registerTeam(string calldata label, address lead) external returns (address);
    function teamRegistry(bytes32 labelHash) external view returns (IPermissionedRegistry);
    function teamLead(bytes32 labelHash) external view returns (address);
}

contract TeamNoReceiver {}

contract CallbackTeamLead {
    ITeamRegistrar internal registrar;
    bool public observedSealed;
    bool public duplicateSucceeded;
    bool public winnerSucceeded;

    function configure(ITeamRegistrar registrar_) external {
        registrar = registrar_;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        IPermissionedRegistry child = registrar.teamRegistry(keccak256("callback-team"));
        if (address(child) != address(0)) {
            require(child.isEmancipated(), "child not emancipated during callback");
            require(
                child.roleCount(0) == (R.ROLE_REGISTRAR | R.ROLE_REGISTER_RESERVED | R.ROLE_RENEW),
                "setup roles survive callback"
            );
            require(
                child.getStatus(uint256(keccak256("winner"))) == IPermissionedRegistry.Status.RESERVED,
                "winner not reserved during callback"
            );
            observedSealed = true;
            (duplicateSucceeded,) = address(registrar)
                .call(abi.encodeCall(ITeamRegistrar.registerTeam, ("callback-team", address(this))));
            (winnerSucceeded,) = address(child)
                .call(
                    abi.encodeCall(
                        child.register,
                        ("winner", address(this), IRegistry(address(0)), address(0), 0, type(uint64).max)
                    )
                );
        }
        return this.onERC1155Received.selector;
    }
}

abstract contract TeamFixture is EnsFixture {
    LanyardRegistrar internal registrar;
    ITeamRegistrar internal teams;
    IPermissionedRegistry internal edition;
    address internal lead = makeAddr("team-lead");

    event TeamRegistered(string label, address indexed lead, address registry, uint64 expiry);

    function setUp() public {
        setUpEns();
        registrar = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "mumbai2026", EVENT_END, FREEZE_DEADLINE
        );
        teams = ITeamRegistrar(address(registrar));
        _configureIssuance(registrar);
        vm.startPrank(organizer);
        registrar.bootstrapEdition();
        edition = registrar.edition();
        base.register(
            "mumbai2026",
            address(registrar),
            IRegistry(address(edition)),
            address(0),
            registrar.editionNameRoles(),
            FAR_FUTURE
        );
        registrar.seal();
        vm.stopPrank();
    }

    function _register(string memory label, address owner) internal returns (IPermissionedRegistry) {
        vm.prank(organizer);
        return IPermissionedRegistry(teams.registerTeam(label, owner));
    }
}

contract TeamRegistrationTest is TeamFixture {
    function test_teamHasLeadFixedChildAndNamespaceExpiry() public {
        IPermissionedRegistry child = _register("zkpay", lead);
        assertEq(edition.getOwner(id("zkpay")), lead);
        assertEq(address(edition.getSubregistry("zkpay")), address(child));
        assertEq(edition.getResolver("zkpay"), registrar.hackersResolver());
        assertEq(edition.getExpiry(id("zkpay")), NAMESPACE_EXPIRY);
        assertEq(edition.roles(id("zkpay"), lead), R.ROLE_SET_RESOLVER | R.ROLE_RENEW);
        assertEq(edition.roleCount(id("zkpay")), R.ROLE_SET_RESOLVER | R.ROLE_RENEW);
        assertEq(address(teams.teamRegistry(keccak256("zkpay"))), address(child));
        assertEq(teams.teamLead(keccak256("zkpay")), lead);
        (IRegistry parent, string memory label) = child.getParent();
        assertEq(address(parent), address(edition));
        assertEq(label, "zkpay");
    }

    function test_childIsEmancipatedWithExactFinalRoleInventory() public {
        IPermissionedRegistry child = _register("zkpay", lead);
        assertTrue(child.isEmancipated());
        assertEq(child.roles(0, lead), R.ROLE_REGISTRAR);
        assertEq(child.roles(0, address(registrar)), R.ROLE_REGISTER_RESERVED | R.ROLE_RENEW);
        assertEq(child.roles(0, organizer), 0);
        assertEq(child.roleCount(0), R.ROLE_REGISTRAR | R.ROLE_REGISTER_RESERVED | R.ROLE_RENEW);
        vm.prank(lead);
        child.register("member", stranger, IRegistry(address(0)), address(0), 0, NAMESPACE_EXPIRY);
        assertEq(child.getOwner(id("member")), stranger);
    }

    function test_winnerIsReservedBeforeControlReturnsAndLeadCannotTakeIt() public {
        IPermissionedRegistry child = _register("zkpay", lead);
        assertEq(uint8(child.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
        assertEq(child.getOwner(id("winner")), address(0));
        assertEq(child.getExpiry(id("winner")), FAR_FUTURE);
        assertEq(child.roleCount(id("winner")), 0);
        vm.prank(lead);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, R.ROLE_REGISTER_RESERVED, lead
            )
        );
        child.register("winner", lead, IRegistry(address(0)), address(0), 0, FAR_FUTURE);
    }

    function test_leadCanSetResolverAndRenewButCannotReplaceChildOrTransfer() public {
        IPermissionedRegistry child = _register("zkpay", lead);
        uint256 tokenId = edition.getTokenId(id("zkpay"));
        vm.startPrank(lead);
        edition.setResolver(id("zkpay"), address(123));
        edition.renew(id("zkpay"), NAMESPACE_EXPIRY + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector,
                edition.getResource(id("zkpay")),
                R.ROLE_SET_SUBREGISTRY,
                lead
            )
        );
        edition.setSubregistry(id("zkpay"), IRegistry(address(123)));
        vm.expectRevert(
            abi.encodeWithSelector(IPermissionedRegistry.TransferDisallowed.selector, tokenId, lead)
        );
        edition.unsafeTransfer(stranger, tokenId, "");
        vm.stopPrank();
        assertEq(edition.getResolver("zkpay"), address(123));
        assertEq(edition.getExpiry(id("zkpay")), NAMESPACE_EXPIRY + 1);
        assertEq(address(edition.getSubregistry("zkpay")), address(child));
    }

    function test_organizerCannotUnregisterOrRedirectTeam() public {
        _register("zkpay", lead);
        vm.startPrank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector,
                edition.getResource(id("zkpay")),
                R.ROLE_UNREGISTER,
                organizer
            )
        );
        edition.unregister(id("zkpay"));
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector,
                edition.getResource(id("zkpay")),
                R.ROLE_SET_RESOLVER,
                organizer
            )
        );
        edition.setResolver(id("zkpay"), stranger);
        vm.stopPrank();
    }

    function test_onlyOrganizerCanRegister() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        teams.registerTeam("zkpay", lead);
    }

    function test_cannotRegisterBeforeSealing() public {
        LanyardRegistrar fresh = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "other2026", EVENT_END, FREEZE_DEADLINE
        );
        _configureIssuance(fresh);
        vm.startPrank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Created)
        );
        ITeamRegistrar(address(fresh)).registerTeam("zkpay", lead);
        fresh.bootstrapEdition();
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Bootstrapped)
        );
        ITeamRegistrar(address(fresh)).registerTeam("zkpay", lead);
        vm.stopPrank();
    }

    function test_invalidAndProtectedLabelsAreRejected() public {
        string[21] memory bad = [
            "",
            "a",
            "ab",
            "-zk",
            "zk-",
            "Zkpay",
            "zkpay ",
            "zk.pay",
            "ab--cd",
            "xn--abc",
            "a_b",
            "hackers",
            "judges",
            "volunteers",
            "partners",
            "admin",
            "staff",
            "lanyard",
            "ethglobal",
            "winner",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(organizer);
            vm.expectRevert(bytes4(keccak256("InvalidTeamLabel()")));
            teams.registerTeam(bad[i], lead);
        }
        vm.prank(organizer);
        vm.expectRevert(bytes4(keccak256("InvalidTeamLabel()")));
        teams.registerTeam(unicode"😊", lead);
    }

    function test_boundaryAndInnerHyphenLabelsAreAccepted() public {
        _register("abc", lead);
        _register("123", lead);
        _register("a--bc", lead);
        _register("abc--de", lead);
        _register("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lead);
        assertEq(edition.getOwner(id("abc")), lead);
    }

    function test_zeroAndRegistrarLeadCannotCreateInvalidRoleInventories() public {
        vm.startPrank(organizer);
        vm.expectRevert(LanyardRegistrar.ZeroAddress.selector);
        teams.registerTeam("zkpay", address(0));
        vm.expectRevert(bytes4(keccak256("InvalidTeamLead()")));
        teams.registerTeam("zkpay", address(registrar));
        vm.stopPrank();
    }

    function test_duplicateTeamCannotReplaceLeadOrChildEvenAfterExpiry() public {
        IPermissionedRegistry child = _register("zkpay", lead);
        vm.startPrank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("TeamAlreadyRegistered(bytes32)")), keccak256("zkpay"))
        );
        teams.registerTeam("zkpay", stranger);
        vm.warp(NAMESPACE_EXPIRY);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("TeamAlreadyRegistered(bytes32)")), keccak256("zkpay"))
        );
        teams.registerTeam("zkpay", stranger);
        vm.stopPrank();
        assertEq(address(teams.teamRegistry(keccak256("zkpay"))), address(child));
        assertEq(teams.teamLead(keccak256("zkpay")), lead);
    }

    function test_failedReceiverRollsBackChildAndRegistration() public {
        address recipient = address(new TeamNoReceiver());
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, recipient));
        teams.registerTeam("zkpay", recipient);
        assertEq(address(teams.teamRegistry(keccak256("zkpay"))), address(0));
        assertEq(teams.teamLead(keccak256("zkpay")), address(0));
        assertEq(edition.getOwner(id("zkpay")), address(0));
        _register("zkpay", lead); // deterministic factory salt was also rolled back
    }

    function test_organizerReceiverSeesSealedChildAndCannotReenterSameTeamOrTakeWinner() public {
        // Give the organizer a receiver so its callback really can pass onlyOrganizer on reentry.
        vm.etch(organizer, address(new CallbackTeamLead()).code);
        CallbackTeamLead(organizer).configure(teams);
        _register("callback-team", organizer);
        assertTrue(CallbackTeamLead(organizer).observedSealed());
        assertFalse(CallbackTeamLead(organizer).duplicateSucceeded());
        assertFalse(CallbackTeamLead(organizer).winnerSucceeded());
        assertEq(edition.getOwner(id("callback-team")), organizer);
    }

    function test_registrationEmitsTeamAndExpiry() public {
        vm.recordLogs();
        IPermissionedRegistry child = _register("zkpay", lead);
        // Expect the public registrar event as the final log after all child bootstrap events.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory last = logs[logs.length - 1];
        assertEq(last.emitter, address(registrar));
        assertEq(last.topics[0], keccak256("TeamRegistered(string,address,address,uint64)"));
        assertEq(address(uint160(uint256(last.topics[1]))), lead);
        assertEq(last.data, abi.encode("zkpay", address(child), NAMESPACE_EXPIRY));
    }

    function testFuzz_validLabelsAlwaysHaveSealedWinnerAndLeadPermissions(bytes32 seed, uint8 rawLength)
        public
    {
        uint256 length = bound(rawLength, 3, 32);
        bytes memory chars = new bytes(length);
        for (uint256 i; i < length; ++i) {
            chars[i] = bytes1(uint8(97 + uint8(seed[i]) % 26));
        }
        // A numeric first byte avoids the fixed book/protected label set.
        chars[0] = "7";
        string memory label = string(chars);
        IPermissionedRegistry child = _register(label, lead);
        assertEq(edition.getOwner(id(label)), lead);
        assertEq(child.roleCount(0), R.ROLE_REGISTRAR | R.ROLE_REGISTER_RESERVED | R.ROLE_RENEW);
        assertEq(uint8(child.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
    }

    function testFuzz_arbitraryBytesCannotBypassCanonicalPolicy(string memory label) public {
        bytes memory chars = bytes(label);
        bool canonical = chars.length >= 3 && chars.length <= 32;
        for (uint256 i; i < chars.length; ++i) {
            bool alphanumeric = (chars[i] >= "a" && chars[i] <= "z") || (chars[i] >= "0" && chars[i] <= "9");
            if (!alphanumeric && chars[i] != "-") canonical = false;
            if ((i == 0 || i == chars.length - 1) && chars[i] == "-") canonical = false;
        }
        if (chars.length >= 4 && chars[2] == "-" && chars[3] == "-") canonical = false;
        vm.assume(!canonical);
        vm.prank(organizer);
        vm.expectRevert(bytes4(keccak256("InvalidTeamLabel()")));
        teams.registerTeam(label, lead);
    }
}
