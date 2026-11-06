// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {ITextResolver} from "@ens/contracts/resolvers/profiles/ITextResolver.sol";
import {ITextSetter} from "ens-v2/resolver/interfaces/setters/ITextSetter.sol";
import {Grant} from "ens-v2/access-control/interfaces/IEACGrantInitializable.sol";
import {IEnhancedAccessControl} from "ens-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "ens-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "ens-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "ens-v2/registry/libraries/RegistryRolesLib.sol";
import {PermissionedResolver} from "ens-v2/resolver/PermissionedResolver.sol";
import {IPermissionedResolver} from "ens-v2/resolver/interfaces/IPermissionedResolver.sol";
import {
    IPermissionedResolverInitializable
} from "ens-v2/resolver/interfaces/IPermissionedResolverInitializable.sol";
import {PermissionedResolverLib as P} from "ens-v2/resolver/libraries/PermissionedResolverLib.sol";
import {LibResolution} from "ens-v2/universalResolver/libraries/LibResolution.sol";
import {LanyardRegistrar} from "../../src/ens/LanyardRegistrar.sol";
import {WinnerRegistrar} from "../../src/ens/WinnerRegistrar.sol";
import {EnsFixture} from "./helpers/EnsFixture.sol";
import {WinnerCaller, IWinnerForwarders} from "./WinnerForwarders.t.sol";

interface IUpgradeable {
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
}

/// The edition, two teams and the real publication resolver, deployed with the organizer holding exactly
/// PUBLICATION_ORGANIZER_RESOLVER_ROLES (src/ens/issuance-plan.ts), as scripts/ens/deploy-resolvers.ts does.
abstract contract PublicationFixture is EnsFixture {
    uint256 internal constant PUBLICATION_ROLES = P.ROLE_SET_TEXT | P.ROLE_SET_TEXT_ADMIN | P.ROLE_LINK
        | P.ROLE_LINK_ADMIN | P.ROLE_UPGRADE | P.ROLE_UPGRADE_ADMIN;
    string internal constant EDITION_NAME = "mumbai2026.lanyard.eth";

    LanyardRegistrar internal registrar;
    IPermissionedRegistry internal edition;
    IPermissionedResolver internal pub;
    IPermissionedRegistry internal zkpay;
    IPermissionedRegistry internal rollup;
    address internal lead = makeAddr("team-lead");
    address internal lead2 = makeAddr("team-lead-2");
    address internal results = makeAddr("results-wallet");

    function _buildEdition() internal {
        setUpEns();
        registrar = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "mumbai2026", EVENT_END, FREEZE_DEADLINE
        );
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
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: organizer, roleBitmap: PUBLICATION_ROLES});
        pub = IPermissionedResolver(
            factory.deployProxy(
                address(permissionedResolverImpl),
                uint256(keccak256("publication")),
                abi.encodeCall(IPermissionedResolverInitializable.initialize, (grants, new bytes[](0)))
            )
        );
        registrar.setPublicationResolver(address(pub));
        // Both teams predate the WinnerRegistrar: no role backfill is needed (A4.1-R5).
        zkpay = IPermissionedRegistry(registrar.registerTeam("zkpay", lead));
        rollup = IPermissionedRegistry(registrar.registerTeam("rollup", lead2));
        vm.stopPrank();
    }

    function _name(string memory relative) internal pure returns (bytes memory) {
        return NameCoder.encode(
            bytes(relative).length == 0 ? EDITION_NAME : string.concat(relative, ".", EDITION_NAME)
        );
    }

    function _text(string memory relative, string memory key) internal view returns (string memory) {
        return abi.decode(
            pub.resolve(_name(relative), abi.encodeCall(ITextResolver.text, (bytes32(0), key))), (string)
        );
    }
}

