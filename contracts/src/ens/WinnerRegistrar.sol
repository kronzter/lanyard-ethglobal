// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IPermissionedResolver} from "ens-v2/resolver/interfaces/IPermissionedResolver.sol";
import {PermissionedResolverLib as P} from "ens-v2/resolver/libraries/PermissionedResolverLib.sol";
import {LanyardRegistrar} from "./LanyardRegistrar.sol";

/// @title WinnerRegistrar
/// @notice The only writer of the edition's publication resolver (A4.1, A4.2). The configured results
///         wallet publishes the event results on the edition name once, declares each placing team's
///         permanent `winner.<team>` name, then locks: the lock revokes every resolver role this contract
///         holds, so nobody can change the published records afterwards.
/// @dev Prize policy (user decision): there are exactly two prizes, `runner-up` and `winner`. A team's
///      list is a non-empty, duplicate-free, sorted subset of them, and each prize goes to at most one
///      team, so at most two teams are ever declared.
///
///      Hashes, all keccak256 over Solidity ABI encoding:
///      - `eventHash = keccak256(abi.encode(PublicationInput))` (the struct as one tuple).
///      - `declarationHash[team] = keccak256(abi.encode(WinnerInput))` (the struct as one tuple).
///      - `stateHash() = keccak256(abi.encode(STATE_DOMAIN, eventHash, bytes32[] winnerHashes))`, with
///        `winnerHashes` the declaration hashes ordered by team label bytes ascending, `eventHash` zero
///        before publication and `STATE_DOMAIN = keccak256("lanyard.publication-state/1")`. `locked` is
///        not part of it: the lock compares the state it is about to freeze.
///
///      Parent renewal: each declaration renews the team name to `type(uint64).max`, the same far-future
///      expiry as the winner name and the edition name (enforced by `LanyardRegistrar.seal`). A winner
///      only resolves while every ancestor is unexpired, so any shorter parent expiry would make the
///      permanent name lapse with its team. Base-name renewal above the edition remains a trust limit.
contract WinnerRegistrar {
    ////////////////////////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////////////////////////

    /// @dev Mirrors `PublicationInput` in src/shared/interfaces/results-publisher.ts; `edition` is its
    ///      `event` field (a Solidity keyword), the edition label such as `mumbai2026`.
    struct PublicationInput {
        string edition;
        bytes32 resultsKey;
        bytes32 resultsHash;
        bytes32 bundleHash;
        string bundleUri;
    }

    /// @dev Mirrors `WinnerInput`: the publication fields followed by `team` and `prizes`.
    struct WinnerInput {
        string edition;
        bytes32 resultsKey;
        bytes32 resultsHash;
        bytes32 bundleHash;
        string bundleUri;
        string team;
        string[] prizes;
    }

    ////////////////////////////////////////////////////////////////////////
    // Errors and events
    ////////////////////////////////////////////////////////////////////////

    error ZeroAddress();
    error PublicationResolverNotSet();
    error InvalidResultsWallet(address wallet);
    error NotResultsWallet(address caller);
    error ResultsLocked();
    error EventResultsAlreadySet();
    error EventResultsNotSet();
    error WrongEdition(string edition);
    error ZeroCommitment();
    error InvalidBundleUri();
    error PublicationMismatch(bytes32 expected, bytes32 actual);
    error AlreadyDeclared(string team);
    error NotDeclared(string team);
    error NoPrizes();
    error UnknownPrize(string prize);
    error PrizesNotCanonical();
    error PrizeAlreadyAwarded(string prize);
    error StateMismatch(bytes32 expected, bytes32 actual);
    error GrantInventoryNotSealed(uint256 resource, uint256 roleCount);

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

    ////////////////////////////////////////////////////////////////////////
    // Constants
    ////////////////////////////////////////////////////////////////////////

    /// @notice The complete publication-resolver inventory this contract holds until lock, the same
    ///         bitmap as `PUBLICATION_ORGANIZER_RESOLVER_ROLES` in src/ens/issuance-plan.ts.
    uint256 public constant RESOLVER_ROLES = P.ROLE_SET_TEXT | P.ROLE_SET_TEXT_ADMIN | P.ROLE_LINK
        | P.ROLE_LINK_ADMIN | P.ROLE_UPGRADE | P.ROLE_UPGRADE_ADMIN;
    bytes32 public constant STATE_DOMAIN = keccak256("lanyard.publication-state/1");
    uint256 public constant MAX_BUNDLE_URI_BYTES = 2048;
    uint64 internal constant FAR_FUTURE = type(uint64).max;
    uint8 internal constant RUNNER_UP = 1;
    uint8 internal constant WINNER = 2;

    ////////////////////////////////////////////////////////////////////////
    // Immutables and storage
    ////////////////////////////////////////////////////////////////////////

    LanyardRegistrar public immutable registrar;
    IPermissionedResolver public immutable publicationResolver;
    address public immutable resultsWallet;
    /// @notice Set in the constructor only (strings cannot be immutable).
    string public editionLabel;
    /// @notice The full edition name, e.g. `mumbai2026.lanyard.eth`. Constructor only.
    string public editionName;

    bool public locked;
    bool internal _eventSet;
    PublicationInput internal _event;
    bytes32 public eventHash;
    string[] internal _teams;
    mapping(bytes32 teamHash => bytes32) public declarationHash;
    mapping(bytes32 teamHash => uint8) internal _prizeMask;
    /// @dev Team label hash holding each prize bit (RUNNER_UP, WINNER).
    mapping(uint8 prize => bytes32 teamHash) internal _prizeHolder;

    ////////////////////////////////////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////////////////////////////////////

    constructor(LanyardRegistrar registrar_, address resultsWallet_) {
        if (address(registrar_) == address(0) || resultsWallet_ == address(0)) revert ZeroAddress();
        address resolver = registrar_.publicationResolver();
        if (resolver == address(0)) revert PublicationResolverNotSet();
        if (resultsWallet_ == registrar_.organizer()) revert InvalidResultsWallet(resultsWallet_);
        registrar = registrar_;
        publicationResolver = IPermissionedResolver(resolver);
        resultsWallet = resultsWallet_;
        string memory label = registrar_.editionLabel();
        editionLabel = label;
        editionName = string.concat(label, ".", registrar_.baseName());
    }

    modifier onlyResultsWallet() {
        if (msg.sender != resultsWallet) revert NotResultsWallet(msg.sender);
        if (locked) revert ResultsLocked();
        _;
    }

    ////////////////////////////////////////////////////////////////////////
    // Publication
    ////////////////////////////////////////////////////////////////////////

    /// @notice One-shot. Stores the event commitment and writes it on the edition name.
    function setEventResults(PublicationInput calldata input) external onlyResultsWallet {
        if (_eventSet) revert EventResultsAlreadySet();
        if (keccak256(bytes(input.edition)) != keccak256(bytes(editionLabel))) {
            revert WrongEdition(input.edition);
        }
        if (input.resultsKey == 0 || input.resultsHash == 0 || input.bundleHash == 0) {
            revert ZeroCommitment();
        }
        _checkBundleUri(input.bundleUri);
        _eventSet = true;
        _event = input;
        bytes32 hash = keccak256(abi.encode(input));
        eventHash = hash;

        bytes memory name = NameCoder.encode(editionName);
        _writeCommitment(name, input.edition, input.resultsKey, input.resultsHash, input.bundleHash);
        publicationResolver.setText(name, "lanyard.bundle-uri", input.bundleUri);
        emit EventResultsSet(
            hash, input.edition, input.resultsKey, input.resultsHash, input.bundleHash, input.bundleUri
        );
    }

    /// @notice Once per team. Promotes the team's reserved `winner` name to its lead, renews the team
    ///         name to the far future and writes the prizes and the event commitment on the winner name.
    function declare(WinnerInput calldata input) external onlyResultsWallet {
        if (!_eventSet) revert EventResultsNotSet();
        bytes32 publication = keccak256(
            abi.encode(
                PublicationInput(
                    input.edition, input.resultsKey, input.resultsHash, input.bundleHash, input.bundleUri
                )
            )
        );
        if (publication != eventHash) revert PublicationMismatch(eventHash, publication);
        bytes32 teamHash = keccak256(bytes(input.team));
        if (declarationHash[teamHash] != 0) revert AlreadyDeclared(input.team);
        uint8 mask = _prizes(input.prizes, teamHash);

        bytes32 hash = keccak256(abi.encode(input));
        declarationHash[teamHash] = hash;
        _prizeMask[teamHash] = mask;
        _teams.push(input.team);

        // Unknown or replaced teams revert inside the registrar (UnknownTeam, TeamIdentityChanged).
        registrar.promoteWinner(input.team, registrar.teamLead(teamHash), FAR_FUTURE);
        registrar.renewWinningTeam(input.team, FAR_FUTURE);

        bytes memory name = NameCoder.encode(string.concat("winner.", input.team, ".", editionName));
        publicationResolver.setText(name, "lanyard.prizes", _prizesJson(mask));
        _writeCommitment(name, input.edition, input.resultsKey, input.resultsHash, input.bundleHash);
        emit WinnerDeclared(teamHash, input.team, input.prizes, hash);
    }

    /// @notice Freezes the publication: requires the exact expected state and a sealed resolver grant
    ///         inventory, then revokes every role this contract holds on the resolver.
    function lockResults(bytes32 expectedStateHash) external onlyResultsWallet {
        if (!_eventSet) revert EventResultsNotSet();
        bytes32 actual = stateHash();
        if (actual != expectedStateHash) revert StateMismatch(expectedStateHash, actual);
        _checkSealed();
        locked = true;
        publicationResolver.revokeRootRoles(RESOLVER_ROLES, address(this));
        uint256 remaining = publicationResolver.roleCount(0);
        if (remaining != 0) revert GrantInventoryNotSealed(0, remaining);
        emit ResultsLockedAt(actual);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    /// @notice The stored event commitment, if published.
    function eventResults() external view returns (bool set, PublicationInput memory input) {
        return (_eventSet, _event);
    }

    /// @notice Declared team labels in declaration order.
    function declaredTeams() external view returns (string[] memory) {
        return _teams;
    }

    /// @notice The exact declared input for `team`, rebuilt from the event commitment and its prizes.
    function winner(string calldata team) external view returns (WinnerInput memory input) {
        bytes32 teamHash = keccak256(bytes(team));
        uint8 mask = _prizeMask[teamHash];
        if (mask == 0) revert NotDeclared(team);
        PublicationInput storage e = _event;
        input = WinnerInput(
            e.edition, e.resultsKey, e.resultsHash, e.bundleHash, e.bundleUri, team, _prizeList(mask)
        );
    }

    /// @notice The team holding `prize` (`winner` or `runner-up`), or the empty string.
    function prizeHolder(string calldata prize) external view returns (string memory) {
        uint8 bit = _prizeBit(prize);
        bytes32 holder = _prizeHolder[bit];
        for (uint256 i; i < _teams.length; ++i) {
            if (keccak256(bytes(_teams[i])) == holder) return _teams[i];
        }
        return "";
    }

    /// @notice See the contract note for the definition.
    function stateHash() public view returns (bytes32) {
        uint256 n = _teams.length; // at most two: each team holds a prize and each prize one team
        bytes32[] memory hashes = new bytes32[](n);
        if (n > 0) hashes[0] = declarationHash[keccak256(bytes(_teams[0]))];
        if (n > 1) {
            bytes32 second = declarationHash[keccak256(bytes(_teams[1]))];
            if (_lessThan(bytes(_teams[1]), bytes(_teams[0]))) (hashes[0], hashes[1]) = (second, hashes[0]);
            else hashes[1] = second;
        }
        return keccak256(abi.encode(STATE_DOMAIN, eventHash, hashes));
    }

    /// @notice Whether this contract is the only holder of every resolver role at the root (and holds
    ///         exactly `RESOLVER_ROLES`), with no key-scoped holders for any key it writes.
    function grantInventorySealed() external view returns (bool) {
        try this.checkSealed() {
            return true;
        } catch {
            return false;
        }
    }

    /// @notice Reverts with `GrantInventoryNotSealed` unless `grantInventorySealed()`.
    function checkSealed() external view {
        _checkSealed();
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal
    ////////////////////////////////////////////////////////////////////////

    function _checkSealed() internal view {
        IPermissionedResolver resolver = publicationResolver;
        uint256 root = resolver.roleCount(0);
        // roleCount packs one holder count per role nybble, so equality with the bitmap means exactly one
        // holder of each of our roles and none of any other role.
        if (root != RESOLVER_ROLES || resolver.roles(0, address(this)) != RESOLVER_ROLES) {
            revert GrantInventoryNotSealed(0, root);
        }
        string[6] memory keys = [
            "lanyard.results",
            "lanyard.results-hash",
            "lanyard.bundle-hash",
            "lanyard.bundle-uri",
            "lanyard.edition",
            "lanyard.prizes"
        ];
        for (uint256 i; i < keys.length; ++i) {
            uint256 resource = uint256(keccak256(bytes(keys[i])));
            uint256 count = resolver.roleCount(resource);
            if (count != 0) revert GrantInventoryNotSealed(resource, count);
        }
    }

    function _writeCommitment(
        bytes memory name,
        string calldata edition,
        bytes32 resultsKey,
        bytes32 resultsHash,
        bytes32 bundleHash
    ) internal {
        IPermissionedResolver resolver = publicationResolver;
        resolver.setText(name, "lanyard.results", _hex(resultsKey));
        resolver.setText(name, "lanyard.results-hash", _hex(resultsHash));
        resolver.setText(name, "lanyard.bundle-hash", _hex(bundleHash));
        resolver.setText(name, "lanyard.edition", edition);
    }

    /// @dev Absolute `https://` URI with something after the scheme, no spaces or control bytes.
    function _checkBundleUri(string calldata uri) internal pure {
        bytes calldata b = bytes(uri);
        bytes8 scheme = "https://";
        if (b.length <= 8 || b.length > MAX_BUNDLE_URI_BYTES || bytes8(b[:8]) != scheme) {
            revert InvalidBundleUri();
        }
        for (uint256 i = 8; i < b.length; ++i) {
            if (uint8(b[i]) <= 0x20 || uint8(b[i]) == 0x7f) revert InvalidBundleUri();
        }
    }

    /// @dev Validates the list and claims its prizes for `teamHash`.
    function _prizes(string[] calldata prizes, bytes32 teamHash) internal returns (uint8 mask) {
        if (prizes.length == 0) revert NoPrizes();
        uint8 previous;
        for (uint256 i; i < prizes.length; ++i) {
            uint8 bit = _prizeBit(prizes[i]);
            // Strictly increasing bits: sorted (`runner-up` < `winner`) and duplicate-free.
            if (bit <= previous) revert PrizesNotCanonical();
            if (_prizeHolder[bit] != 0) revert PrizeAlreadyAwarded(prizes[i]);
            _prizeHolder[bit] = teamHash;
            mask |= bit;
            previous = bit;
        }
    }

    function _prizeBit(string calldata prize) internal pure returns (uint8) {
        bytes32 h = keccak256(bytes(prize));
        if (h == keccak256("runner-up")) return RUNNER_UP;
        if (h == keccak256("winner")) return WINNER;
        revert UnknownPrize(prize);
    }

    function _prizeList(uint8 mask) internal pure returns (string[] memory list) {
        if (mask == RUNNER_UP | WINNER) {
            list = new string[](2);
            (list[0], list[1]) = ("runner-up", "winner");
        } else {
            list = new string[](1);
            list[0] = mask == WINNER ? "winner" : "runner-up";
        }
    }

    /// @dev Canonical JSON (RFC 8785) of the sorted prize list.
    function _prizesJson(uint8 mask) internal pure returns (string memory) {
        if (mask == RUNNER_UP | WINNER) return '["runner-up","winner"]';
        return mask == WINNER ? '["winner"]' : '["runner-up"]';
    }

    function _hex(bytes32 value) internal pure returns (string memory) {
        return Strings.toHexString(uint256(value), 32);
    }

    /// @dev Lexicographic byte order, the same as JavaScript's default sort for ASCII labels.
    function _lessThan(bytes memory a, bytes memory b) internal pure returns (bool) {
        uint256 n = a.length < b.length ? a.length : b.length;
        for (uint256 i; i < n; ++i) {
            if (a[i] != b[i]) return uint8(a[i]) < uint8(b[i]);
        }
        return a.length < b.length;
    }
}
