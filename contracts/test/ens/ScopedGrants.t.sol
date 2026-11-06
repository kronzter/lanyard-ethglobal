// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IPermissionedResolver} from "ens-v2/resolver/interfaces/IPermissionedResolver.sol";
import {ITextResolver} from "@ens/contracts/resolvers/profiles/ITextResolver.sol";
import {ITextSetter} from "ens-v2/resolver/interfaces/setters/ITextSetter.sol";
import {PermissionedResolverLib as P} from "ens-v2/resolver/libraries/PermissionedResolverLib.sol";
import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";

interface IScopedRegistrar {
    function registerJudge(string calldata label, address owner) external returns (uint256);
    function onboardPartner(string calldata label, address wallet) external returns (address);
    function partnerBookRegistry(bytes32 partner, bytes32 sub) external view returns (IPermissionedRegistry);
    function registerPartnerBadge(bytes32 partner, bytes32 sub, string calldata label, address owner)
        external
        returns (uint256);
}

/// A2.1/A2.2/A2.3 phase bug hunt: the volunteer coordinator's key-scoped resolver grant, partner and
/// head-judge isolation, registry resource stability, the EAC holder limit and the no-approval rule.
contract ScopedGrantsTest is EnsFixture {
    LanyardRegistrar internal registrar;
    IScopedRegistrar internal scoped;
    IPermissionedResolver internal staffResolver;
    IPermissionedResolver internal hackersResolver;
    address internal coordinator = makeAddr("coordinator");
    address internal alice = makeAddr("scoped-alice");
    address internal arkiv = makeAddr("scoped-arkiv");
    address internal ens = makeAddr("scoped-ens");
    bytes32 internal constant STAFF_SUB = keccak256("staff");
    bytes4 internal immutable UNAUTHORIZED = IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector;

    function setUp() public {
        setUpEns();
        registrar = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "mumbai2026", EVENT_END, FREEZE_DEADLINE
        );
        scoped = IScopedRegistrar(address(registrar));
        _configureIssuance(registrar);
        vm.startPrank(organizer);
        registrar.bootstrapEdition();
        base.register(
            "mumbai2026",
            address(registrar),
            IRegistry(address(registrar.edition())),
            address(0),
            registrar.editionNameRoles(),
            FAR_FUTURE
        );
        registrar.seal();
        vm.stopPrank();
        staffResolver = IPermissionedResolver(registrar.staffResolver());
        hackersResolver = IPermissionedResolver(registrar.hackersResolver());
    }

    function _res(string memory key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }

    function _perms() internal pure returns (bytes memory) {
        return abi.encodeCall(ITextSetter.setText, ("", "lanyard.perms", ""));
    }

    function _appointCoordinator() internal {
        vm.prank(organizer);
        staffResolver.grantSetterRoles(_perms(), coordinator);
    }

    function _name(string memory relative) internal pure returns (bytes memory) {
        return NameCoder.encode(string.concat(relative, ".mumbai2026.lanyard.eth"));
    }

    function _issue(bytes32 book, string memory label) internal {
        vm.prank(organizer);
        registrar.registerBadge(book, label, alice);
    }

    function _book(bytes32 book) internal view returns (IPermissionedRegistry) {
        return registrar.bookRegistry(book);
    }

    function _onboard(string memory partner, address wallet) internal {
        vm.prank(organizer);
        scoped.onboardPartner(partner, wallet);
    }

    // ------------------------------------------------- 1-2: coordinator key scope

    function test_coordinatorCanSetLanyardPermsOnStaffName() public {
        _appointCoordinator();
        vm.prank(coordinator);
        staffResolver.setText(_name("alice.volunteers"), "lanyard.perms", "{}");
        assertEq(
            abi.decode(
                staffResolver.resolve(
                    _name("alice.volunteers"),
                    abi.encodeCall(ITextResolver.text, (bytes32(0), "lanyard.perms"))
                ),
                (string)
            ),
            "{}"
        );
    }

    function test_coordinatorCannotSetAvatarOrAnyOtherKeyOnStaffName() public {
        _appointCoordinator();
        string[3] memory keys = ["avatar", "lanyard.perm", "lanyard.perms.x"];
        for (uint256 i; i < keys.length; ++i) {
            vm.prank(coordinator);
            vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, _res(keys[i]), P.ROLE_SET_TEXT, coordinator));
            staffResolver.setText(_name("alice.volunteers"), keys[i], "x");
        }
    }

    function test_coordinatorGrantHoldsNoRootRoles() public {
        _appointCoordinator();
        assertFalse(staffResolver.hasRootRoles(P.ROLE_SET_TEXT, coordinator));
        assertEq(staffResolver.roles(_res("lanyard.perms"), coordinator), P.ROLE_SET_TEXT);
    }

    function test_coordinatorGrantDoesNotReachHackersResolver() public {
        _appointCoordinator();
        assertEq(hackersResolver.roles(_res("lanyard.perms"), coordinator), 0);
        vm.prank(coordinator);
        vm.expectRevert(
            abi.encodeWithSelector(UNAUTHORIZED, _res("lanyard.perms"), P.ROLE_SET_TEXT, coordinator)
        );
        hackersResolver.setText(_name("alice.hackers"), "lanyard.perms", "{}");
    }

    function test_ungrantedAccountCannotSetLanyardPerms() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(UNAUTHORIZED, _res("lanyard.perms"), P.ROLE_SET_TEXT, stranger)
        );
        staffResolver.setText(_name("alice.volunteers"), "lanyard.perms", "{}");
    }

    // ------------------------------------------------- 3: partner and head-judge isolation

    function test_partnerCannotIssueIntoNeighbourOrVolunteersBook() public {
        _onboard("arkiv", arkiv);
        _onboard("ens", ens);
        bytes32 volunteers = registrar.VOLUNTEERS();
        vm.startPrank(arkiv);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("NotPartner(address)")), arkiv));
        scoped.registerPartnerBadge(keccak256("ens"), STAFF_SUB, "alice", alice);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("InvalidPartnerBook(bytes32)")), volunteers));
        scoped.registerPartnerBadge(keccak256("arkiv"), volunteers, "alice", alice);
        // the passing case: its own staff sub-book works
        scoped.registerPartnerBadge(keccak256("arkiv"), STAFF_SUB, "alice", alice);
        vm.stopPrank();
        assertEq(scoped.partnerBookRegistry(keccak256("arkiv"), STAFF_SUB).getOwner(id("alice")), alice);
        assertEq(scoped.partnerBookRegistry(keccak256("ens"), STAFF_SUB).getOwner(id("alice")), address(0));
    }

    function test_partnerRawRegisterRevertsOnSubBooksAndTheJudgesBook() public {
        _onboard("arkiv", arkiv);
        _onboard("ens", ens);
        IPermissionedRegistry[3] memory targets = [
            scoped.partnerBookRegistry(keccak256("arkiv"), STAFF_SUB),
            scoped.partnerBookRegistry(keccak256("ens"), STAFF_SUB),
            _book(registrar.JUDGES())
        ];
        for (uint256 i; i < targets.length; ++i) {
            vm.prank(arkiv);
            vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_REGISTRAR, arkiv));
            targets[i].register("raw", alice, IRegistry(address(0)), address(staffResolver), 0, EVENT_END);
        }
    }

    function test_headJudgeRawRegisterRevertsOnJudgesBookAndSubBooks() public {
        _onboard("arkiv", arkiv);
        IPermissionedRegistry[2] memory targets =
            [_book(registrar.JUDGES()), scoped.partnerBookRegistry(keccak256("arkiv"), STAFF_SUB)];
        for (uint256 i; i < targets.length; ++i) {
            vm.prank(headJudge);
            vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_REGISTRAR, headJudge));
            targets[i].register("raw", alice, IRegistry(address(0)), address(staffResolver), 0, EVENT_END);
        }
    }

    // ------------------------------------------------- 4: head judge unregister scope

    function test_headJudgeCannotUnregisterVolunteerBadge() public {
        _issue(registrar.VOLUNTEERS(), "vol");
        IPermissionedRegistry volunteers = _book(registrar.VOLUNTEERS());
        uint256 resource = volunteers.getResource(id("vol"));
        vm.prank(headJudge);
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_UNREGISTER, headJudge));
        volunteers.unregister(id("vol"));
        assertEq(volunteers.getOwner(id("vol")), alice);
    }

    function test_headJudgeCanUnregisterJudgeBadge() public {
        vm.prank(headJudge);
        scoped.registerJudge("jude", alice);
        IPermissionedRegistry judges = _book(registrar.JUDGES());
        assertEq(judges.getOwner(id("jude")), alice);
        vm.prank(headJudge);
        judges.unregister(id("jude"));
        assertEq(judges.getOwner(id("jude")), address(0));
    }

    // ------------------------------------------------- 5: registry resource stability

    function test_unregisterClearsOwnerChangesResourceAndReissueGetsAnotherResource() public {
        bytes32 hackers = registrar.HACKERS();
        IPermissionedRegistry book = _book(hackers);
        _issue(hackers, "alice");
        uint256 first = book.getResource(id("alice"));
        vm.prank(organizer);
        book.unregister(id("alice"));
        assertEq(book.getOwner(id("alice")), address(0));
        uint256 afterUnregister = book.getResource(id("alice"));
        assertTrue(afterUnregister != first, "resource changes on unregister");
        _issue(hackers, "alice");
        uint256 second = book.getResource(id("alice"));
        assertTrue(second != first, "reissue is a new resource");
        assertEq(book.getOwner(id("alice")), alice);
    }

    function test_renewalKeepsTheResource() public {
        bytes32 volunteers = registrar.VOLUNTEERS();
        IPermissionedRegistry book = _book(volunteers);
        _issue(volunteers, "vol");
        uint256 resource = book.getResource(id("vol"));
        vm.prank(organizer);
        registrar.renew(volunteers, "vol", FREEZE_DEADLINE);
        assertEq(book.getResource(id("vol")), resource);
        assertEq(book.getOwner(id("vol")), alice);
    }

    function test_ordinaryRoleChangeKeepsTheResource() public {
        IPermissionedRegistry book = _book(registrar.HACKERS());
        vm.prank(organizer);
        book.register(
            "raw",
            alice,
            IRegistry(address(0)),
            address(hackersResolver),
            R.ROLE_SET_RESOLVER | R.ROLE_SET_RESOLVER_ADMIN,
            EVENT_END
        );
        uint256 resource = book.getResource(id("raw"));
        vm.prank(alice);
        book.revokeRoles(id("raw"), R.ROLE_SET_RESOLVER, alice);
        assertEq(book.getResource(id("raw")), resource, "role change regenerates the token, not the resource");
        assertEq(book.getOwner(id("raw")), alice);
    }

    // ------------------------------------------------- 6: EAC holder limit

    /// The pinned EnhancedAccessControl keeps one 4-bit counter per role per resource, so a role has
    /// at most 15 holders on a resource; the 16th grant reverts with EACMaxAssignees.
    function test_sixteenthHolderOfOneRoleOnOneResourceReverts() public {
        uint256 resource = _res("lanyard.perms");
        for (uint256 i; i < 15; ++i) {
            vm.prank(organizer);
            assertTrue(staffResolver.grantSetterRoles(_perms(), address(uint160(0x1000 + i))));
        }
        assertEq(staffResolver.roleCount(resource), 15 * P.ROLE_SET_TEXT);
        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(IEnhancedAccessControl.EACMaxAssignees.selector, resource, P.ROLE_SET_TEXT)
        );
        staffResolver.grantSetterRoles(_perms(), address(uint160(0x2000)));
        // a different key is a different resource with its own counter
        vm.prank(organizer);
        staffResolver.grantSetterRoles(
            abi.encodeCall(ITextSetter.setText, ("", "avatar", "")), address(0x2000)
        );
    }

    // ------------------------------------------------- 7: no badge path approves anyone

    function test_noBadgePathSetsApprovalForAll() public {
        _onboard("arkiv", arkiv);
        bytes32[3] memory books = [registrar.HACKERS(), registrar.JUDGES(), registrar.VOLUNTEERS()];
        for (uint256 i; i < books.length; ++i) {
            _issue(books[i], "h");
        }
        bytes32 hackersBook = registrar.VOLUNTEERS();
        vm.prank(organizer);
        registrar.renew(hackersBook, "h", FREEZE_DEADLINE);
        vm.prank(arkiv);
        scoped.registerPartnerBadge(keccak256("arkiv"), STAFF_SUB, "h", alice);
        vm.prank(headJudge);
        scoped.registerJudge("hj", alice);

        IPermissionedRegistry[4] memory regs = [
            _book(books[0]),
            _book(books[1]),
            _book(books[2]),
            scoped.partnerBookRegistry(keccak256("arkiv"), STAFF_SUB)
        ];
        address[5] memory operators =
            [address(registrar), organizer, headJudge, arkiv, address(staffResolver)];
        for (uint256 i; i < regs.length; ++i) {
            assertEq(regs[i].getOwner(id("h")), alice);
            for (uint256 j; j < operators.length; ++j) {
                assertFalse(regs[i].isApprovedForAll(alice, operators[j]));
            }
        }
    }
}