/// A4.1/A4.2 contract half and the A4 phase bug hunt's contract items.
contract WinnerRegistrarTest is PublicationFixture {
    WinnerRegistrar internal wr;

    event EventResultsSet(
        bytes32 indexed eventHash,
        string edition,
        bytes32 resultsKey,
        bytes32 resultsHash,
        bytes32 bundleHash,
        string bundleUri
    );
    event WinnerDeclared(bytes32 indexed teamHash, string team, string[] prizes, bytes32 declarationHash);
    event ResultsLockedAt(bytes32 indexed stateHash);

    function setUp() public {
        _buildEdition();
        wr = new WinnerRegistrar(registrar, results);
        // A4.1-R5 handoff: configure the forwarders, move the complete inventory, drop the organizer's.
        vm.startPrank(organizer);
        registrar.setWinnerRegistrar(address(wr));
        pub.grantRootRoles(PUBLICATION_ROLES, address(wr));
        pub.revokeRootRoles(PUBLICATION_ROLES, organizer);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _pub() internal pure returns (WinnerRegistrar.PublicationInput memory) {
        return WinnerRegistrar.PublicationInput({
            edition: "mumbai2026",
            resultsKey: keccak256("results-entity"),
            resultsHash: keccak256("results-body"),
            bundleHash: keccak256("bundle-body"),
            bundleUri: "https://evidence.example/mumbai2026/bundle.json"
        });
    }

    function _win(string memory team, string[] memory prizes)
        internal
        pure
        returns (WinnerRegistrar.WinnerInput memory w)
    {
        WinnerRegistrar.PublicationInput memory p = _pub();
        w = WinnerRegistrar.WinnerInput(
            p.edition, p.resultsKey, p.resultsHash, p.bundleHash, p.bundleUri, team, prizes
        );
    }

    function _one(string memory a) internal pure returns (string[] memory list) {
        list = new string[](1);
        list[0] = a;
    }

    function _two(string memory a, string memory b) internal pure returns (string[] memory list) {
        list = new string[](2);
        (list[0], list[1]) = (a, b);
    }

    function _publish() internal {
        vm.prank(results);
        wr.setEventResults(_pub());
    }

    function _declare(WinnerRegistrar.WinnerInput memory w) internal {
        vm.prank(results);
        wr.declare(w);
    }

    /// Independent implementation of the documented state hash.
    function _expectedState(WinnerRegistrar.WinnerInput[] memory sortedWinners)
        internal
        pure
        returns (bytes32)
    {
        bytes32[] memory hashes = new bytes32[](sortedWinners.length);
        for (uint256 i; i < hashes.length; ++i) {
            hashes[i] = keccak256(abi.encode(sortedWinners[i]));
        }
        return keccak256(
            abi.encode(keccak256("lanyard.publication-state/1"), keccak256(abi.encode(_pub())), hashes)
        );
    }

    function _publishDeclareBoth() internal returns (bytes32) {
        _publish();
        WinnerRegistrar.WinnerInput memory z = _win("zkpay", _one("winner"));
        WinnerRegistrar.WinnerInput memory r = _win("rollup", _one("runner-up"));
        _declare(z);
        _declare(r);
        WinnerRegistrar.WinnerInput[] memory sorted = new WinnerRegistrar.WinnerInput[](2);
        (sorted[0], sorted[1]) = (r, z); // "rollup" < "zkpay"
        return _expectedState(sorted);
    }

    function _lock(bytes32 expected) internal {
        vm.prank(results);
        wr.lockResults(expected);
    }

    // ---------------------------------------------------------------- deployment and handoff

    function test_constructionDerivesEditionAndResolver() public view {
        assertEq(address(wr.registrar()), address(registrar));
        assertEq(address(wr.publicationResolver()), address(pub));
        assertEq(wr.resultsWallet(), results);
        assertEq(wr.editionLabel(), "mumbai2026");
        assertEq(wr.editionName(), EDITION_NAME);
        assertEq(wr.RESOLVER_ROLES(), PUBLICATION_ROLES);
        assertFalse(wr.locked());
    }

    function test_constructionRejectsZeroOrganizerAndMissingResolver() public {
        vm.expectRevert(WinnerRegistrar.ZeroAddress.selector);
        new WinnerRegistrar(registrar, address(0));
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.InvalidResultsWallet.selector, organizer));
        new WinnerRegistrar(registrar, organizer);
        LanyardRegistrar fresh = new LanyardRegistrar(
            organizer, factory, address(userRegistryImpl), base, "other2026", EVENT_END, FREEZE_DEADLINE
        );
        vm.expectRevert(WinnerRegistrar.PublicationResolverNotSet.selector);
        new WinnerRegistrar(fresh, results);
    }

    function test_handoffLeavesTheContractAsSoleHolder() public view {
        assertEq(pub.roleCount(0), PUBLICATION_ROLES);
        assertEq(pub.roles(0, address(wr)), PUBLICATION_ROLES);
        assertEq(pub.roles(0, organizer), 0);
        assertEq(registrar.winnerRegistrar(), address(wr));
        assertTrue(wr.grantInventorySealed());
    }

    function test_resultsWalletHasNoDirectResolverAuthority() public {
        vm.prank(results);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector,
                uint256(keccak256("lanyard.results")),
                P.ROLE_SET_TEXT,
                results
            )
        );
        pub.setText(_name(""), "lanyard.results", "0x00");
    }

    // ---------------------------------------------------------------- setEventResults

    function test_setEventResultsWritesTheEditionCommitment() public {
        WinnerRegistrar.PublicationInput memory p = _pub();
        bytes32 hash = keccak256(abi.encode(p));
        vm.expectEmit(address(wr));
        emit EventResultsSet(hash, p.edition, p.resultsKey, p.resultsHash, p.bundleHash, p.bundleUri);
        _publish();
        assertEq(_text("", "lanyard.results"), vm.toString(p.resultsKey));
        assertEq(_text("", "lanyard.results-hash"), vm.toString(p.resultsHash));
        assertEq(_text("", "lanyard.bundle-hash"), vm.toString(p.bundleHash));
        assertEq(_text("", "lanyard.bundle-uri"), p.bundleUri);
        assertEq(_text("", "lanyard.edition"), "mumbai2026");
        (bool set, WinnerRegistrar.PublicationInput memory stored) = wr.eventResults();
        assertTrue(set);
        assertEq(keccak256(abi.encode(stored)), hash);
        assertEq(wr.eventHash(), hash);
        // The edition name resolves through the registry tree to the publication resolver.
        (, address resolver,,) =
            LibResolution.findResolver(IRegistry(address(base)), NameCoder.encode("mumbai2026"), 0);
        assertEq(resolver, address(pub));
    }

    function test_setEventResultsIsResultsWalletOnly() public {
        address[4] memory callers = [organizer, stranger, lead, address(registrar)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.NotResultsWallet.selector, callers[i]));
            wr.setEventResults(_pub());
        }
    }

    function test_repeatedOrConflictingEventResultsRevert() public {
        _publish();
        WinnerRegistrar.PublicationInput memory other = _pub();
        other.resultsHash = keccak256("other");
        vm.startPrank(results);
        vm.expectRevert(WinnerRegistrar.EventResultsAlreadySet.selector);
        wr.setEventResults(_pub());
        vm.expectRevert(WinnerRegistrar.EventResultsAlreadySet.selector);
        wr.setEventResults(other);
        vm.stopPrank();
        assertEq(_text("", "lanyard.results-hash"), vm.toString(_pub().resultsHash));
    }

    function test_eventResultsRejectWrongEditionAndZeroHashes() public {
        WinnerRegistrar.PublicationInput memory p = _pub();
        vm.startPrank(results);
        p.edition = "Mumbai2026";
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.WrongEdition.selector, "Mumbai2026"));
        wr.setEventResults(p);
        p = _pub();
        p.resultsKey = 0;
        vm.expectRevert(WinnerRegistrar.ZeroCommitment.selector);
        wr.setEventResults(p);
        p = _pub();
        p.resultsHash = 0;
        vm.expectRevert(WinnerRegistrar.ZeroCommitment.selector);
        wr.setEventResults(p);
        p = _pub();
        p.bundleHash = 0;
        vm.expectRevert(WinnerRegistrar.ZeroCommitment.selector);
        wr.setEventResults(p);
        vm.stopPrank();
    }

    function test_bundleUriMustBeBoundedHttps() public {
        string memory long = "https://e.example/";
        while (bytes(long).length < 2048) long = string.concat(long, "a");
        string[8] memory bad = [
            "",
            "https://",
            "http://evidence.example/b.json",
            "HTTPS://evidence.example/b.json",
            "ipfs://bafy",
            "https://evidence.example/a b.json",
            "https://evidence.example/\nb",
            string.concat(long, "a")
        ];
        vm.startPrank(results);
        for (uint256 i; i < bad.length; ++i) {
            WinnerRegistrar.PublicationInput memory p = _pub();
            p.bundleUri = bad[i];
            vm.expectRevert(WinnerRegistrar.InvalidBundleUri.selector);
            wr.setEventResults(p);
        }
        WinnerRegistrar.PublicationInput memory ok = _pub();
        ok.bundleUri = long;
        assertEq(bytes(long).length, 2048);
        wr.setEventResults(ok);
        vm.stopPrank();
        assertEq(_text("", "lanyard.bundle-uri"), long);
    }

    // ---------------------------------------------------------------- declare

    function test_declarePromotesRenewsAndWritesWinnerRecords() public {
        _publish();
        WinnerRegistrar.WinnerInput memory w = _win("zkpay", _one("runner-up"));
        bytes32 hash = keccak256(abi.encode(w));
        vm.expectEmit(address(wr));
        emit WinnerDeclared(keccak256("zkpay"), "zkpay", w.prizes, hash);
        _declare(w);

        assertEq(zkpay.getOwner(id("winner")), lead);
        assertEq(zkpay.getExpiry(id("winner")), FAR_FUTURE);
        assertEq(zkpay.getResolver("winner"), address(pub));
        assertEq(edition.getExpiry(id("zkpay")), FAR_FUTURE);
        assertEq(_text("winner.zkpay", "lanyard.prizes"), '["runner-up"]');
        assertEq(_text("winner.zkpay", "lanyard.results"), vm.toString(w.resultsKey));
        assertEq(_text("winner.zkpay", "lanyard.results-hash"), vm.toString(w.resultsHash));
        assertEq(_text("winner.zkpay", "lanyard.bundle-hash"), vm.toString(w.bundleHash));
        assertEq(_text("winner.zkpay", "lanyard.edition"), "mumbai2026");

        assertEq(wr.declarationHash(keccak256("zkpay")), hash);
        assertEq(keccak256(abi.encode(wr.winner("zkpay"))), hash);
        string[] memory teams = wr.declaredTeams();
        assertEq(teams.length, 1);
        assertEq(teams[0], "zkpay");
        assertEq(wr.prizeHolder("runner-up"), "zkpay");
        assertEq(wr.prizeHolder("winner"), "");
    }

    function test_oneTeamCanHoldBothPrizesUnderOneName() public {
        _publish();
        WinnerRegistrar.WinnerInput memory w = _win("zkpay", _two("runner-up", "winner"));
        _declare(w);
        assertEq(_text("winner.zkpay", "lanyard.prizes"), '["runner-up","winner"]');
        assertEq(keccak256(abi.encode(wr.winner("zkpay"))), keccak256(abi.encode(w)));
        vm.prank(results);
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.PrizeAlreadyAwarded.selector, "winner"));
        wr.declare(_win("rollup", _one("winner")));
    }

    function test_declareRequiresEventResults() public {
        vm.prank(results);
        vm.expectRevert(WinnerRegistrar.EventResultsNotSet.selector);
        wr.declare(_win("zkpay", _one("winner")));
    }

    function test_randomCallerCannotDeclare() public {
        _publish();
        address[4] memory callers = [organizer, stranger, lead, address(registrar)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.NotResultsWallet.selector, callers[i]));
            wr.declare(_win("zkpay", _one("winner")));
        }
        assertEq(uint8(zkpay.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
    }

    function test_duplicateDeclareReverts() public {
        _publish();
        _declare(_win("zkpay", _one("runner-up")));
        vm.startPrank(results);
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.AlreadyDeclared.selector, "zkpay"));
        wr.declare(_win("zkpay", _one("runner-up")));
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.AlreadyDeclared.selector, "zkpay"));
        wr.declare(_win("zkpay", _one("winner")));
        vm.stopPrank();
    }

    function test_eachPrizeGoesToAtMostOneTeam() public {
        _publish();
        _declare(_win("zkpay", _one("winner")));
        vm.startPrank(results);
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.PrizeAlreadyAwarded.selector, "winner"));
        wr.declare(_win("rollup", _one("winner")));
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.PrizeAlreadyAwarded.selector, "winner"));
        wr.declare(_win("rollup", _two("runner-up", "winner")));
        wr.declare(_win("rollup", _one("runner-up")));
        vm.stopPrank();
        assertEq(wr.prizeHolder("winner"), "zkpay");
        assertEq(wr.prizeHolder("runner-up"), "rollup");
    }

    function test_prizeListMustBeANonEmptySortedSubset() public {
        _publish();
        vm.startPrank(results);
        vm.expectRevert(WinnerRegistrar.NoPrizes.selector);
        wr.declare(_win("zkpay", new string[](0)));
        string[5] memory unknown = ["", "Winner", "winner ", "Arkiv track, 1st", "runner-up,winner"];
        for (uint256 i; i < unknown.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.UnknownPrize.selector, unknown[i]));
            wr.declare(_win("zkpay", _one(unknown[i])));
        }
        vm.expectRevert(WinnerRegistrar.PrizesNotCanonical.selector);
        wr.declare(_win("zkpay", _two("winner", "winner")));
        vm.expectRevert(WinnerRegistrar.PrizesNotCanonical.selector);
        wr.declare(_win("zkpay", _two("winner", "runner-up")));
        string[] memory three = new string[](3);
        (three[0], three[1], three[2]) = ("runner-up", "winner", "winner");
        vm.expectRevert(WinnerRegistrar.PrizesNotCanonical.selector);
        wr.declare(_win("zkpay", three));
        vm.stopPrank();
        assertEq(uint8(zkpay.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
    }

    function test_declarationMustMatchTheStoredEventCommitment() public {
        _publish();
        bytes32 expected = wr.eventHash();
        WinnerRegistrar.WinnerInput[5] memory bad;
        for (uint256 i; i < 5; ++i) {
            bad[i] = _win("zkpay", _one("winner"));
        }
        bad[0].edition = "other2026";
        bad[1].resultsKey = keccak256("wrong");
        bad[2].resultsHash = keccak256("wrong");
        bad[3].bundleHash = keccak256("wrong");
        bad[4].bundleUri = "https://evidence.example/other.json";
        vm.startPrank(results);
        for (uint256 i; i < 5; ++i) {
            bytes32 actual = keccak256(
                abi.encode(
                    WinnerRegistrar.PublicationInput(
                        bad[i].edition,
                        bad[i].resultsKey,
                        bad[i].resultsHash,
                        bad[i].bundleHash,
                        bad[i].bundleUri
                    )
                )
            );
            vm.expectRevert(
                abi.encodeWithSelector(WinnerRegistrar.PublicationMismatch.selector, expected, actual)
            );
            wr.declare(bad[i]);
        }
        vm.stopPrank();
    }

    function test_unknownAndNonCanonicalTeamLabelsRevert() public {
        _publish();
        string[3] memory labels = ["missing", "ZkPay", "zkpay "];
        vm.startPrank(results);
        for (uint256 i; i < labels.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(LanyardRegistrar.UnknownTeam.selector, keccak256(bytes(labels[i])))
            );
            wr.declare(_win(labels[i], _one("winner")));
        }
        vm.stopPrank();
        // A failed declaration claims nothing.
        assertEq(wr.prizeHolder("winner"), "");
        assertEq(wr.declaredTeams().length, 0);
    }

    function test_notDeclaredTeamHasNoWinnerView() public {
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.NotDeclared.selector, "zkpay"));
        wr.winner("zkpay");
    }

    // ---------------------------------------------------------------- the winner name

    function test_leadCannotRegisterOrUnregisterTheReservedWinner() public {
        vm.startPrank(lead);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, R.ROLE_REGISTER_RESERVED, lead
            )
        );
        zkpay.register("winner", lead, IRegistry(address(0)), address(0), 0, FAR_FUTURE);
        vm.expectRevert();
        zkpay.unregister(id("winner"));
        vm.stopPrank();
        assertEq(uint8(zkpay.getStatus(id("winner"))), uint8(IPermissionedRegistry.Status.RESERVED));
    }

    function test_winnerNameCannotBeTransferredReresolvedOrUnregistered() public {
        _publish();
        _declare(_win("zkpay", _one("winner")));
        assertEq(zkpay.roles(id("winner"), lead), R.ROLE_WAS_RESERVED);
        assertEq(zkpay.roleCount(id("winner")), R.ROLE_WAS_RESERVED);
        uint256 tokenId = zkpay.getTokenId(id("winner"));
        vm.startPrank(lead);
        vm.expectRevert();
        zkpay.safeTransferFrom(lead, stranger, tokenId, 1, "");
        vm.expectRevert();
        zkpay.setResolver(id("winner"), stranger);
        vm.expectRevert();
        zkpay.setSubregistry(id("winner"), IRegistry(stranger));
        vm.expectRevert();
        zkpay.unregister(id("winner"));
        vm.expectRevert();
        zkpay.register("winner", stranger, IRegistry(address(0)), address(0), 0, FAR_FUTURE);
        vm.stopPrank();
        assertEq(zkpay.getOwner(id("winner")), lead);
        assertEq(zkpay.getResolver("winner"), address(pub));
    }

    function test_declaredWinnerKeepsResolvingAfterTheNamespaceExpiry() public {
        _publish();
        _declare(_win("zkpay", _one("winner")));
        _lock(wr.stateHash());
        vm.warp(NAMESPACE_EXPIRY + 365 days);
        assertEq(edition.getOwner(id("zkpay")), lead);
        bytes memory name = NameCoder.encode("winner.zkpay.mumbai2026");
        (IRegistry exact, address resolver,, uint256 offset) =
            LibResolution.findResolver(IRegistry(address(base)), name, 0);
        assertEq(address(exact), address(0)); // the winner has no subregistry
        assertEq(resolver, address(pub));
        assertEq(offset, 0); // found at the leaf, not by wildcard from a parent
        assertEq(LibResolution.findExactOwner(IRegistry(address(base)), name, 0), lead);
        assertEq(_text("winner.zkpay", "lanyard.prizes"), '["winner"]');
    }

    // ---------------------------------------------------------------- lockResults

    function test_lockComparesStateRevokesEverythingAndSetsLocked() public {
        bytes32 expected = _publishDeclareBoth();
        assertEq(wr.stateHash(), expected);
        vm.expectEmit(address(wr));
        emit ResultsLockedAt(expected);
        _lock(expected);
        assertTrue(wr.locked());
        assertEq(pub.roleCount(0), 0);
        assertEq(pub.roles(0, address(wr)), 0);
        assertEq(wr.stateHash(), expected);
        assertFalse(wr.grantInventorySealed());
    }

    function test_stateHashIsIndependentOfDeclarationOrder() public {
        _publish();
        _declare(_win("rollup", _one("runner-up")));
        _declare(_win("zkpay", _one("winner")));
        WinnerRegistrar.WinnerInput[] memory sorted = new WinnerRegistrar.WinnerInput[](2);
        (sorted[0], sorted[1]) = (_win("rollup", _one("runner-up")), _win("zkpay", _one("winner")));
        assertEq(wr.stateHash(), _expectedState(sorted));
    }

    function test_stateHashCoversEventOnlyAndEmptyStates() public {
        assertEq(
            wr.stateHash(),
            keccak256(abi.encode(keccak256("lanyard.publication-state/1"), bytes32(0), new bytes32[](0)))
        );
        _publish();
        assertEq(wr.stateHash(), _expectedState(new WinnerRegistrar.WinnerInput[](0)));
        // Locking with no winners is allowed (an event without placings).
        _lock(wr.stateHash());
        assertTrue(wr.locked());
    }

    function test_lockWithStaleExpectedHashReverts() public {
        _publish();
        _declare(_win("zkpay", _one("winner")));
        bytes32 stale = wr.stateHash();
        _declare(_win("rollup", _one("runner-up")));
        bytes32 actual = wr.stateHash();
        vm.prank(results);
        vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.StateMismatch.selector, stale, actual));
        wr.lockResults(stale);
        assertFalse(wr.locked());
        assertEq(pub.roleCount(0), PUBLICATION_ROLES);
    }

    function test_lockRequiresEventResultsAndResultsWallet() public {
        bytes32 empty = wr.stateHash();
        vm.prank(results);
        vm.expectRevert(WinnerRegistrar.EventResultsNotSet.selector);
        wr.lockResults(empty);
        _publish();
        bytes32 expected = wr.stateHash();
        address[3] memory callers = [organizer, stranger, lead];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(WinnerRegistrar.NotResultsWallet.selector, callers[i]));
            wr.lockResults(expected);
        }
    }

    function test_lockRefusesAnExtraRootHolder() public {
        _publish();
        // Any surviving root holder (here a text setter granted through the contract's own admin role).
        vm.prank(address(wr));
        pub.grantRootRoles(P.ROLE_SET_TEXT, stranger);
        assertFalse(wr.grantInventorySealed());
        bytes32 expected = wr.stateHash();
        vm.prank(results);
        vm.expectRevert(
            abi.encodeWithSelector(
                WinnerRegistrar.GrantInventoryNotSealed.selector, 0, PUBLICATION_ROLES + P.ROLE_SET_TEXT
            )
        );
        wr.lockResults(expected);
        assertFalse(wr.locked());
    }

    function test_lockRefusesAnOrganizerThatKeptAnAdminRole() public {
        _publish();
        // A handoff that left the organizer an admin (here UPGRADE_ADMIN) is not sealed.
        vm.prank(address(wr));
        pub.grantRootRoles(P.ROLE_UPGRADE_ADMIN, organizer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WinnerRegistrar.GrantInventoryNotSealed.selector, 0, PUBLICATION_ROLES + P.ROLE_UPGRADE_ADMIN
            )
        );
        wr.checkSealed();
        bytes32 expected = wr.stateHash();
        vm.prank(results);
        vm.expectRevert(
            abi.encodeWithSelector(
                WinnerRegistrar.GrantInventoryNotSealed.selector, 0, PUBLICATION_ROLES + P.ROLE_UPGRADE_ADMIN
            )
        );
        wr.lockResults(expected);
        assertFalse(wr.locked());
    }

    function test_lockRefusesAKeyScopedHolderOfAPublishedKey() public {
        _publish();
        string[6] memory keys = [
            "lanyard.results",
            "lanyard.results-hash",
            "lanyard.bundle-hash",
            "lanyard.bundle-uri",
            "lanyard.edition",
            "lanyard.prizes"
        ];
        bytes32 expected = wr.stateHash();
        for (uint256 i; i < keys.length; ++i) {
            uint256 snap = vm.snapshotState();
            vm.prank(address(wr));
            pub.grantSetterRoles(abi.encodeCall(ITextSetter.setText, (bytes(""), keys[i], "")), stranger);
            uint256 resource = uint256(keccak256(bytes(keys[i])));
            vm.prank(results);
            vm.expectRevert(
                abi.encodeWithSelector(
                    WinnerRegistrar.GrantInventoryNotSealed.selector, resource, P.ROLE_SET_TEXT
                )
            );
            wr.lockResults(expected);
            vm.revertToState(snap);
        }
    }

    /// Known limitation: EAC cannot enumerate key-scoped resources, so a pre-existing scoped grant for a key
    /// this contract never writes (here `avatar`) survives the lock. Deployment must check this off-chain.
    function test_knownLimitScopedGrantOnUnwrittenKeySurvivesLock() public {
        _publish();
        _declare(_win("zkpay", _one("winner")));
        vm.prank(address(wr));
        pub.grantSetterRoles(abi.encodeCall(ITextSetter.setText, (bytes(""), "avatar", "")), stranger);
        _lock(wr.stateHash());
        vm.prank(stranger);
        pub.setText(_name("winner.zkpay"), "avatar", "x");
        vm.prank(stranger);
        vm.expectRevert();
        pub.setText(_name("winner.zkpay"), "lanyard.prizes", "[]");
    }

    function test_partialLockFailureRevertsEverything() public {
        _publish();
        bytes32 expected = wr.stateHash();
        // A failing revoke (no admin left) makes the whole lock revert with `locked` still false.
        vm.prank(address(wr));
        pub.revokeRootRoles(P.ROLE_UPGRADE_ADMIN, address(wr));
        vm.prank(results);
        vm.expectRevert();
        wr.lockResults(expected);
        assertFalse(wr.locked());
        assertEq(pub.roles(0, address(wr)), PUBLICATION_ROLES - P.ROLE_UPGRADE_ADMIN);
    }

    function test_afterLockNobodyCanPublishDeclareOrWrite() public {
        bytes32 expected = _publishDeclareBoth();
        _lock(expected);

        vm.startPrank(results);
        vm.expectRevert(WinnerRegistrar.ResultsLocked.selector);
        wr.setEventResults(_pub());
        vm.expectRevert(WinnerRegistrar.ResultsLocked.selector);
        wr.declare(_win("zkpay", _one("winner")));
        vm.expectRevert(WinnerRegistrar.ResultsLocked.selector);
        wr.lockResults(expected);
        vm.stopPrank();

        address newImpl = address(new PermissionedResolver(address(this)));
        uint256 editionRecord = pub.getRecordId(NameCoder.namehash(_name(""), 0));
        address[5] memory actors = [organizer, results, address(wr), address(registrar), lead];
        for (uint256 i; i < actors.length; ++i) {
            vm.startPrank(actors[i]);
            vm.expectRevert();
            pub.setText(_name("winner.zkpay"), "lanyard.prizes", '["runner-up"]');
            vm.expectRevert();
            pub.setText(_name(""), "lanyard.results", "0x00");
            vm.expectRevert();
            pub.setText(_name(""), "lanyard.bundle-uri", "https://attacker.example/");
            vm.expectRevert();
            pub.linkToRecord(_name("winner.zkpay"), editionRecord);
            vm.expectRevert();
            pub.linkToNode(_name(""), NameCoder.namehash(_name("winner.rollup"), 0));
            vm.expectRevert();
            IUpgradeable(address(pub)).upgradeToAndCall(newImpl, "");
            vm.expectRevert();
            pub.grantRootRoles(P.ROLE_SET_TEXT, actors[i]);
            vm.expectRevert();
            pub.grantSetterRoles(
                abi.encodeCall(ITextSetter.setText, (bytes(""), "lanyard.prizes", "")), actors[i]
            );
            vm.stopPrank();
        }
        assertEq(_text("winner.zkpay", "lanyard.prizes"), '["winner"]');
        assertEq(_text("winner.rollup", "lanyard.prizes"), '["runner-up"]');
        assertEq(_text("", "lanyard.results"), vm.toString(_pub().resultsKey));
        assertEq(pub.roleCount(0), 0);
    }
}

