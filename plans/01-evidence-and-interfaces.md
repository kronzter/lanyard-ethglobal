# Lanyard · Evidence and shared contracts

This is the authoritative cross-phase contract, specified as shared types/mocks in P0 and implemented by the owning A/B phases. It takes precedence over phase details for evidence, interfaces and trust claims. Changes require updating affected phases and conformance tests together. SDK capability notes are design constraints, not evidence that this checkout has a working installation.

## 1 · What verification proves

Rabdi queries expose current state, not historical entity snapshots. Queries across pages can observe different blocks. Natural expiration, owner deletion and ownership transfer remain possible for readonly entities; readonly only prevents attribute patches. Event logs are invalidations, not an archive of complete entity values.

The MVP uses **operator-attested capture**. A local capture CLI retains observed readonly records while they are available. It records raw typed values, creator, current owner, creation flags, creation/update/expiry blocks, creation timestamp, observation block/hash and network/reset identity. The results operator attests those observations; an observation is not relabeled as the state at an earlier block. Mutable drafts are excluded from the judging evidence set.

- Current screens use current observations and disclose stale/incomplete reads. They cannot promise a complete record history.
- Capture starts before judging inputs are created. It persists each observation and an inventory of known keys. A disappeared known key **without retained readonly bytes**, conflicting bytes for one readonly key, unavailable required metadata, an interrupted scan or missed interval blocks automatic freeze until resolved and disclosed. A deleted source with complete retained readonly evidence stays usable; deletion alone does not discard that evidence. Decodable invalid records remain visible with deterministic rejection reasons rather than becoming accepted inputs.
- The final bundle contains retained inputs, frozen config/authorities, rule version, evaluation context, per-record observations, public decryption material, selected prizes, capture intervals/gaps and hashes. Exclude mutable drafts and all `results` rows from ranking inputs, avoiding self-reference; validate results separately during publication/discovery. Records first observed after the cutoff are excluded. Captured evidence can survive deletion without asserting unchanged current ownership.
- `MATCH` means the published bundle is intact, signed by the configured results operator, and reproduces the published computation using independently checked Sepolia history. It **does not prove** that the operator captured every Rabdi record, that unseen/deleted earlier candidates never existed, or that publisher-attested metadata is an independent Arkiv inclusion proof. Print this scope with the verdict.
- First submission/final means the earliest valid candidate **in the captured evidence set**, ordered by creation block then key. Never advertise an immutable first-ever ledger. Deletion cannot replace a candidate already captured; deletion before capture remains an explicit limitation.
- Anyone can verify a downloaded bundle offline except for historical ENS reads, which use the configured archive RPC. A future independently authenticated Arkiv archive is a separate project, not an implicit cache capability.

`captureForEvent(event)` performs bounded indexed current-state scans (100 rows maximum per page), deduplicates by key, records every observed page block and reconciles a live watcher with periodic full scans. A bounded pass must terminate; exhausted budgets and schema skips in trusted input scope are errors, not successful completeness. It never reports the pass as an atomic snapshot. Store app/event/kind and every reader filter as explicit indexed schema columns; store JSON/binary values in bytes columns.

The freeze operator keeps two local copies of the canonical bundle and publishes a downloadable copy at `bundleUri`. The URI is a retrieval hint, not a trust root; verify its hash. The CLI accepts `--bundle <path>` so verification never depends on that host staying online. Do not put a potentially oversized bundle in a single Arkiv entity: publish only a compact results summary subject to the encoded-size budget. Chunking is out of scope; reject an oversized summary before any publication.

The envelope is `{ body, bundleHash, signature }`. Its versioned `body` contains event, context, frozen config, rule version, sorted captured records/observations, prepared ENS entries, capture diagnostics, public decryption material, manual prizes, canonical rules output and bundle URI. Hash canonical body bytes with keccak256. The signature is the results wallet's EIP-191 signature of the exact UTF-8 message `Lanyard evidence v1\n<bundleHash>` (substitute the lowercase `0x` hash). Trusted signer/deployment/reset identity comes from independently supplied deployment config and the contract's configured results wallet, never only the bundle's self-declared config.

