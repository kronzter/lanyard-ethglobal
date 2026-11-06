// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {IStandardRegistry} from "ens-v2/registry/interfaces/IStandardRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";

/// A1.2-R3 (frozen role policy), R4 (expiry per book), R5 (organizer only) and R6 (BadgeIssued).
contract RegisterBadgeTest is EnsFixture {
    LanyardRegistrar internal registrar;
    IPermissionedRegistry internal edition;
    address internal alice = makeAddr("alice");
    bytes32 internal hackers;
    bytes32 internal judges;
    bytes32 internal volunteers;
    bytes32 internal partners;

    string internal constant EDITION = "mumbai2026";
    bytes4 internal immutable UNAUTHORIZED = IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector;

    event BadgeIssued(bytes32 indexed book, string label, address indexed owner, uint64 expiry);

    function setUp() public {
        setUpEns();
        registrar = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, EDITION, EVENT_END, FREEZE_DEADLINE
        );
        hackers = registrar.HACKERS();
        judges = registrar.JUDGES();
        volunteers = registrar.VOLUNTEERS();
        partners = registrar.PARTNERS();

        vm.prank(organizer);
        registrar.bootstrapEdition();
        edition = registrar.edition();
        uint256 nameRoles = registrar.editionNameRoles();
        vm.startPrank(organizer);
        base.register(
            EDITION, address(registrar), IRegistry(address(edition)), address(0), nameRoles, FAR_FUTURE
        );
        registrar.seal();
        vm.stopPrank();
    }

    function _issue(bytes32 book, string memory label, address owner) internal returns (uint256) {
        vm.prank(organizer);
        return registrar.registerBadge(book, label, owner);
    }

    function _book(bytes32 book) internal view returns (IPermissionedRegistry) {
        return registrar.bookRegistry(book);
    }

    // ----------------------------------------------------------------- A1.2-R3

    function test_R3_aBadgeHasZeroRolesSoItCannotMoveResolveOrDelegate() public {
        _issue(hackers, "alice", alice);
        IPermissionedRegistry book = _book(hackers);
        uint256 labelId = id("alice");
        assertEq(book.getOwner(labelId), alice);
        assertEq(book.roles(labelId, alice), 0);
        assertEq(book.getResolver("alice"), address(0));
        assertEq(address(book.getSubregistry("alice")), address(0));

        uint256 tokenId = book.getTokenId(labelId);
        uint256 resource = book.getResource(labelId);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_SET_RESOLVER, alice));
        book.setResolver(labelId, address(1));
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_SET_SUBREGISTRY, alice));
        book.setSubregistry(labelId, IRegistry(address(1)));
        vm.expectRevert(); // no ROLE_CAN_TRANSFER_ADMIN
        book.unsafeTransfer(stranger, tokenId, "");
        vm.expectRevert(); // safe transfer is also refused (book is not emancipated, and no transfer role)
        book.safeTransferFrom(alice, stranger, tokenId, 1, "");
        vm.stopPrank();
        assertEq(book.getOwner(labelId), alice, "still alice's");
    }

    function test_R3_theRegistrarHasNoEntryPointThatTakesRolesOrAnExpiry() public {
        // The only issuing function is registerBadge(bytes32,string,address): no roles, no expiry, no
        // resolver or subregistry parameters, so a caller cannot widen the policy.
        bytes4 sel = LanyardRegistrar.registerBadge.selector;
        assertEq(sel, bytes4(keccak256("registerBadge(bytes32,string,address)")));
        // A call with an extra expiry argument decodes as the same function and cannot change the outcome.
        vm.prank(organizer);
        (bool ok,) = address(registrar)
            .call(
                abi.encodeWithSelector(
                    sel, hackers, "bob", alice, uint64(FAR_FUTURE), uint256(R.ROLE_SET_RESOLVER)
                )
            );
        assertTrue(ok);
        IPermissionedRegistry book = _book(hackers);
        assertEq(book.getExpiry(id("bob")), EVENT_END + 7 days);
        assertEq(book.roles(id("bob"), alice), 0);
    }

    function test_R3_theOrganizersRawBookRoleIsIssuerTrustAndBypassesThePolicy() public {
        // Documented, not prevented: the organizer holds REGISTRAR on every book root (A1.2-R2), so it can
        // issue directly with any roles. The registrar's policy covers every issue path through the registrar.
        IPermissionedRegistry book = _book(hackers);
        vm.prank(organizer);
        book.register("carol", alice, IRegistry(address(0)), address(0), R.ROLE_SET_RESOLVER, FAR_FUTURE);
        assertEq(book.roles(id("carol"), alice), R.ROLE_SET_RESOLVER);
        assertEq(book.getExpiry(id("carol")), FAR_FUTURE);
    }

    function test_R3_zeroOwnerAndBadLabelsAreRefusedSoNothingIsReservedByAccident() public {
        vm.startPrank(organizer);
        vm.expectRevert(LanyardRegistrar.ZeroAddress.selector);
        registrar.registerBadge(hackers, "alice", address(0));
        vm.expectRevert(LanyardRegistrar.InvalidBadgeLabel.selector);
        registrar.registerBadge(hackers, "", alice);
        vm.expectRevert(LanyardRegistrar.InvalidBadgeLabel.selector);
        registrar.registerBadge(hackers, "a.b", alice);
        vm.stopPrank();
        assertEq(uint8(_book(hackers).getStatus(id("alice"))), uint8(IPermissionedRegistry.Status.AVAILABLE));
    }

    function testFuzz_R3_anyLabelAndOwnerGetsZeroRolesAndThePolicyExpiry(string memory label, address owner)
        public
    {
        vm.assume(bytes(label).length > 0 && bytes(label).length < 64);
        for (uint256 i; i < bytes(label).length; ++i) {
            vm.assume(bytes(label)[i] != 0x2e);
        }
        vm.assume(owner.code.length == 0 && uint160(owner) > 0xffff);
        _issue(judges, label, owner);
        IPermissionedRegistry book = _book(judges);
        assertEq(book.getOwner(id(label)), owner);
        assertEq(book.roles(id(label), owner), 0);
        assertEq(book.getExpiry(id(label)), FREEZE_DEADLINE);
    }

    // ----------------------------------------------------------------- A1.2-R4

    function test_R4_expiryIsFixedPerBook() public {
        _issue(hackers, "h", alice);
        _issue(judges, "j", alice);
        _issue(volunteers, "v", alice);
        assertEq(_book(hackers).getExpiry(id("h")), EVENT_END + 7 days);
        assertEq(_book(judges).getExpiry(id("j")), FREEZE_DEADLINE);
        assertEq(_book(volunteers).getExpiry(id("v")), EVENT_END);
        assertEq(registrar.badgeExpiry(hackers), EVENT_END + 7 days);
    }

    function test_R4_namespaceExpiryEqualsTheTypescriptFormula() public view {
        // max(eventEnd, freezeDeadline) + 30 days; src/ens/edition-plan.test.ts asserts the same literal
        // from namespaceExpiry() in src/shared/config/validate.ts.
        assertEq(registrar.namespaceExpiry(), 1_799_159_400);
    }

    function test_R4_partnersBookIssuesNothingUntilA22() public {
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.BookNotOpen.selector, partners));
        registrar.registerBadge(partners, "arkiv", alice);
        assertEq(uint8(_book(partners).getStatus(id("arkiv"))), uint8(IPermissionedRegistry.Status.AVAILABLE));
    }

    function test_R4_anUnknownBookIsRefused() public {
        bytes32 unknown = keccak256("sponsors");
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.UnknownBook.selector, unknown));
        registrar.registerBadge(unknown, "x", alice);
    }

    function test_R4_aBadgeAtExactlyItsExpiryTimestampIsExpired() public {
        _issue(volunteers, "v", alice);
        IPermissionedRegistry book = _book(volunteers);
        vm.warp(EVENT_END - 1);
        assertEq(book.getOwner(id("v")), alice, "valid one second before");
        assertEq(uint8(book.getStatus(id("v"))), uint8(IPermissionedRegistry.Status.REGISTERED));
        vm.warp(EVENT_END);
        assertEq(book.getOwner(id("v")), address(0), "expired exactly at the expiry timestamp");
        assertEq(uint8(book.getStatus(id("v"))), uint8(IPermissionedRegistry.Status.AVAILABLE));
    }

    function test_R4_renewExtendsUpToThePolicyAndNoFurther() public {
        _issue(volunteers, "v", alice);
        IPermissionedRegistry book = _book(volunteers);
        // A volunteer badge is already at its policy expiry, so only the same value is allowed.
        vm.startPrank(organizer);
        registrar.renew(volunteers, "v", EVENT_END);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.ExpiryAbovePolicy.selector, EVENT_END + 1, EVENT_END)
        );
        registrar.renew(volunteers, "v", EVENT_END + 1);
        vm.stopPrank();
        assertEq(book.getExpiry(id("v")), EVENT_END);
    }

    function test_R4_renewCanReviveAnExpiredBadgeWithinThePolicy() public {
        // Registry rule: the registrar's root RENEW role can revive an expired name. Policy still caps it.
        _issue(hackers, "h", alice);
        IPermissionedRegistry book = _book(hackers);
        vm.warp(EVENT_END + 7 days);
        assertEq(book.getOwner(id("h")), address(0));
        vm.startPrank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.ExpiryAbovePolicy.selector, EVENT_END + 7 days + 1, EVENT_END + 7 days
            )
        );
        registrar.renew(hackers, "h", EVENT_END + 7 days + 1);
        registrar.renew(hackers, "h", EVENT_END + 7 days); // no reduction, within policy: accepted
        vm.stopPrank();
    }

    function test_R4_renewCannotReduceAnExpiryOrTouchAnUnissuedLabel() public {
        _issue(hackers, "h", alice);
        vm.startPrank(organizer);
        vm.expectRevert();
        registrar.renew(hackers, "h", EVENT_END); // would shorten (EVENT_END + 7 days -> EVENT_END)
        vm.expectRevert();
        registrar.renew(hackers, "never-issued", EVENT_END + 7 days);
        vm.stopPrank();
    }

    function test_R4_renewIsOrganizerOnly() public {
        _issue(hackers, "h", alice);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        registrar.renew(hackers, "h", EVENT_END + 7 days);
    }

    // ----------------------------------------------------------------- A1.2-R5

    function test_R5_nonOrganizerCannotIssue() public {
        address[3] memory callers = [stranger, alice, address(registrar)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, callers[i]));
            registrar.registerBadge(hackers, "mallory", callers[i]);
        }
        assertEq(
            uint8(_book(hackers).getStatus(id("mallory"))), uint8(IPermissionedRegistry.Status.AVAILABLE)
        );
    }

    function test_R5_aBadgeHolderCannotIssueToThemselvesOrOthers() public {
        _issue(hackers, "alice", alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, alice));
        registrar.registerBadge(hackers, "alice2", alice);
    }

    function test_R5_nothingIssuesBeforeTheEditionIsSealed() public {
        LanyardRegistrar fresh = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "other2026", EVENT_END, FREEZE_DEADLINE
        );
        vm.startPrank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Created)
        );
        fresh.registerBadge(hackers, "alice", alice);
        fresh.bootstrapEdition();
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Bootstrapped)
        );
        fresh.registerBadge(hackers, "alice", alice);
        vm.stopPrank();
    }

    function testFuzz_R5_nobodyButTheOrganizerEverIssues(address caller, string memory label, address owner)
        public
    {
        vm.assume(caller != organizer);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, caller));
        registrar.registerBadge(hackers, label, owner);
    }

    // ----------------------------------------------------------------- A1.2-R6

    function test_R6_emitsBadgeIssuedWithBookLabelOwnerAndExpiry() public {
        vm.expectEmit(true, true, false, true, address(registrar));
        emit BadgeIssued(judges, "priya", alice, FREEZE_DEADLINE);
        _issue(judges, "priya", alice);
    }

    function test_R6_aRevertedIssueEmitsNothing() public {
        vm.recordLogs();
        vm.prank(stranger);
        vm.expectRevert();
        registrar.registerBadge(judges, "priya", alice);
        assertEq(vm.getRecordedLogs().length, 0);
    }
}