/// Bug hunt: without the parent renewal a promoted winner stops resolving when its team lapses. The real
/// flow above (`test_declaredWinnerKeepsResolvingAfterTheNamespaceExpiry`) keeps resolving.
contract WinnerLapseTest is PublicationFixture {
    WinnerCaller internal caller;

    function setUp() public {
        _buildEdition();
        caller = new WinnerCaller();
        vm.prank(organizer);
        registrar.setWinnerRegistrar(address(caller));
    }

    function test_promotionWithoutRenewalStopsResolvingWhenTheTeamLapses() public {
        caller.promote(IWinnerForwarders(address(registrar)), "zkpay", lead, FAR_FUTURE);
        bytes memory name = NameCoder.encode("winner.zkpay.mumbai2026");
        IRegistry root = IRegistry(address(base));
        assertEq(LibResolution.findExactOwner(root, name, 0), lead);
        (, address resolver,, uint256 offset) = LibResolution.findResolver(root, name, 0);
        assertEq(resolver, address(pub));
        assertEq(offset, 0);

        vm.warp(NAMESPACE_EXPIRY);
        assertEq(zkpay.getExpiry(id("winner")), FAR_FUTURE); // the winner itself never expires...
        assertEq(LibResolution.findExactOwner(root, name, 0), address(0)); // ...but its parent did
        (IRegistry exact,,, uint256 lapsedOffset) = LibResolution.findResolver(root, name, 0);
        assertEq(address(exact), address(0));
        assertTrue(lapsedOffset != 0); // the winner's own resolver is no longer reachable
    }
}