Define `resultsBody` as canonical `{ schemaVersion: 1, event, rankings, outputHash, ruleVersion, configHash, bundleHash, bundleUri, bundleSignature: signature, context }`, populated from the checked bundle. `resultsHash = keccak256(canonical(resultsBody))`. Compare recomputed canonical rules output byte-for-byte with the bundle's claimed output before reconstructing this body. The later Arkiv results key is excluded from both hash domains, and the bundle excludes the later results record. Verification can reconstruct and compare this hash against locked ENS even after the live summary disappears. Publish bundle hash **and URI** in locked edition text for retrieval without that row. Offline prepared ENS values are operator-attested; an online `MATCH` independently checks them.

## 2 · Canonical encoding and evaluation

Canonical JSON uses RFC 8785 after converting bigint values to unsigned base-10 strings without leading zeroes, bytes and addresses to lowercase `0x` hex, and maps to arrays sorted by their declared key. Reject duplicate keys, unsafe numeric integers and non-finite values. Hash canonical UTF-8 bytes with keccak256. Record arrays sort by creation block, then lowercase entity key; ENS entries sort by label then block then query kind/key. Scores and routing costs use integer units.

`RULES_VERSION` hashes a reproducible manifest of sorted rules source paths/LF-normalized bytes, transitive shared runtime helpers and resolved runtime dependency versions from the lockfile; exclude build output, absolute paths and timestamps. `configHash` commits to event times including the freeze window, chain identities, authorities, partners, cipher suite/key, shift-write profile and schema version. Verification refuses unavailable/different rules versions and never silently substitutes current code for an old bundle.

```ts
type Label = string; // canonical label relative to the edition
type BlockRef = { number: bigint; hash: Hex; timestamp: bigint };
type EvaluationContext = {
  event: string;
  arkivChainId: number;
  arkivResetId: Hex; // recorded genesis/reset fingerprint, not chain ID alone
  sepoliaChainId: number;
  arkivCutoff: BlockRef;
  sepoliaCutoff: BlockRef;
  configHash: Hex;
};
```

The Arkiv cutoff is an observed head recorded **after** final capture; it is a filter for captured creation blocks, not a historical query argument. Select the latest Sepolia block with timestamp no later than the Arkiv cutoff timestamp and wait until it has the configured confirmations. No prepared ENS read may exceed that cutoff. Retain both hashes and the frozen confirmation policy. P0 measures recent block/timestamp availability; failure is a stop gate, not permission to invent metadata. P0 records concrete chain confirmation depths; unset values block dependent work. Refuse changed cutoff hashes, reset identity or unconfirmed required inputs. Reorganizations require recapture before publication; published results are never silently recomputed.

Frozen config defines `results` as the earliest publication time and `freezeDeadline` as the exclusive latest cutoff time. Require `eventStart < submissionDeadline <= judgingEnd <= results < freezeDeadline` and `eventEnd >= judgingEnd`. Both cutoff timestamps must lie in `[results, freezeDeadline)`. Check this before decrypting or exporting public verification material and before any publication; verification independently rejects an out-of-window context. A saved valid job may resume later with the identical cutoff, and later verification uses the saved window rather than the current time. Never move a cutoff backward to work around an expired badge. Judge badges expire at `freezeDeadline`; structural books, team names, partner parent names and their sub-books last at least until `namespaceExpiry = max(eventEnd, freezeDeadline) + 30 days`. Deployment validates the complete ancestor chain, including the actual base-name expiry, against that bound. Volunteer/staff badge expiry remains `eventEnd`.

`evaluate(records, ensSnapshot, context, config, ruleVersion)` is pure. `prepare` fetches ownership, expiry and required notes at each record's creation timestamp **and** at the evaluation cutoff wherever present-tense status is required. It maps arbitrary referenced times (claim, resolution and session boundaries) explicitly. No rule calls the network, device clock or randomness. Invalid source records with decodable identity stay visible with a reason; malformed data is counted in diagnostics and is never accepted.

Judge eligibility requires badge ownership by the score creator and valid expiry at both score creation and evaluation cutoff, with no unregister/re-registration between them. The creation lookup is block-end state; scan continuity from `scoreSepoliaBlock + 1` through the cutoff inclusive (an empty interval is false), avoiding an earlier re-registration in the creation block being mistaken for a later revocation. Renewal without unregister may restore cutoff eligibility, but re-registration never restores the previous registration's scores. Freeze pins the decision; later changes cannot alter published rankings. Volunteers are checked at each action time, not retroactively at freeze.

