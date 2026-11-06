// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {PermissionedResolver} from "ens-v2/resolver/PermissionedResolver.sol";
import {IPermissionedResolver} from "ens-v2/resolver/interfaces/IPermissionedResolver.sol";
import {
    IPermissionedResolverInitializable,
    Grant as ResolverGrant
} from "ens-v2/resolver/interfaces/IPermissionedResolverInitializable.sol";
import {IAddressSetter} from "ens-v2/resolver/interfaces/setters/IAddressSetter.sol";
import {PermissionedResolverLib as P} from "ens-v2/resolver/libraries/PermissionedResolverLib.sol";
import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";

interface IIssuanceHandoff {
    function registrySetup() external view returns (address);
    function configureIssuance(address hackers, address staff, address headJudge, string calldata baseName)
        external;
    function registerJudge(string calldata label, address owner) external returns (uint256);
    function onboardPartner(string calldata label, address wallet) external returns (address);
    function partnerRegistry(bytes32 partner) external view returns (IPermissionedRegistry);
    function partnerBookRegistry(bytes32 partner, bytes32 sub) external view returns (IPermissionedRegistry);
    function registerPartnerBadge(bytes32 partner, bytes32 sub, string calldata label, address owner)
        external
        returns (uint256);
    function renewPartnerBadge(bytes32 partner, bytes32 sub, string calldata label, uint64 expiry) external;
    function initializeBadgeAddress(bytes32 book, string calldata label) external;
    function initializePartnerBadgeAddress(bytes32 partner, bytes32 sub, string calldata label) external;
}

