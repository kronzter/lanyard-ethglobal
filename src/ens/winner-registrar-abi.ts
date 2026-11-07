// WinnerRegistrar (contracts/src/ens/WinnerRegistrar.sol) and the publication resolver's role surface,
// as the A4.2 publisher and the deploy/handoff script call them. Runtime-neutral (viem only).
import { encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, toHex, type Hex } from "viem";
import type { PublicationInput, PublicationState, WinnerInput } from "../shared/interfaces/results-publisher";

export const winnerRegistrarAbi = parseAbi([
  "struct PublicationInput { string edition; bytes32 resultsKey; bytes32 resultsHash; bytes32 bundleHash; string bundleUri; }",
  "struct WinnerInput { string edition; bytes32 resultsKey; bytes32 resultsHash; bytes32 bundleHash; string bundleUri; string team; string[] prizes; }",
  "constructor(address registrar, address resultsWallet)",
  "function setEventResults(PublicationInput input)",
  "function declare(WinnerInput input)",
  "function lockResults(bytes32 expectedStateHash)",
  "function eventResults() view returns (bool set, PublicationInput input)",
  "function declaredTeams() view returns (string[])",
  "function winner(string team) view returns (WinnerInput input)",
  "function declarationHash(bytes32 teamHash) view returns (bytes32)",
  "function eventHash() view returns (bytes32)",
  "function prizeHolder(string prize) view returns (string)",
  "function stateHash() view returns (bytes32)",
  "function locked() view returns (bool)",
  "function grantInventorySealed() view returns (bool)",
  "function checkSealed() view",
  "function registrar() view returns (address)",
  "function publicationResolver() view returns (address)",
  "function resultsWallet() view returns (address)",
  "function editionLabel() view returns (string)",
  "function editionName() view returns (string)",
  "function RESOLVER_ROLES() view returns (uint256)",
  "function STATE_DOMAIN() view returns (bytes32)",
  "event EventResultsSet(bytes32 indexed eventHash, string edition, bytes32 resultsKey, bytes32 resultsHash, bytes32 bundleHash, string bundleUri)",
  "event WinnerDeclared(bytes32 indexed teamHash, string team, string[] prizes, bytes32 declarationHash)",
  "event ResultsLockedAt(bytes32 indexed stateHash)",
  "error ZeroAddress()",
  "error PublicationResolverNotSet()",
  "error InvalidResultsWallet(address wallet)",
  "error NotResultsWallet(address caller)",
  "error ResultsLocked()",
  "error EventResultsAlreadySet()",
  "error EventResultsNotSet()",
  "error WrongEdition(string edition)",
  "error ZeroCommitment()",
  "error InvalidBundleUri()",
  "error PublicationMismatch(bytes32 expected, bytes32 actual)",
  "error AlreadyDeclared(string team)",
  "error NotDeclared(string team)",
  "error NoPrizes()",
  "error UnknownPrize(string prize)",
  "error PrizesNotCanonical()",
  "error PrizeAlreadyAwarded(string prize)",
  "error StateMismatch(bytes32 expected, bytes32 actual)",
  "error GrantInventoryNotSealed(uint256 resource, uint256 roleCount)",
  // Reverts bubbled up from LanyardRegistrar's forwarders.
  "error UnknownTeam(bytes32 labelHash)",
  "error TeamIdentityChanged(bytes32 labelHash)",
  "error InvalidTeamLead()",
  "error WinnerNotReserved(bytes32 labelHash)",
]);

/** The EnhancedAccessControl surface of the publication resolver (pinned ENSv2 PermissionedResolver). */
export const publicationResolverAbi = parseAbi([
  "function roles(uint256 resource, address account) view returns (uint256)",
  "function roleCount(uint256 resource) view returns (uint256)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function setText(bytes name, string key, string value)",
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function linkToNode(bytes sourceName, bytes32 targetNode)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "event EACRolesChanged(uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotRevokeRoles(uint256 resource, uint256 roleBitmap, address account)",
]);

/** The two prize names (user decision), in the contract's canonical (sorted) order. */
export const PRIZES = ["runner-up", "winner"] as const;
/** Text keys WinnerRegistrar writes; the contract itself rejects scoped holders of these. */
export const PUBLICATION_TEXT_KEYS = [
  "lanyard.results",
  "lanyard.results-hash",
  "lanyard.bundle-hash",
  "lanyard.bundle-uri",
  "lanyard.edition",
  "lanyard.prizes",
] as const;

export const STATE_DOMAIN = keccak256(toHex("lanyard.publication-state/1"));

const PUBLICATION_TUPLE = parseAbiParameters(
  "(string edition, bytes32 resultsKey, bytes32 resultsHash, bytes32 bundleHash, string bundleUri)",
);
const WINNER_TUPLE = parseAbiParameters(
  "(string edition, bytes32 resultsKey, bytes32 resultsHash, bytes32 bundleHash, string bundleUri, string team, string[] prizes)",
);

export type ChainPublicationInput = {
  edition: string;
  resultsKey: Hex;
  resultsHash: Hex;
  bundleHash: Hex;
  bundleUri: string;
};
export type ChainWinnerInput = ChainPublicationInput & { team: string; prizes: readonly string[] };

export const toChainPublication = (p: PublicationInput): ChainPublicationInput => ({
  edition: p.event,
  resultsKey: p.resultsKey,
  resultsHash: p.resultsHash,
  bundleHash: p.bundleHash,
  bundleUri: p.bundleUri,
});
export const toChainWinner = (w: WinnerInput): ChainWinnerInput => ({
  ...toChainPublication(w),
  team: w.team,
  prizes: w.prizes,
});

/** `keccak256(abi.encode(PublicationInput))`, the contract's `eventHash`. */
export const eventHashOf = (p: PublicationInput): Hex =>
  keccak256(encodeAbiParameters(PUBLICATION_TUPLE, [toChainPublication(p)]));

/** `keccak256(abi.encode(WinnerInput))`, the contract's `declarationHash[team]`. */
export const declarationHashOf = (w: WinnerInput): Hex =>
  keccak256(
    encodeAbiParameters(WINNER_TUPLE, [{ ...toChainPublication(w), team: w.team, prizes: w.prizes }]),
  );

const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const bytesOf = (s: string) => new TextEncoder().encode(s);
/** Byte-wise lexicographic order of UTF-8 labels, the contract's `_lessThan`. */
export function compareLabelBytes(a: string, b: string): number {
  const x = bytesOf(a);
  const y = bytesOf(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/** The contract's `stateHash()` for `state` (the `locked` flag is not part of it). */
export function stateHashOf(state: PublicationState): Hex {
  const event = state.eventResults ? eventHashOf(state.eventResults) : ZERO32;
  const teams = Object.keys(state.winners).sort(compareLabelBytes);
  const hashes = teams.map((t) => declarationHashOf(state.winners[t]!));
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32[]"), [STATE_DOMAIN, event, hashes]),
  );
}