Score preparation first validates source identity/flags, references, authority, deadlines, assignment, registration continuity and recusal without decryption. Rejected rows remain diagnostics and cannot stop freeze merely by carrying junk ciphertext. Next verify that the operator's decryption key matches the configured public key and the pinned cipher test vector; unavailable keys or implementation failures stop the job. For eligible rows, malformed envelopes, wrong associated data, failed authentication and invalid score ranges produce deterministic per-record rejection reasons. Select the earliest **valid decrypted** final afterward. Preserve raw ciphertext and keep derived plaintext/rejection entries separate; `evaluate` consumes prepared records with these entries, and verification independently regenerates them rather than trusting bundle-supplied plaintext. Missing required source evidence, conflicting captured readonly bytes and corrupt bundle/storage hashes still stop freeze. An invalid candidate is not lost evidence.

Editable score drafts are durable **device-local** state, keyed by chain/reset, event, wallet, submission, assignment, rubric and cipher key ID. B4 saves local values before reporting an autosave, using native AsyncStorage and browser IndexedDB; it separately mirrors encrypted `score_sheet` bytes to Arkiv. Wallet switching hides other wallets' drafts. Restart on the same installation/browser profile restores local values; storage clearing, reinstall or another device requires re-entry, never remote decryption or silently substituted zero scores. Explain that local app storage contains editable scores and does not protect them from someone with access to that storage. The event private key stays absent from the app. Seal from local values, then reconcile any existing final before another write.

## 3 · ENS identity and discovery

```ts
interface EnsReader {
  owner(label: Label, at: { sepoliaBlock: bigint }): Promise<Address | null>;
  address(label: Label, at: { sepoliaBlock: bigint }): Promise<Address | null>;
  text(label: Label, key: string, at: { sepoliaBlock: bigint }): Promise<string | null>;
  expiry(label: Label, at: { sepoliaBlock: bigint }): Promise<bigint | null>;
  registrationId(label: Label, at: { sepoliaBlock: bigint }): Promise<Hex | null>;
  unregisteredBetween(label: Label, from: bigint, to: bigint): Promise<boolean>;
  sepoliaBlockAt(unixSeconds: bigint): Promise<bigint>;
  headBlock(): Promise<bigint>;
}
```

`owner` follows the registry hierarchy and checks registration and ancestor expiry at the requested block. It does not use resolver addresses. `address` is forward resolution for display, not authorization. `unregisteredBetween` includes both endpoints and treats re-registration as an identity boundary; RPC/log-range failure throws. Historical reads use archive calls and pinned deployment addresses. Cache keys include chain/reset identity, label, query/key and block hash.

`registrationId` is null whenever `owner` is null; otherwise it is `keccak256(canonical({ chainId, registry, resource }))`, using the holding registry's historical EAC resource as a 32-byte hex value. Its registration version changes on unregister/re-registration, but not on renewal or ordinary role changes; never substitute the mutable token ID. A2 verifies the pinned registry ABI and this behavior. `lanyard.perms` is canonical JSON `{ schemaVersion: 1, registrationId, holder, permissions }`, with lowercase holder address and sorted unique permission strings. A lead action requires matching registration ID **and** holder at the action block, plus `shift-manager`. Legacy comma lists, malformed notes and stale bindings grant nothing. The coordinator reads the current binding when granting/removing permissions; reissue needs a fresh grant, while renewal of the same registration preserves it. Resolver text need not be erased to invalidate old grants, so historical reads remain meaningful.

The empty relative label `""` denotes the edition itself for owner/address/text/expiry lookups; it is the only empty-label exception. Thus app readers can fetch the locked edition results/bundle commitment without importing the CLI-only publisher. Other labels must pass canonical validation.

Authority-only kinds use independently configured organizer/results/partner wallet addresses. Those actors need not invent a badge: `by_label` is a descriptive persona label; badge ownership is required only for kinds whose policy calls for a badge/team name. Mixed-case labels and whitespace are rejected by the application's stricter canonical-label policy after ENSIP-15 validation; this is not a claim that ENSIP-15 prohibits all emoji.

The app's `IdentityDirectory.labelsFor(address, at)` discovers candidate labels from configured registration events and verifies each with `EnsReader.owner`. It returns all matching roles and requires an explicit active-role selection; reverse ENS or fixture personas alone are not production badge discovery. P0 provides the interface/mock; A2 implements bounded event discovery and records log-range limits. The CLI shares the same authority config and lookup policy.