contract IssuanceHandoffTest is EnsFixture {
    LanyardRegistrar internal r2;
    IIssuanceHandoff internal handoff;
    IPermissionedResolver internal hx;
    IPermissionedResolver internal sx;
    PermissionedResolver internal impl2;
    address internal chief2 = makeAddr("handoff-chief");
    address internal alice2 = makeAddr("handoff-alice");
    address internal arkiv2 = makeAddr("handoff-arkiv");
    address internal ens2 = makeAddr("handoff-ens");
    uint256 internal resolverSalt2;
    bytes32 internal constant STAFF_SUB = keccak256("staff");
    event BadgeIssued(bytes32 indexed book, string label, address indexed owner, uint64 expiry);

    function setUp() public {
        setUpEns();
        r2 = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "mumbai2026", EVENT_END, FREEZE_DEADLINE
        );
        handoff = IIssuanceHandoff(address(r2));
        impl2 = new PermissionedResolver(address(1));
        hx = _newResolver(false);
        sx = _newResolver(false);
    }

    function _newResolver(bool scoped) internal returns (IPermissionedResolver) {
        ResolverGrant[] memory grants = new ResolverGrant[](scoped ? 1 : 2);
        grants[0] = ResolverGrant({
            account: organizer,
            roleBitmap: P.ROLE_SET_ADDRESS | P.ROLE_SET_ADDRESS_ADMIN | P.ROLE_SET_TEXT_ADMIN
        });
        if (!scoped) grants[1] = ResolverGrant({account: address(r2), roleBitmap: P.ROLE_SET_ADDRESS});
        bytes[] memory calls = new bytes[](0);
        IPermissionedResolver resolver = IPermissionedResolver(
            factory.deployProxy(
                address(impl2),
                ++resolverSalt2,
                abi.encodeCall(IPermissionedResolverInitializable.initialize, (grants, calls))
            )
        );
        if (scoped) {
            vm.prank(organizer);
            resolver.grantSetterRoles(
                abi.encodeCall(IAddressSetter.setAddress, (hex"00", 60, abi.encodePacked(alice2))),
                address(r2)
            );
        }
        return resolver;
    }

    function _configure() internal {
        vm.prank(organizer);
        handoff.configureIssuance(address(hx), address(sx), chief2, "lanyard.eth");
    }

    function _sealed() internal {
        _configure();
        vm.startPrank(organizer);
        r2.bootstrapEdition();
        base.register(
            "mumbai2026",
            address(r2),
            IRegistry(address(r2.edition())),
            address(0),
            r2.editionNameRoles(),
            FAR_FUTURE
        );
        r2.seal();
        vm.stopPrank();
    }

    function _addr(IPermissionedResolver resolver, string memory relative) internal view returns (address) {
        bytes memory name = NameCoder.encode(string.concat(relative, ".mumbai2026.lanyard.eth"));
        return abi.decode(
            resolver.resolve(name, abi.encodeWithSelector(bytes4(keccak256("addr(bytes32)")), bytes32(0))),
            (address)
        );
    }

    function test_bootstrapRefusesToSealOutUnconfiguredA2Authority() public {
        vm.prank(organizer);
        vm.expectRevert(bytes4(keccak256("IssuanceNotConfigured()")));
        r2.bootstrapEdition();
    }

    function test_registrarRuntimeFitsEip170() public view {
        assertLe(address(r2).code.length, 24576, "registrar cannot deploy on Sepolia above EIP-170");
        assertLe(address(r2.registrySetup()).code.length, 24576, "setup companion cannot exceed EIP-170");
    }

    function test_registrySetupHelperCannotBeCalledByOrganizerOrStranger() public {
        address helper = handoff.registrySetup();
        address[2] memory callers = [organizer, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            (bool ok, bytes memory result) = helper.call(
                abi.encodeWithSignature(
                    "createPartner(string,address,uint256)", "evil", address(base), uint256(1)
                )
            );
            assertFalse(ok);
            assertEq(bytes4(result), bytes4(keccak256("NotRegistrar()")));
        }
    }

    function test_configurationIsOrganizerOnlyOneShotAndCannotBeChangedAfterBootstrap() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        handoff.configureIssuance(address(hx), address(sx), chief2, "lanyard.eth");
        _configure();
        vm.startPrank(organizer);
        vm.expectRevert(bytes4(keccak256("IssuanceAlreadyConfigured()")));
        handoff.configureIssuance(address(hx), address(sx), chief2, "lanyard.eth");
        r2.bootstrapEdition();
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Bootstrapped)
        );
        handoff.configureIssuance(address(hx), address(sx), chief2, "lanyard.eth");
        vm.stopPrank();
    }

    function test_configurationRejectsSharedResolversAndIssuerRoleCollisions() public {
        vm.startPrank(organizer);
        vm.expectRevert(bytes4(keccak256("InvalidIssuanceConfiguration()")));
        handoff.configureIssuance(address(hx), address(hx), chief2, "lanyard.eth");
        vm.expectRevert(bytes4(keccak256("InvalidIssuanceConfiguration()")));
        handoff.configureIssuance(address(hx), address(sx), organizer, "lanyard.eth");
        vm.expectRevert(LanyardRegistrar.ZeroAddress.selector);
        handoff.configureIssuance(address(hx), address(sx), address(0), "lanyard.eth");
        vm.stopPrank();
    }

    function test_configurationRejectsResolverWithoutAddressWriteAuthority() public {
        vm.prank(organizer);
        hx.revokeRootRoles(P.ROLE_SET_ADDRESS, address(r2));
        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("MissingAddressAuthority(address)")), address(hx))
        );
        handoff.configureIssuance(address(hx), address(sx), chief2, "lanyard.eth");
    }

    function test_coinScopedAddressAuthorityWorksWithoutTextOrRootAddressPermission() public {
        hx = _newResolver(true);
        sx = _newResolver(true);
        assertFalse(hx.hasRootRoles(P.ROLE_SET_ADDRESS, address(r2)));
        _sealed();
        bytes32 book = r2.HACKERS();
        vm.prank(organizer);
        r2.registerBadge(book, "alice", alice2);
        assertEq(_addr(hx, "alice.hackers"), alice2);
        assertFalse(hx.hasRootRoles(P.ROLE_SET_TEXT, address(r2)));
    }

    function test_badgesUseFixedResolversAndExplicitHolderAddresses() public {
        _sealed();
        bytes32[3] memory books = [r2.HACKERS(), r2.JUDGES(), r2.VOLUNTEERS()];
        string[3] memory labels = ["hackers", "judges", "volunteers"];
        for (uint256 i; i < books.length; ++i) {
            vm.prank(organizer);
            r2.registerBadge(books[i], "alice", alice2);
            IPermissionedResolver expected = i == 0 ? hx : sx;
            assertEq(r2.bookRegistry(books[i]).getResolver("alice"), address(expected));
            assertEq(_addr(expected, string.concat("alice.", labels[i])), alice2);
            assertEq(r2.bookRegistry(books[i]).roleCount(id("alice")), 0);
        }
    }

    function test_headJudgeGrantExistsAtBootstrapWithNoSurvivingAdmin() public {
        _sealed();
        IPermissionedRegistry judges2 = r2.bookRegistry(r2.JUDGES());
        assertEq(judges2.roles(0, chief2), R.ROLE_UNREGISTER);
        assertEq(
            judges2.roleCount(0),
            2 * R.ROLE_REGISTRAR + 2 * R.ROLE_UNREGISTER + 2 * R.ROLE_RENEW + R.ROLE_SET_RESOLVER
        );
        vm.prank(chief2);
        handoff.registerJudge("alice", alice2);
        assertEq(judges2.getOwner(id("alice")), alice2);
        assertEq(judges2.getExpiry(id("alice")), FREEZE_DEADLINE);
        assertEq(_addr(sx, "alice.judges"), alice2);
        vm.prank(chief2);
        judges2.unregister(id("alice"));
        assertEq(judges2.getOwner(id("alice")), address(0));
        vm.prank(chief2);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, R.ROLE_REGISTRAR, chief2
            )
        );
        judges2.register("raw", alice2, IRegistry(address(0)), address(sx), 0, FREEZE_DEADLINE);
    }

    function test_onlyConfiguredHeadJudgeCanUseDelegatedIssuePath() public {
        _sealed();
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("NotHeadJudge(address)")), organizer));
        handoff.registerJudge("alice", alice2);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("NotHeadJudge(address)")), stranger));
        handoff.registerJudge("alice", alice2);
    }

    function test_teamDefaultsToHackersResolverAndLeadAddress() public {
        _sealed();
        vm.prank(organizer);
        (bool ok,) =
            address(r2).call(abi.encodeWithSignature("registerTeam(string,address)", "zkpay", alice2));
        assertTrue(ok);
        assertEq(r2.edition().getResolver("zkpay"), address(hx));
        assertEq(_addr(hx, "zkpay"), alice2);
    }

    function test_failedAddressWriteRollsBackBadgeRegistration() public {
        _sealed();
        bytes32 book = r2.HACKERS();
        vm.prank(organizer);
        hx.revokeRootRoles(P.ROLE_SET_ADDRESS, address(r2));
        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector,
                P.resource(uint256(60)),
                P.ROLE_SET_ADDRESS,
                address(r2)
            )
        );
        r2.registerBadge(book, "alice", alice2);
        assertEq(r2.bookRegistry(book).getOwner(id("alice")), address(0));
    }

    function _onboard(string memory partner, address wallet) internal returns (IPermissionedRegistry) {
        vm.prank(organizer);
        return IPermissionedRegistry(handoff.onboardPartner(partner, wallet));
    }

    function test_partnerStructuralNamesCoverNamespaceAndDelegatesHaveOnlyUnregister() public {
        _sealed();
        IPermissionedRegistry parent2 = _onboard("arkiv", arkiv2);
        assertEq(r2.bookRegistry(r2.PARTNERS()).getExpiry(id("arkiv")), NAMESPACE_EXPIRY);
        assertEq(_addr(sx, "arkiv.partners"), arkiv2);
        bytes32[2] memory subs = [r2.JUDGES(), STAFF_SUB];
        string[2] memory names = ["judges", "staff"];
        for (uint256 i; i < 2; ++i) {
            IPermissionedRegistry book = handoff.partnerBookRegistry(keccak256("arkiv"), subs[i]);
            assertEq(parent2.getExpiry(id(names[i])), NAMESPACE_EXPIRY);
            assertEq(address(parent2.getSubregistry(names[i])), address(book));
            assertEq(book.roles(0, arkiv2), R.ROLE_UNREGISTER);
            assertEq(book.roles(0, address(r2)), R.ROLE_REGISTRAR | R.ROLE_RENEW);
            assertEq(
                book.roleCount(0),
                2 * R.ROLE_REGISTRAR + 2 * R.ROLE_UNREGISTER + 2 * R.ROLE_RENEW + R.ROLE_SET_RESOLVER
            );
        }
    }

    function test_partnerJudgeAndStaffIssuesHaveSeparatePolicyExpiriesAndAddresses() public {
        _sealed();
        _onboard("arkiv", arkiv2);
        bytes32 partner = keccak256("arkiv");
        vm.startPrank(arkiv2);
        handoff.registerPartnerBadge(partner, r2.JUDGES(), "alice", alice2);
        handoff.registerPartnerBadge(partner, STAFF_SUB, "alice", alice2);
        vm.stopPrank();
        IPermissionedRegistry judges2 = handoff.partnerBookRegistry(partner, r2.JUDGES());
        IPermissionedRegistry staff2 = handoff.partnerBookRegistry(partner, STAFF_SUB);
        assertEq(judges2.getExpiry(id("alice")), FREEZE_DEADLINE);
        assertEq(staff2.getExpiry(id("alice")), EVENT_END);
        assertEq(judges2.roleCount(id("alice")), 0);
        assertEq(staff2.getResolver("alice"), address(sx));
        assertEq(_addr(sx, "alice.judges.arkiv.partners"), alice2);
        assertEq(_addr(sx, "alice.staff.arkiv.partners"), alice2);
    }

    function test_partnerCannotIssueForNeighbourOrUseRawRegister() public {
        _sealed();
        _onboard("arkiv", arkiv2);
        _onboard("ens", ens2);
        IPermissionedRegistry staff2 = handoff.partnerBookRegistry(keccak256("arkiv"), STAFF_SUB);
        bytes32 volunteers2 = r2.VOLUNTEERS();
        vm.startPrank(arkiv2);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("NotPartner(address)")), arkiv2));
        handoff.registerPartnerBadge(keccak256("ens"), STAFF_SUB, "alice", alice2);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("InvalidPartnerBook(bytes32)")), volunteers2));
        handoff.registerPartnerBadge(keccak256("arkiv"), volunteers2, "alice", alice2);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, R.ROLE_REGISTRAR, arkiv2
            )
        );
        staff2.register("raw", alice2, IRegistry(address(0)), address(sx), 0, EVENT_END);
        vm.stopPrank();
    }

    function test_partnerStaffCanBeRevivedOnlyByOrganizerWithoutChangingIdentity() public {
        _sealed();
        _onboard("arkiv", arkiv2);
        bytes32 partner = keccak256("arkiv");
        vm.prank(arkiv2);
        handoff.registerPartnerBadge(partner, STAFF_SUB, "alice", alice2);
        IPermissionedRegistry staff2 = handoff.partnerBookRegistry(partner, STAFF_SUB);
        vm.warp(EVENT_END);
        assertEq(staff2.getOwner(id("alice")), address(0));
        vm.prank(arkiv2);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, arkiv2));
        handoff.renewPartnerBadge(partner, STAFF_SUB, "alice", FREEZE_DEADLINE);
        vm.prank(organizer);
        handoff.renewPartnerBadge(partner, STAFF_SUB, "alice", FREEZE_DEADLINE);
        assertEq(staff2.getOwner(id("alice")), alice2);
        assertEq(staff2.getExpiry(id("alice")), FREEZE_DEADLINE);
        assertEq(staff2.roleCount(id("alice")), 0);
    }

    function test_rawOrganizerBadgeCanInitializeAddressWithoutGivingHolderResolverAuthority() public {
        _sealed();
        bytes32 book = r2.HACKERS();
        IPermissionedRegistry hackers2 = r2.bookRegistry(book);
        vm.startPrank(organizer);
        hackers2.register("raw", alice2, IRegistry(address(0)), address(hx), 0, EVENT_END + 7 days);
        handoff.initializeBadgeAddress(book, "raw");
        vm.stopPrank();
        assertEq(_addr(hx, "raw.hackers"), alice2);
        vm.prank(alice2);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, alice2));
        handoff.initializeBadgeAddress(book, "raw");
    }

    function test_replacedPartnerParentCannotKeepAuthorizingItsOldSubBooks() public {
        _sealed();
        _onboard("arkiv", arkiv2);
        IPermissionedRegistry partners2 = r2.bookRegistry(r2.PARTNERS());
        vm.startPrank(organizer);
        partners2.unregister(id("arkiv"));
        partners2.register("arkiv", arkiv2, IRegistry(address(0)), address(sx), 0, NAMESPACE_EXPIRY);
        vm.stopPrank();
        vm.prank(arkiv2);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("PartnerHierarchyChanged(bytes32)")), keccak256("arkiv"))
        );
        handoff.registerPartnerBadge(keccak256("arkiv"), STAFF_SUB, "alice", alice2);
    }

    function test_rawPartnerBadgeAddressInitializationUsesItsOwnNamespaceOnly() public {
        _sealed();
        _onboard("arkiv", arkiv2);
        IPermissionedRegistry staff2 = handoff.partnerBookRegistry(keccak256("arkiv"), STAFF_SUB);
        vm.startPrank(organizer);
        staff2.register("raw", alice2, IRegistry(address(0)), address(sx), 0, EVENT_END);
        handoff.initializePartnerBadgeAddress(keccak256("arkiv"), STAFF_SUB, "raw");
        vm.stopPrank();
        assertEq(_addr(sx, "raw.staff.arkiv.partners"), alice2);
        vm.prank(arkiv2);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, arkiv2));
        handoff.initializePartnerBadgeAddress(keccak256("arkiv"), STAFF_SUB, "raw");
    }

    function test_partnerBadgeEventIncludesItsCompleteBookScope() public {
        _sealed();
        _onboard("arkiv", arkiv2);
        vm.expectEmit(true, true, false, true, address(r2));
        emit BadgeIssued(keccak256("staff.arkiv.partners"), "alice", alice2, EVENT_END);
        vm.prank(arkiv2);
        handoff.registerPartnerBadge(keccak256("arkiv"), STAFF_SUB, "alice", alice2);
    }
}
