// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IPermissionedResolver} from "ens-v2/resolver/interfaces/IPermissionedResolver.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";

import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";

contract Resolver is IERC165 {
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IPermissionedResolver).interfaceId || id == type(IERC165).interfaceId;
    }
}

/// Answers ERC-165 but is not a permissioned resolver.
contract NotAResolver is IERC165 {
    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}

/// Has code but no ERC-165.
contract Plain {}

/// A1.1-R1..R5 against the real ENSv2 contracts (pinned in foundry.toml).
contract EditionBootstrapTest is EnsFixture {
    LanyardRegistrar internal registrar;
    string internal constant EDITION = "mumbai2026";
    bytes4 internal immutable CANNOT_GRANT = IEnhancedAccessControl.EACCannotGrantRoles.selector;
    bytes4 internal immutable UNAUTHORIZED = IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector;

    function setUp() public {
        setUpEns();
        registrar = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, EDITION, EVENT_END, FREEZE_DEADLINE
        );
    }

    // ---------------------------------------------------------------- helpers

    function _bootstrap() internal returns (IPermissionedRegistry edition) {
        if (registrar.hackersResolver() == address(0)) _configureIssuance(registrar);
        vm.prank(organizer);
        registrar.bootstrapEdition();
        return registrar.edition();
    }

    /// The deploy script's step: the edition name goes to the registrar with the edition registry attached.
    function _attach(IPermissionedRegistry edition) internal {
        uint256 roles = registrar.editionNameRoles();
        vm.prank(organizer);
        base.register(EDITION, address(registrar), IRegistry(address(edition)), address(0), roles, FAR_FUTURE);
    }

    function _sealed() internal returns (IPermissionedRegistry edition) {
        edition = _bootstrap();
        _attach(edition);
        vm.prank(organizer);
        registrar.seal();
    }

    // -------------------------------------------------------------- constructor

    function test_namespaceExpiryIsMaxOfEventEndAndFreezePlusThirtyDays() public {
        assertEq(registrar.namespaceExpiry(), FREEZE_DEADLINE + 30 days);
        assertEq(registrar.namespaceExpiry(), NAMESPACE_EXPIRY);
        LanyardRegistrar later = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, EDITION, FREEZE_DEADLINE + 5, FREEZE_DEADLINE
        );
        assertEq(later.namespaceExpiry(), FREEZE_DEADLINE + 5 + 30 days);
    }

    function test_constructorRejectsZeroAddressesEmptyLabelAndZeroTimes() public {
        vm.expectRevert(LanyardRegistrar.ZeroAddress.selector);
        new LanyardRegistrar(
            address(0), factory, address(userRegistryImpl), base, EDITION, EVENT_END, FREEZE_DEADLINE
        );
        vm.expectRevert(LanyardRegistrar.EmptyEditionLabel.selector);
        new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "", EVENT_END, FREEZE_DEADLINE
        );
        vm.expectRevert(LanyardRegistrar.InvalidTimes.selector);
        new LanyardRegistrar(organizer, factory, address(userRegistryImpl), base, EDITION, 0, FREEZE_DEADLINE);
    }

    // ----------------------------------------------------------------- A1.1-R1

    function test_R1_baseThenEditionAreDistinctRegistriesInTheLookupPath() public {
        IPermissionedRegistry edition = _sealed();
        assertTrue(address(edition) != address(base));
        assertEq(address(base.getSubregistry(EDITION)), address(edition));
        assertEq(base.getOwner(id(EDITION)), address(registrar));
        (IRegistry parent, string memory label) = edition.getParent();
        assertEq(address(parent), address(base));
        assertEq(label, EDITION);
        assertEq(factory.verifyContract(address(edition)), address(userRegistryImpl));
    }

    function test_R1_parentPointerIsLockedAfterSeal() public {
        IPermissionedRegistry edition = _sealed();
        vm.prank(address(registrar));
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_SET_PARENT, address(registrar)));
        edition.setParent(IRegistry(address(0xdead)), "other");
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_SET_PARENT, organizer));
        edition.setParent(IRegistry(address(0xdead)), "other");
    }

    function test_R1_sealRevertsWhenTheEditionNameIsNotAttached() public {
        _bootstrap();
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "subregistry is not the edition registry"
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    function test_R1_sealRevertsWhenAnotherRegistryIsAttached() public {
        _bootstrap();
        _attach(deployRegistry(organizer, R.ROLE_REGISTRAR, 99));
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "subregistry is not the edition registry"
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    function test_R1_sealRevertsWhenTheNameIsOwnedBySomeoneElse() public {
        IPermissionedRegistry edition = _bootstrap();
        vm.prank(organizer);
        base.register(EDITION, organizer, IRegistry(address(edition)), address(0), 0, FAR_FUTURE);
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "name is not owned by the registrar"
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    function test_R1_sealRevertsWhenTheNameExpiresBeforeNamespaceExpiry() public {
        IPermissionedRegistry edition = _bootstrap();
        uint256 roles = registrar.editionNameRoles();
        vm.prank(organizer);
        base.register(
            EDITION, address(registrar), IRegistry(address(edition)), address(0), roles, NAMESPACE_EXPIRY - 1
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "name expires before namespaceExpiry"
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    // ----------------------------------------------------------------- A1.1-R2

    function test_R2_rootHoldersAreExactlyRegistrarAndRenewHeldByTheRegistrar() public {
        IPermissionedRegistry edition = _sealed();
        assertEq(edition.roleCount(0), R.ROLE_REGISTRAR | R.ROLE_RENEW);
        assertEq(edition.roles(0, address(registrar)), R.ROLE_REGISTRAR | R.ROLE_RENEW);
        assertEq(edition.roles(0, organizer), 0);
        assertFalse(edition.hasRootRoles(R.ROLE_UPGRADE, address(registrar)));
        (uint256 counts,) = edition.getAssigneeCount(0, R.ROLE_UPGRADE | R.ROLE_UPGRADE_ADMIN);
        assertEq(counts, 0);
        assertTrue(edition.isEmancipated());
    }

    function test_R2_beforeSealTheRegistrarStillHoldsTheSetParentRoles() public {
        IPermissionedRegistry edition = _bootstrap();
        assertEq(registrar.phase() == LanyardRegistrar.Phase.Bootstrapped ? 1 : 0, 1);
        assertTrue(edition.roleCount(0) != R.ROLE_REGISTRAR | R.ROLE_RENEW);
        assertTrue(edition.hasRootRoles(R.ROLE_SET_PARENT | R.ROLE_SET_PARENT_ADMIN, address(registrar)));
    }

    function test_R2_sealRevertsIfAnotherAccountHoldsARootRole() public {
        IPermissionedRegistry edition = _bootstrap();
        _attach(edition);
        // Simulates a compromised bootstrap: the registrar (which still holds the set-parent admin)
        // hands set-parent to someone else. The seal refuses to finish.
        vm.prank(address(registrar));
        edition.grantRootRoles(R.ROLE_SET_PARENT, stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.UnexpectedRootRoles.selector,
                R.ROLE_REGISTRAR | R.ROLE_RENEW | R.ROLE_SET_PARENT
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    function test_R2_nobodyElseCanRegisterInTheEdition() public {
        IPermissionedRegistry edition = _sealed();
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? organizer : stranger;
            vm.prank(who);
            vm.expectRevert(abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_REGISTRAR, who));
            edition.register("team", who, IRegistry(address(0)), address(0), 0, NAMESPACE_EXPIRY);
        }
    }

    // ----------------------------------------------------------------- A1.1-R3

    function test_R3_theFiveProtectedLabelsAreReservedBeforeAnyoneCanRegister() public {
        IPermissionedRegistry edition = _bootstrap();
        string[5] memory labels = ["admin", "staff", "lanyard", "ethglobal", "winner"];
        for (uint256 i; i < labels.length; ++i) {
            assertEq(uint8(edition.getStatus(id(labels[i]))), uint8(IPermissionedRegistry.Status.RESERVED));
            assertEq(edition.getExpiry(id(labels[i])), FAR_FUTURE);
            assertEq(edition.getOwner(id(labels[i])), address(0));
        }
        assertEq(uint8(edition.getStatus(id("teamx"))), uint8(IPermissionedRegistry.Status.AVAILABLE));
    }

    function test_R3_aReservedLabelCannotBeRegisteredByAnyone() public {
        IPermissionedRegistry edition = _sealed();
        string[5] memory labels = ["admin", "staff", "lanyard", "ethglobal", "winner"];
        for (uint256 i; i < labels.length; ++i) {
            // The registrar holds ROLE_REGISTRAR but not ROLE_REGISTER_RESERVED, so promoting fails...
            vm.prank(address(registrar));
            vm.expectRevert(
                abi.encodeWithSelector(UNAUTHORIZED, 0, R.ROLE_REGISTER_RESERVED, address(registrar))
            );
            edition.register(labels[i], stranger, IRegistry(address(0)), address(0), 0, NAMESPACE_EXPIRY);
            // ...and so does re-reserving.
            vm.prank(address(registrar));
            vm.expectRevert(
                abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyReserved.selector, labels[i])
            );
            edition.register(labels[i], address(0), IRegistry(address(0)), address(0), 0, NAMESPACE_EXPIRY);
        }
    }

    // ----------------------------------------------------------------- A1.1-R4

    function test_R4_theEditionNameIsOwnedByTheRegistrarWithOnlyTheDocumentedRoles() public {
        IPermissionedRegistry edition = _sealed();
        uint256 expected = R.ROLE_RENEW | R.ROLE_SET_RESOLVER | R.ROLE_SET_RESOLVER_ADMIN;
        assertEq(base.roles(id(EDITION), address(registrar)), expected);
        assertEq(base.getOwner(id(EDITION)), address(registrar));
        assertEq(base.getExpiry(id(EDITION)), FAR_FUTURE);
        assertEq(address(base.getSubregistry(EDITION)), address(edition));
    }

    function test_R4_registrarCannotChangeTheSubregistryOrTransferTheEditionName() public {
        _sealed();
        uint256 tokenId = base.getTokenId(id(EDITION));
        vm.startPrank(address(registrar));
        vm.expectRevert(
            abi.encodeWithSelector(
                UNAUTHORIZED, base.getResource(id(EDITION)), R.ROLE_SET_SUBREGISTRY, address(registrar)
            )
        );
        base.setSubregistry(id(EDITION), IRegistry(address(0)));
        vm.expectRevert(
            abi.encodeWithSelector(
                IPermissionedRegistry.TransferDisallowed.selector, tokenId, address(registrar)
            )
        );
        base.unsafeTransfer(stranger, tokenId, "");
        vm.stopPrank();
    }

    function test_R4_setPublicationResolverSetsItAndDropsTheRegistrarsResolverRoles() public {
        _sealed();
        uint256 expectedBefore = R.ROLE_RENEW | R.ROLE_SET_RESOLVER | R.ROLE_SET_RESOLVER_ADMIN;
        assertEq(base.roleCount(id(EDITION)), expectedBefore, "one holder of each, before");
        address resolver = address(new Resolver());
        vm.prank(organizer);
        registrar.setPublicationResolver(resolver);
        assertEq(base.roleCount(id(EDITION)), R.ROLE_RENEW, "only renew is held, after");

        assertEq(registrar.publicationResolver(), resolver);
        assertEq(base.getResolver(EDITION), resolver);
        assertEq(base.roles(id(EDITION), address(registrar)), R.ROLE_RENEW);
        assertEq(base.getOwner(id(EDITION)), address(registrar), "token regenerated to the same owner");

        uint256 resource = base.getResource(id(EDITION));
        vm.prank(address(registrar));
        vm.expectRevert(
            abi.encodeWithSelector(UNAUTHORIZED, resource, R.ROLE_SET_RESOLVER, address(registrar))
        );
        base.setResolver(id(EDITION), address(0xbeef));
    }

    function test_R4_setPublicationResolverIsOneShot() public {
        _sealed();
        address resolver = address(new Resolver());
        address second = address(new Resolver());
        vm.startPrank(organizer);
        registrar.setPublicationResolver(resolver);
        vm.expectRevert(LanyardRegistrar.PublicationResolverAlreadySet.selector);
        registrar.setPublicationResolver(second);
        vm.stopPrank();
    }

    function test_R4_setPublicationResolverIsOrganizerOnlyAndNeedsASealedEdition() public {
        address resolver = address(new Resolver());
        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Created)
        );
        registrar.setPublicationResolver(resolver);

        _sealed();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        registrar.setPublicationResolver(resolver);

        vm.startPrank(organizer);
        vm.expectRevert(LanyardRegistrar.ZeroAddress.selector);
        registrar.setPublicationResolver(address(0));
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.ResolverHasNoCode.selector, stranger));
        registrar.setPublicationResolver(stranger);
        vm.stopPrank();
    }

    function test_R4_baseRegistryOnlyMintsTheEditionNameToTheRegistrar() public {
        vm.prank(stranger);
        vm.expectRevert(LanyardRegistrar.UnexpectedToken.selector);
        registrar.onERC1155Received(stranger, address(0), 1, 1, "");
        vm.prank(address(base));
        vm.expectRevert(LanyardRegistrar.UnexpectedToken.selector); // not a mint
        registrar.onERC1155Received(stranger, stranger, 1, 1, "");
        vm.prank(address(base));
        assertEq(
            registrar.onERC1155Received(stranger, address(0), 1, 1, ""), registrar.onERC1155Received.selector
        );
        vm.expectRevert(LanyardRegistrar.UnexpectedToken.selector);
        registrar.onERC1155BatchReceived(stranger, stranger, new uint256[](0), new uint256[](0), "");
    }

    // ----------------------------------------------------------------- A1.1-R5

    function test_R5_bootstrapIsOrganizerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        registrar.bootstrapEdition();
        assertEq(address(registrar.edition()), address(0));
    }

    function test_R5_bootstrapAndSealAreOneShot() public {
        IPermissionedRegistry edition = _bootstrap();
        vm.startPrank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Bootstrapped)
        );
        registrar.bootstrapEdition();
        vm.stopPrank();

        _attach(edition);
        vm.startPrank(organizer);
        registrar.seal();
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Sealed)
        );
        registrar.seal();
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Sealed)
        );
        registrar.bootstrapEdition();
        vm.stopPrank();
    }

    function test_R5_sealNeedsBootstrapAndIsOrganizerOnly() public {
        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Created)
        );
        registrar.seal();
        IPermissionedRegistry edition = _bootstrap();
        _attach(edition);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        registrar.seal();
    }

    function test_R5_noBootstrapAuthoritySurvivesSealing() public {
        IPermissionedRegistry edition = _sealed();
        assertEq(uint8(registrar.phase()), uint8(LanyardRegistrar.Phase.Sealed));
        // The organizer never held an edition root role; the registrar lost every bootstrap one.
        assertEq(edition.roles(0, organizer), 0);
        assertEq(edition.roles(0, address(registrar)), R.ROLE_REGISTRAR | R.ROLE_RENEW);
        vm.prank(address(registrar));
        vm.expectRevert(abi.encodeWithSelector(CANNOT_GRANT, 0, R.ROLE_SET_PARENT, address(registrar)));
        edition.grantRootRoles(R.ROLE_SET_PARENT, address(registrar));
        vm.prank(address(registrar));
        vm.expectRevert(abi.encodeWithSelector(CANNOT_GRANT, 0, R.ROLE_UNREGISTER, address(registrar)));
        edition.grantRootRoles(R.ROLE_UNREGISTER, address(registrar));
    }

    function test_R5_protectedLabelsAreReservedBeforeTheEditionNameExists() public {
        IPermissionedRegistry edition = _bootstrap();
        assertEq(uint8(edition.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
        assertEq(base.getExpiry(id(EDITION)), 0, "edition name is not registered yet");
    }

    address internal alice = makeAddr("alice");

    function test_R4_aBaseNameHolderCannotTransferATokenInToTheRegistrar() public {
        // Mints and regenerations only: a holder pushing a base name into the registrar is refused.
        vm.prank(organizer);
        base.register(
            "loose", alice, IRegistry(address(0)), address(0), R.ROLE_CAN_TRANSFER_ADMIN, FAR_FUTURE
        );
        uint256 tokenId = base.getTokenId(id("loose"));
        vm.prank(alice);
        vm.expectRevert(LanyardRegistrar.UnexpectedToken.selector);
        base.unsafeTransfer(address(registrar), tokenId, "");
        assertEq(base.getOwner(id("loose")), alice);
    }

    function test_R4_setPublicationResolverRejectsAnAddressThatIsNotAPermissionedResolver() public {
        _sealed();
        address plain = address(new Plain());
        address notResolver = address(new NotAResolver());
        vm.startPrank(organizer);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.UnsupportedResolver.selector, plain));
        registrar.setPublicationResolver(plain);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.UnsupportedResolver.selector, notResolver));
        registrar.setPublicationResolver(notResolver);
        vm.stopPrank();
        assertEq(registrar.publicationResolver(), address(0), "nothing was set");
        assertEq(base.getResolver(EDITION), address(0));
    }

    function test_R4_sealRevertsWhenTheNameRolesAreNotTheExpectedSet() public {
        IPermissionedRegistry edition = _bootstrap();
        vm.prank(organizer);
        base.register(
            EDITION,
            address(registrar),
            IRegistry(address(edition)),
            address(0),
            R.ROLE_RENEW | R.ROLE_SET_RESOLVER, // no set-resolver admin
            FAR_FUTURE
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "name roles are not the expected set"
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    function test_R4_sealRevertsWhenAnotherAccountHoldsARoleOnTheName() public {
        IPermissionedRegistry edition = _bootstrap();
        _attach(edition);
        // The registrar holds the set-resolver admin on its name, so a compromised path could delegate it.
        vm.prank(address(registrar));
        base.grantRoles(id(EDITION), R.ROLE_SET_RESOLVER, stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "name has unexpected role holders"
            )
        );
        vm.prank(organizer);
        registrar.seal();
    }

    function test_R4_sealRevertsWhenTheNameWasReservedBeforeItWasRegistered() public {
        // A base registry where the organizer may also promote reserved names.
        IPermissionedRegistry base2 =
            deployRegistry(organizer, R.ROLE_REGISTRAR | R.ROLE_RENEW | R.ROLE_REGISTER_RESERVED, 0xbad);
        LanyardRegistrar r2 = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base2, EDITION, EVENT_END, FREEZE_DEADLINE
        );
        _configureIssuance(r2);
        vm.startPrank(organizer);
        r2.bootstrapEdition();
        uint256 roles = r2.editionNameRoles();
        IRegistry sub = IRegistry(address(r2.edition()));
        base2.register(EDITION, address(0), IRegistry(address(0)), address(0), 0, FAR_FUTURE); // reserve
        base2.register(EDITION, address(r2), sub, address(0), roles, 0); // promote
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.EditionNotAttached.selector, "name was reserved before registration"
            )
        );
        r2.seal();
        vm.stopPrank();
    }
}