The shell adds independently configured organizer/results/partner authority capabilities alongside discovered badge roles; authority wallets do not need fabricated owned labels. App composition lives in `src/providers.ts`; Node composition in `cli/providers.ts` (same repo and package, enforced by ESLint import rules). These are the only places allowed to import another track's concrete implementations. Both select mocks until their integration is complete, and neither puts signing/decryption credentials in shared config or the app. The Node root is wired to A's reader at I2 and publisher at I4.

## 3a · Public team pages and ENS website links

Every registered team has a public Lanyard page at `publicAppOrigin + '/teams/' + teamLabel`. Each edition deployment has its own configured HTTPS origin; P0 mock mode may use localhost. One reusable page template serves every team: project title and ENS name, short description, track, up to four member display names, project links, and any verified winner badge. Visitors can open/copy the page and follow buttons for ETHGlobal, source repository, live demo and demo video without connecting a wallet. Mobile and desktop share the same content and layout system. Loading, registered-but-not-submitted, unknown team and unavailable evidence are distinct states; errors must not look like an empty team.

The team's standard ENS text record `url` points to this Lanyard page. The ETHGlobal showcase is a button **on** the page, not the ENS website target. A2's organizer-signed script and A4's onboarding desk set/read back the deterministic URL on the team's default hackers resolver; the organizer has only the required `url` setter grant for this operation. Never give team leads a setter role on the shared resolver, since it would cover other teams. Team leads retain their existing ability to choose another resolver; a different/missing resolved URL is reported as a mismatch, never silently overwritten by the app. B's screens read through `EnsReader.text`, with no new cross-track signing interface. ENS text metadata does not itself configure browser DNS/HTTP redirects: supported navigation is the app's ENS-name/profile link and the copyable HTTPS address, tested at I4.

P0 defines `TeamPageContent = { title: string; description: string; members: string[]; links: { ethglobal?: string; repository?: string; demo?: string; video?: string } }` and `teamPageUrl(teamLabel, publicAppOrigin)`. Bounds: title 1–120 characters, description at most 4,000, at most four member names of 1–80 characters, each URL at most 2,048 UTF-8 bytes. Links must be absolute HTTPS URLs with no embedded credentials; the ETHGlobal link must use exactly `ethglobal.com` or `www.ethglobal.com`. Missing optional links are omitted, never dead buttons. Reject script/data URLs; render descriptions as text, not executable HTML. An ETHGlobal showcase URL is required when sealing a submission, but registering a team and editing its draft do not require that external page to exist yet. Do not make transient external HTTP availability a consensus/rules input or claim the URL proves ETHGlobal ownership.

B1 stores these fields in the project's bytes payload and copies them into the readonly submission snapshot covered by `content_hash`. B4 owns the editor under `/team`, the reusable public-page component and `/teams/[team]`. The public page displays the earliest valid captured submission under the existing rules, switching to the verified frozen bundle's selection after publication; it does not use later mutable drafts to replace submitted contents. Before submission it shows the registered team and a "Project details coming soon" state. Missing required evidence is shown as unavailable, not replaced with unverified content. External sites can change even though their submitted URLs are fixed. After source expiry, the page can read the retained bundle through the configured public read transport; unavailable bundle/CORS access produces an explicit error.

P0 creates the unauthenticated route stub, shared schema/URL helper and mock page data. Select Expo web `output: 'single'` for this MVP, with static-host rewrites for application routes to `index.html` while serving assets normally; dynamic team routes load data at runtime, so a new team needs no site rebuild. P0 tests direct navigation/reload against a local static-host configuration; I4 verifies the real HTTPS origin, direct links, public RPC/bundle access and CORS with the wallet disconnected. This is a client-rendered page, not a promise of per-team search indexing or social-preview metadata. Hosting configuration is prepared in the repo; actual publication remains a separate user-authorized action.

## 4 · Routing

```ts
type LocatedStop = { projectKey: Hex; cell: CellRef };
type RoutingTicket = {
  key: Hex; cell: CellRef; createdAtSeconds: bigint;
};
interface Router {
  path(v: Venue, from: CellRef, to: CellRef): Cell[] | null;
  distances(v: Venue, from: CellRef): Map<string, number>; // integer millimetres
  nextTicket(v: Venue, from: CellRef, open: RoutingTicket[],
    atSeconds: bigint, alphaMmPerMinute: number): RoutingTicket | null;
  judgeRoute(v: Venue, start: CellRef, stops: LocatedStop[]): Hex[];
}
```

