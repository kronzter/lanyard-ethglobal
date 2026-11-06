// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {IStandardRegistry} from "ens-v2/registry/interfaces/IStandardRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";

/// A1.2-R1 (books exist before any team can register) and A1.2-R2 (each book is a managed registry with
/// exactly the documented roles).
contract BooksTest is EnsFixture {
    LanyardRegistrar internal registrar;
    IPermissionedRegistry internal edition;
    string internal constant EDITION = "mumbai2026";
    bytes4 internal immutable CANNOT_GRANT = IEnhancedAccessControl.EACCannotGrantRoles.selector;
    bytes4 internal immutable UNAUTHORIZED = IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector;

    uint256 internal constant ORGANIZER_BOOK_ROLES =
        R.ROLE_REGISTRAR | R.ROLE_UNREGISTER | R.ROLE_RENEW | R.ROLE_SET_RESOLVER;

    function setUp() public {
        setUpEns();
        registrar = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, EDITION, EVENT_END, FREEZE_DEADLINE
        );
    }

    function _books() internal pure returns (string[4] memory) {
        return ["hackers", "judges", "volunteers", "partners"];
    }

    function _bootstrap() internal {
        _configureIssuance(registrar);
        vm.prank(organizer);
        registrar.bootstrapEdition();
        edition = registrar.edition();
    }

    function _seal() internal {
        uint256 nameRoles = registrar.editionNameRoles();
        vm.startPrank(organizer);
        base.register(
            EDITION, address(registrar), IRegistry(address(edition)), address(0), nameRoles, FAR_FUTURE
        );
        registrar.seal();
        vm.stopPrank();
    }

    // ----------------------------------------------------------------- A1.2-R1

    function test_R1_allFourBooksExistRightAfterBootstrapAndBeforeSealing() public {
        _bootstrap();
        assertEq(uint8(registrar.phase()), uint8(LanyardRegistrar.Phase.Bootstrapped));
        string[4] memory books = _books();
        for (uint256 i; i < books.length; ++i) {
            uint256 bookId = id(books[i]);
            assertEq(
                uint8(edition.getStatus(bookId)), uint8(IPermissionedRegistry.Status.REGISTERED), books[i]
            );
            assertEq(edition.getOwner(bookId), organizer, books[i]);
            assertEq(edition.getExpiry(bookId), NAMESPACE_EXPIRY, books[i]);
            address expectedResolver = keccak256(bytes(books[i])) == registrar.HACKERS()
                ? registrar.hackersResolver()
                : registrar.staffResolver();
            assertEq(edition.getResolver(books[i]), expectedResolver, books[i]);
            assertEq(
                address(edition.getSubregistry(books[i])),
                address(registrar.bookRegistry(keccak256(bytes(books[i])))),
                books[i]
            );
            assertTrue(address(registrar.bookRegistry(keccak256(bytes(books[i])))) != address(0));
        }
    }

    function test_R1_bookConstantsAreTheLabelHashes() public view {
        assertEq(registrar.HACKERS(), keccak256("hackers"));
        assertEq(registrar.JUDGES(), keccak256("judges"));
        assertEq(registrar.VOLUNTEERS(), keccak256("volunteers"));
        assertEq(registrar.PARTNERS(), keccak256("partners"));
    }

    function test_R1_nobodyCanReRegisterABookLabel() public {
        _bootstrap();
        _seal();
        string[4] memory books = _books();
        for (uint256 i; i < books.length; ++i) {
            // Neither the organizer nor the registrar (the only registry-wide registrar) can take it again.
            vm.prank(organizer);
            vm.expectRevert(
                abi.encodeWithSelector(IStandardRegistry.LabelAlreadyRegistered.selector, books[i])
            );
            edition.register(books[i], organizer, IRegistry(address(0)), address(0), 0, NAMESPACE_EXPIRY);
            vm.prank(address(registrar));
            vm.expectRevert(
                abi.encodeWithSelector(IStandardRegistry.LabelAlreadyRegistered.selector, books[i])
            );
            edition.register(books[i], stranger, IRegistry(address(0)), address(0), 0, NAMESPACE_EXPIRY);
        }
    }

    function test_R1_beforeBootstrapNoBookExists() public view {
        string[4] memory books = _books();
        for (uint256 i; i < books.length; ++i) {
            assertEq(address(registrar.bookRegistry(keccak256(bytes(books[i])))), address(0));
        }
    }

    // ----------------------------------------------------------------- A1.2-R2

    function test_R2_everyBookHasExactlyTheDocumentedRootRoles() public {
        _bootstrap();
        _seal();
        string[4] memory books = _books();
        for (uint256 i; i < books.length; ++i) {
            IPermissionedRegistry book = registrar.bookRegistry(keccak256(bytes(books[i])));
            assertEq(book.roles(0, organizer), ORGANIZER_BOOK_ROLES, books[i]);
            assertEq(book.roles(0, address(registrar)), R.ROLE_REGISTRAR | R.ROLE_RENEW, books[i]);
            uint256 expectedHeadJudgeRoles =
                keccak256(bytes(books[i])) == keccak256("judges") ? R.ROLE_UNREGISTER : 0;
            assertEq(book.roles(0, headJudge), expectedHeadJudgeRoles, books[i]);
            assertEq(book.roles(0, stranger), 0, books[i]);
            // The judges book also adds the head judge's unregisterer role.
            uint256 expectedRoleCount =
                2 * R.ROLE_REGISTRAR + R.ROLE_UNREGISTER + 2 * R.ROLE_RENEW + R.ROLE_SET_RESOLVER;
            if (expectedHeadJudgeRoles != 0) expectedRoleCount += R.ROLE_UNREGISTER;
            assertEq(book.roleCount(0), expectedRoleCount, books[i]);
            assertFalse(book.hasRootRoles(R.ROLE_UPGRADE, organizer), books[i]);
            assertFalse(book.hasRootRoles(R.ROLE_UPGRADE, address(registrar)), books[i]);
            assertEq(factory.verifyContract(address(book)), address(userRegistryImpl), books[i]);
        }
    }

    function test_R2_theRegistrarCannotUnregisterOrSetResolversInABook() public {
        _bootstrap();
        IPermissionedRegistry book = registrar.bookRegistry(registrar.HACKERS());
        vm.prank(address(registrar));
        book.register("alice", stranger, IRegistry(address(0)), address(0), 0, EVENT_END);
        uint256 resource = book.getResource(id("alice"));
        vm.prank(address(registrar));
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_UNREGISTER, address(registrar)));
        book.unregister(id("alice"));
        vm.prank(address(registrar));
        vm.expectRevert(
            abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_SET_RESOLVER, address(registrar))
        );
        book.setResolver(id("alice"), address(1));
    }

    function test_R2_strangersAndTheirRolesCannotTouchABook() public {
        _bootstrap();
        IPermissionedRegistry book = registrar.bookRegistry(registrar.JUDGES());
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_REGISTRAR, stranger));
        book.register("alice", stranger, IRegistry(address(0)), address(0), 0, EVENT_END);
        // The organizer holds no admin role, so it cannot hand out roles (UPGRADE included).
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(CANNOT_GRANT, 0, R.ROLE_UPGRADE, organizer));
        book.grantRootRoles(R.ROLE_UPGRADE, organizer);
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(CANNOT_GRANT, 0, R.ROLE_REGISTRAR, organizer));
        book.grantRootRoles(R.ROLE_REGISTRAR, stranger);
    }

    function test_R2_eachBooksParentPointerIsSetAndItsSetterRolesAreGone() public {
        _bootstrap();
        string[4] memory books = _books();
        for (uint256 i; i < books.length; ++i) {
            IPermissionedRegistry book = registrar.bookRegistry(keccak256(bytes(books[i])));
            (IRegistry parent, string memory label) = book.getParent();
            assertEq(address(parent), address(edition), books[i]);
            assertEq(label, books[i]);
            assertFalse(book.hasRootRoles(R.ROLE_SET_PARENT, address(registrar)));
            vm.prank(organizer);
            vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_SET_PARENT, organizer));
            book.setParent(IRegistry(address(1)), "x");
        }
    }

    function test_R2_theOrganizerManagesBookNamesButCannotMoveOrDropThem() public {
        _bootstrap();
        _seal();
        uint256 hackersId = id("hackers");
        uint256 resource = edition.getResource(hackersId);
        uint256 tokenId = edition.getTokenId(hackersId);
        assertEq(edition.roles(hackersId, organizer), R.ROLE_RENEW | R.ROLE_SET_RESOLVER);

        vm.startPrank(organizer);
        edition.setResolver(hackersId, address(0xbeef)); // allowed
        edition.renew(hackersId, NAMESPACE_EXPIRY + 1); // allowed
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_SET_SUBREGISTRY, organizer));
        edition.setSubregistry(hackersId, IRegistry(address(0)));
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_UNREGISTER, organizer));
        edition.unregister(hackersId);
        vm.expectRevert(
            abi.encodeWithSelector(IPermissionedRegistry.TransferDisallowed.selector, tokenId, organizer)
        );
        edition.unsafeTransfer(stranger, tokenId, "");
        vm.stopPrank();
    }

    function test_R2_bookNamesExpireAtNamespaceExpiry() public {
        _bootstrap();
        vm.warp(NAMESPACE_EXPIRY - 1);
        assertEq(uint8(edition.getStatus(id("partners"))), uint8(IPermissionedRegistry.Status.REGISTERED));
        vm.warp(NAMESPACE_EXPIRY);
        assertEq(uint8(edition.getStatus(id("partners"))), uint8(IPermissionedRegistry.Status.AVAILABLE));
    }

    function test_R2_noOneCanUpgradeTheEditionOrABook() public {
        _bootstrap();
        _seal();
        address[2] memory proxies = [address(edition), address(registrar.bookRegistry(registrar.HACKERS()))];
        address[2] memory callers = [organizer, address(registrar)];
        for (uint256 i; i < proxies.length; ++i) {
            for (uint256 j; j < callers.length; ++j) {
                vm.prank(callers[j]);
                vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_UPGRADE, callers[j]));
                UUPSUpgradeable(proxies[i]).upgradeToAndCall(address(userRegistryImpl), "");
            }
        }
    }
}
