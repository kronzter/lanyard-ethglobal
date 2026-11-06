// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {TeamFixture} from "./TeamRegistration.t.sol";
import {Resolver} from "./EditionBootstrap.t.sol";

interface IWinnerForwarders {
    function setWinnerRegistrar(address winner) external;
    function winnerRegistrar() external view returns (address);
    function promoteWinner(string calldata team, address lead, uint64 expiry) external;
    function renewWinningTeam(string calldata team, uint64 expiry) external;
}

contract WinnerCaller {
    function promote(IWinnerForwarders registrar, string calldata team, address lead, uint64 expiry)
        external
    {
        registrar.promoteWinner(team, lead, expiry);
    }

    function renew(IWinnerForwarders registrar, string calldata team, uint64 expiry) external {
        registrar.renewWinningTeam(team, expiry);
    }
}

contract WinnerForwardersTest is TeamFixture {
    IWinnerForwarders internal forwarders;
    WinnerCaller internal winner;
    address internal resolver;
    IPermissionedRegistry internal child;

    function _configure() internal {
        forwarders = IWinnerForwarders(address(registrar));
        winner = new WinnerCaller();
        resolver = address(new Resolver());
        vm.startPrank(organizer);
        registrar.setPublicationResolver(resolver);
        forwarders.setWinnerRegistrar(address(winner));
        vm.stopPrank();
    }

    function test_teamCreatedBeforeWinnerContractWorksWithoutRoleBackfill() public {
        child = _register("zkpay", lead);
        uint256 rolesBefore = child.roleCount(0);
        _configure();
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        winner.renew(forwarders, "zkpay", FAR_FUTURE);
        assertEq(child.getOwner(id("winner")), lead);
        assertEq(child.getExpiry(id("winner")), FAR_FUTURE);
        assertEq(child.getResolver("winner"), resolver);
        assertEq(address(child.getSubregistry("winner")), address(0));
        // ENSv2 adds a non-authorizing WAS_RESERVED marker even when the supplied bitmap is zero.
        assertEq(child.roles(id("winner"), lead), R.ROLE_WAS_RESERVED);
        assertEq(child.roleCount(id("winner")), R.ROLE_WAS_RESERVED);
        assertEq(child.roleCount(0), rolesBefore);
        assertEq(edition.getExpiry(id("zkpay")), FAR_FUTURE);
        assertEq(edition.getOwner(id("zkpay")), lead);
    }

    function test_winnerConfigurationIsOneShotOrganizerOnlyAndRequiresCode() public {
        forwarders = IWinnerForwarders(address(registrar));
        winner = new WinnerCaller();
        address second = address(new WinnerCaller());
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LanyardRegistrar.NotOrganizer.selector, stranger));
        forwarders.setWinnerRegistrar(address(winner));
        vm.startPrank(organizer);
        vm.expectRevert(LanyardRegistrar.ZeroAddress.selector);
        forwarders.setWinnerRegistrar(address(0));
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("WinnerRegistrarHasNoCode(address)")), stranger)
        );
        forwarders.setWinnerRegistrar(stranger);
        forwarders.setWinnerRegistrar(address(winner));
        vm.expectRevert(bytes4(keccak256("WinnerRegistrarAlreadySet()")));
        forwarders.setWinnerRegistrar(second);
        vm.stopPrank();
        assertEq(forwarders.winnerRegistrar(), address(winner));
    }

    function test_winnerConfigurationRequiresSealedEdition() public {
        LanyardRegistrar fresh = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "other2026", EVENT_END, FREEZE_DEADLINE
        );
        address caller = address(new WinnerCaller());
        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(LanyardRegistrar.WrongPhase.selector, LanyardRegistrar.Phase.Created)
        );
        IWinnerForwarders(address(fresh)).setWinnerRegistrar(caller);
    }

    function test_bothForwardersRejectOrganizerLeadAndStranger() public {
        _register("zkpay", lead);
        _configure();
        address[3] memory callers = [organizer, lead, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            bytes memory err =
                abi.encodeWithSelector(bytes4(keccak256("NotWinnerRegistrar(address)")), callers[i]);
            vm.expectRevert(err);
            forwarders.promoteWinner("zkpay", lead, FAR_FUTURE);
            vm.expectRevert(err);
            forwarders.renewWinningTeam("zkpay", FAR_FUTURE);
            vm.stopPrank();
        }
    }

    function test_unconfiguredResolverCannotBeUsedForPromotion() public {
        _register("zkpay", lead);
        forwarders = IWinnerForwarders(address(registrar));
        winner = new WinnerCaller();
        vm.prank(organizer);
        forwarders.setWinnerRegistrar(address(winner));
        vm.expectRevert(bytes4(keccak256("PublicationResolverNotSet()")));
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
    }

    function test_unknownTeamsAndWrongLeadAreRejected() public {
        _register("zkpay", lead);
        _configure();
        bytes memory unknown =
            abi.encodeWithSelector(bytes4(keccak256("UnknownTeam(bytes32)")), keccak256("missing"));
        vm.expectRevert(unknown);
        winner.promote(forwarders, "missing", lead, FAR_FUTURE);
        vm.expectRevert(unknown);
        winner.renew(forwarders, "missing", FAR_FUTURE);
        vm.expectRevert(bytes4(keccak256("InvalidTeamLead()")));
        winner.promote(forwarders, "zkpay", stranger, FAR_FUTURE);
    }

    function test_promotionRequiresAFarFutureWinnerExpiry() public {
        // A lapsed winner could be re-registered by the lead (root REGISTRAR on the team registry), so
        // the registrar only promotes with the far-future expiry A4.1 specifies.
        child = _register("zkpay", lead);
        _configure();
        uint64[4] memory expiries = [0, uint64(block.timestamp), uint64(block.timestamp + 10), FAR_FUTURE - 1];
        for (uint256 i; i < expiries.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(bytes4(keccak256("WinnerExpiryNotFarFuture(uint64)")), expiries[i])
            );
            winner.promote(forwarders, "zkpay", lead, expiries[i]);
        }
        assertEq(uint8(child.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
    }

    function test_secondPromotionCannotOverwriteTheWinner() public {
        child = _register("zkpay", lead);
        _configure();
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("WinnerNotReserved(bytes32)")), keccak256("zkpay"))
        );
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        assertEq(child.getOwner(id("winner")), lead);
    }

    function test_promotedWinnerNeverLapsesForTheLeadToReissue() public {
        child = _register("zkpay", lead);
        _configure();
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        vm.warp(uint256(FAR_FUTURE) - 1);
        vm.prank(lead);
        vm.expectRevert();
        child.register("winner", stranger, IRegistry(address(0)), address(0), 0, FAR_FUTURE);
        assertEq(child.getOwner(id("winner")), lead);
    }

    function test_renewalCanReviveExpiredOriginalTeamWithSameLeadAndChild() public {
        child = _register("zkpay", lead);
        _configure();
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        vm.warp(NAMESPACE_EXPIRY);
        assertEq(edition.getOwner(id("zkpay")), address(0));
        winner.renew(forwarders, "zkpay", FAR_FUTURE);
        assertEq(edition.getOwner(id("zkpay")), lead);
        assertEq(address(edition.getSubregistry("zkpay")), address(child));
        assertEq(edition.getExpiry(id("zkpay")), FAR_FUTURE);
    }

    function test_renewalRefusesToShortenParentOrUsePastExpiry() public {
        _register("zkpay", lead);
        _configure();
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.RenewalNotLonger.selector, NAMESPACE_EXPIRY - 1, NAMESPACE_EXPIRY
            )
        );
        winner.renew(forwarders, "zkpay", NAMESPACE_EXPIRY - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                LanyardRegistrar.RenewalNotInFuture.selector, uint64(block.timestamp), uint64(block.timestamp)
            )
        );
        winner.renew(forwarders, "zkpay", uint64(block.timestamp));
        // Matching renewal is a harmless no-op for resume reconciliation.
        winner.renew(forwarders, "zkpay", NAMESPACE_EXPIRY);
    }

    function test_forwardersRejectAReplacedRegistrationEvenWithSameLead() public {
        _register("zkpay", lead);
        _configure();
        // Simulate an invalidated registry identity using the stable registrar's own raw root role.
        vm.warp(NAMESPACE_EXPIRY);
        vm.prank(address(registrar));
        edition.register("zkpay", lead, IRegistry(address(0)), address(0), 0, FAR_FUTURE);
        bytes memory err =
            abi.encodeWithSelector(bytes4(keccak256("TeamIdentityChanged(bytes32)")), keccak256("zkpay"));
        vm.expectRevert(err);
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        vm.expectRevert(err);
        winner.renew(forwarders, "zkpay", FAR_FUTURE);
    }

    function test_leadCannotRevokeNameRolesAndForwardingKeepsOriginalIdentity() public {
        child = _register("zkpay", lead);
        _configure();
        uint256 originalToken = edition.getTokenId(id("zkpay"));
        uint256 resource = edition.getResource(id("zkpay"));
        vm.prank(lead);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("EACCannotRevokeRoles(uint256,uint256,address)")),
                resource,
                R.ROLE_SET_RESOLVER,
                lead
            )
        );
        edition.revokeRoles(id("zkpay"), R.ROLE_SET_RESOLVER, lead);
        assertEq(edition.getTokenId(id("zkpay")), originalToken);
        winner.promote(forwarders, "zkpay", lead, FAR_FUTURE);
        winner.renew(forwarders, "zkpay", FAR_FUTURE);
        assertEq(child.getOwner(id("winner")), lead);
    }
}