Callers resolve project → submitted team lead → seat assignment → cell and filter eligibility outside the router. Missing locations are caller-reported `unlocated` items. Deduplicate by project key; conflicting cells fail. Edge cost in mm is `floor(baseCost * cellSizeMm / 1000)`, with base cost 1,000 orthogonal or 1,414 diagonal. Stable neighbor/equal-cost ties use cell `(y,x)` then key. Ticket score is distance mm minus `alphaMmPerMinute * floor((atSeconds-createdAtSeconds)/60)`; callers use 5,000 by default. Reject negative ages, noninteger/negative alpha and values/products outside safe integer bounds. The router never reads Arkiv or the clock. Smoothed display paths preserve walkability; scoring uses unsmoothed costs.

## 5 · Publication and recovery

P0 records `shiftWriteProfile: 'linked-create' | 'confirmed-sequential'`. `linked-create` is allowed only after S12 proves exact entity-key prediction, salt reuse, receipt/readback matching and exclusive creator custody on both app platforms. A per-device queue alone is insufficient. Otherwise use `confirmed-sequential`: create and confirm the replacement shift, persist its actual key, then batch clock-in and duty pass referencing that existing key. This takes two approvals and is not atomic across transactions. Supersession closes the old shift prospectively when the replacement lands; that replacement remains inactive until its clock-in lands. Show the gap and pending activation explicitly; cancellation/crash resumes only the missing confirmed step after reconciliation. Ordinary clock-in plus pass for an already-existing shift remains one batch in either profile. Never switch profiles or retry automatically after an uncertain write.

```ts
type PublicationInput = {
  event: string; resultsKey: Hex; resultsHash: Hex; bundleHash: Hex; bundleUri: string;
};
type WinnerInput = PublicationInput & { team: string; prizes: string[] };
type PublicationState = {
  eventResults: PublicationInput | null;
  winners: Record<string, WinnerInput>;
  locked: boolean;
};
type ConfirmedTx = { txHash: Hex; blockNumber: bigint; blockHash: Hex };
interface ResultsPublisher {
  state(): Promise<PublicationState>;
  setEventResults(input: PublicationInput): Promise<ConfirmedTx>;
  declareWinner(input: WinnerInput): Promise<ConfirmedTx>;
  lockResults(expected: PublicationState): Promise<ConfirmedTx>;
  reconcile(txHash: Hex): Promise<'pending' | 'reverted' | ConfirmedTx>;
}
```

`resultsKey` in publication input/text is the 32-byte Arkiv results **entity key**. The configured results wallet is a separate address; neither value means private signing material. Bundle URIs are bounded HTTPS retrieval hints; a local `--bundle` path is the offline transport alternative.

The persisted CLI job is bound to edition, chain/reset identities, signer, immutable plan/bundle hash and exact ordered operations. Record prepared intent before signing; for locally signed publication save raw transaction bytes, hash and nonce durably **before broadcast**. Keep `prepared`, `submitted`, `receipt_confirmed`, `verified` and `complete` distinct. Reconcile known receipts and exact on-chain state after restart. A matching prior publication can be adopted; a conflicting one stops the job. A missing RPC result or empty entity query never authorizes a resend. External app-wallet writes with no recoverable hash/nonce evidence remain uncertain and require reconciliation; the per-device queue does not guarantee coordination with another device.

`ConfirmedTx` means successful canonical receipt plus configured confirmations, not only a hash. `state` must survive a new publisher instance, including mocks used by CLI restart tests. Post-lock writes always fail. A completed job refuses a second freeze; `--resume <job>` only continues the same saved plan, never builds a replacement from current state.

Results and winner text use one dedicated **publication resolver**, serving both the edition and winner names. The `WinnerRegistrar` contract is the only text writer, has setter/admin, link/admin and upgrade/admin grants during setup, and exposes the event-publication, declaration and lock entrypoints to the configured results wallet only. Remove every other holder of those roles and their admins before handoff. The same contract stores the expected event pointer, declaration payload hashes and `locked` state for `state()`; it checks the complete expected state before locking, revokes all its own setter/link/upgrade grants and admins, then marks `locked` atomically. Partial failure reverts the transaction. It cannot publish or declare after lock. Lock all argument-scoped text grants as well as root grants; deployment rejects any unexpected scoped holder.

`LanyardRegistrar` is deployed in A1 as the stable holder of the reserved-winner registration/renewal roles in every team registry. Its narrowly scoped `promoteWinner(team, lead, expiry)` and `renewWinningTeam(team, expiry)` forwarders are callable only by the one-shot configured `WinnerRegistrar`. They expose no arbitrary calldata, role grants or resolver choices. This avoids late role backfills and gives an explicit route to parent renewal without retaining dangerous registry admins. The edition name itself points at the publication resolver and has no surviving set-resolver or set-subregistry authority after setup; its registry parent chain and ancestor expiry/renewal remain disclosed trust limits.

## 6 · Acceptance and sources

P0 conformance must test owner ≠ resolved address; historical expiry and unregister intervals; explicit router time and located stops; matching/conflicting persisted publication state; successful/failed receipts; lock over event and winner records; and crash after broadcast before journal confirmation. B2 tests canonical bytes/hash equality on Node/browser/Hermes, capture gaps, unavailable evidence, frozen authority config and a tampered operator signature. B4 tests deletion before/after capture and labels the former as unprovable, rather than claiming to detect it.

The repair regression set also covers early/late cutoff rejection before key disclosure, historical verification after the window, stale permission notes after reissue, renewal/role changes preserving registration ID, linked-create prediction interference and the sequential activation gap, same-device draft recovery, junk/invalid scores excluded without blocking valid results, and partner-judge eligibility after event end within the supported freeze window. These are implementation acceptance requirements, not claims that P0 has passed.

External constraints to recheck against pinned packages in P0:

- [Rabdi current-state reads and watcher limits](https://docs.arkiv.network/networks/older-networks/)
- [Arkiv deletion and readonly semantics](https://docs.arkiv.network/writing/change/)
- [Arkiv retention and extension](https://docs.arkiv.network/writing/expiration/)
- [ENS resolver records and permissions](https://docs.ens.domains/ensv2/permissioned-resolver/)
- [ENS registry roles and lifecycle](https://docs.ens.domains/ensv2/permissioned-registry/)
- [ENS registration resources versus mutable token IDs](https://docs.ens.domains/ensv2/mutable-token-ids/)
- [ENS website URL text record](https://docs.ens.domains/ensip/5/)
- [Expo web output and hosting](https://docs.expo.dev/guides/publishing-websites/)
- [Local Android builds and Windows limitations](https://docs.expo.dev/build-reference/local-builds/)

### Local prepared publication extension (B4)

The Node freeze composition root requires `PreparedResultsPublisher`, an additive extension of `ResultsPublisher`: `pendingTransactions()`, `prepare(operation)`, `broadcastPrepared(transaction)` and `preparedStatus(hash)`. `PreparedPublication` retains raw bytes, transaction hash and nonce; `PublicationOperation` is the existing event/winner/lock union. Preparation persists intent without broadcasting. Restart reuses the identical prepared transaction; pending/unknown outcomes never allocate a replacement nonce. The existing app/read interface is unchanged. The mock persists canonical mock transaction envelopes and distinguishes prepared from submitted state; these are explicitly mock bytes, not Ethereum transaction signatures. The I4 Sepolia adapter must implement actual locally signed transaction preparation and pass the additional prepared-publication conformance suite before live freeze is enabled.

A signed in-window bundle may be staged in its saved job before host upload. The operator uploads that exact public artifact to the chosen HTTPS URI and resumes the identical job. Download verification and both local copy checks precede every publication attempt. This staging step never publishes results, changes cutoff/config/prizes, or authorizes a different hosting service.

B4 capture writes an independent key inventory before retained observation bytes. Freeze compares that inventory with retained records before requesting the score key; a missing line cannot be hidden by decrementing a derived count. Bundle diagnostics carry `inputKeys` for the filtered ranking inputs and verification rejects a mismatch. This detects loss of known retained bytes, not unobserved historical deletions. The publication lock also writes edition text `lanyard.locked = "1"` atomically; app readers require this sentinel before rendering committed rankings/prizes, and the CLI checks the full locked event and winner state against the bundle.
