# Lanyard · Tracker

Implementation progress goes here; explicit user-authorized plan corrections are recorded separately below. **Edit only your own track's progress** to avoid conflicts. P0/integration sections are updated with their work. Update status with its spec. Commits happen only when the user asks; agents may push non-`main` branches and open PRs, and the user merges.

**Builders:** Person A = `@kronzter` (ENS & venue track, app shell) · Person B = `@arnavmahajan630` (Arkiv & flows track).

Status values: `todo` · `doing` · `done` · `blocked`. Finding status: `open` · `fixed <sha>` · `known limitation`.

---

## P0 · Foundation (joint)

### Spike (P0.6)

| Check | Result | Notes |
| --- | --- | --- |
| S1 Dev APK (EAS cloud) + AppKit connects MetaMask mobile | done | **A.** Dev APK built on EAS cloud (`98b750fe-e2de-4d2c-ba9e-63237b7d4733`, development profile, no non-public EAS env values) installs on Android; AppKit connects MetaMask mobile (2026-11-06) after deduping valtio (`553e24a`). Spike run connected on Sepolia (11155111). One `CallExecutionError` overlay seen once after a connect, not reproduced since; watch during S3/S4 |
| S2 Wallet adds and switches to Rabdi | done | **A.** Android, MetaMask mobile, 2026-11-06 11:19 UTC: `wallet_addEthereumChain` + switch 11155111 → 7794095 passed (12.9 s incl. two approvals); switch back to Sepolia passed (48 ms) |
| S3 Arkiv SDK on Hermes with AppKit signer (record polyfills) | todo | **A + B** pair (phone). Hermes needs `crypto.getRandomValues`: the SDK's random entity salt throws `NoRandomSourceError` without it |
| S4 `executeBatch` = one approval | todo | **A + B** pair (phone wallet) |
| S5 S2–S4 on Expo web (wagmi adapter) | todo | **A**, after the AppKit web adapter is wired |
| S6 Deploy + call a contract on Rabdi (decides Faucet vs desk-wallet `drip` fallback) | done (fallback) | **B**, Node, 2026-11-06, spike wallet `0x36b7…E2cF` (the user-funded organizer key). **Rabdi refuses contract creation:** `eth_estimateGas`/`eth_call` for any init code (the probe at `cancun` and `paris`, and a 5-byte `PUSH1 0 PUSH1 0 RETURN`) return `-32603` with details `contract creation is disabled (no-EVM Arkiv executor)`; nothing was sent. A plain native transfer works (`0xba63a457…6ac6`, EIP-1559, 21,000 gas). **Decision: `fundingProfile = desk-wallet`**; the `Faucet` contract (B1.1-R3/R6) is dropped and B1.1-R7–R9 apply. No `[profile.rabdi]` is needed in `contracts/foundry.toml` |
| S7 Archive Sepolia read at a past block from the phone (public read-only app key) | done | **A.** Android via `EXPO_PUBLIC_SEPOLIA_RPC_URL` (Alchemy Sepolia), 2026-11-06: archive-state probe answered as **archive**; `getEnsText(lanyard.eth, url)` resolved at past block 12026223 (latest − 50 000) and at latest 12076223 in 1.0 s total (value null: no record set yet). Provider restrictions: none set; a domain allowlist cannot protect the Android app, so the key is public, read-only, rate-limited and rotated if abused **Config values (B, Node, 2026-11-06):** reset ID = Sepolia genesis `0x25a5cc10…6dd9` (matches the known genesis); `latest − finalized` lag 71–83 blocks over 6 samples (2.5 min), finality in 32-block epochs → `confirmations = 96` |
| S8 Rabdi RPC load (keyless, then public app key if needed) + ENS read volume | doing | **A + B.** Android, keyless Rabdi RPC, 2026-11-06: 200 plain reads (alternating `getBlockNumber`/`getBlock`) all succeeded, 0 failures, 0 HTTP 429, p50 319 ms, p95 1401 ms; the run took 87.9 s instead of the planned 60 s, so it measured ~137 reads/min, below the 200/min target. Still open: a 50-parallel burst and a true 200/min run, 10 parallel `watchEntityEvents` subscriptions (needs B's SDK pin), and the ENS read count for 500 records |
| S9 Installed SDK/schema/index/access/gas evidence | done | **B.** `@arkiv-network/sdk` 1.0.1 pinned on `p0/P0.6a-arkiv-spike`. APIs used: `createEntity`, `patchEntity`, `extendEntity`, `deleteEntity`, `executeBatch`, `predictEntityKeys`, `getEntityNonce`, `getEntity`, the `select().from().where().ownedBy().fetch()` builder (pages report `blockNumber` and `skipped`). Keyless writes and reads worked from Node (2026-11-06). **Gas at 1 gwei:** readonly create 161,383 (≈0.00016 tGLM), mutable create 144,567, patch 47,979, extend 42,901, delete 123,007, 3-create batch 362,329, native transfer 21,000. **Rejected by simulation, no tx and no gas:** patch of a readonly entity (`EntityMutationError … created readonly`), extension to an earlier expiry. **Rejected before sending:** a 33rd attribute (`TooManyAttributesError`; a named schema's `arkiv.schema` tag counts, so ≤ 31 columns), a 129-byte `str`, a 131,073-byte `bytes`, a lifetime over `MAX_LIFETIME` 7,884,000. **Reserved attribute names** (case-insensitive): `and or not true false between startswith exists typeof order by asc desc` and the type tags `bool i32 u64 u256 dec bytes str addr key`; **`by` is reserved**, so the planned common attribute `by` cannot be written (plan repair needed, see Next up) |
| S10 Capture/deletion/reset/confirmation evidence | done | **B**, 2026-11-06. **Reset ID** = genesis `0xa65a2b9e…cbce` (re-read, unchanged). **Confirmations = 96**: `latest − finalized` lag 66–95 over 24 samples (4 min; 65–93 earlier), `finalized` steps exactly 32 blocks. **Capture:** a readonly entity (`0x03a75fa3…1aaa`) read back with every `$` field, `$attributes`/`$attributeSchema` and the page block, built into an observation that passes `CapturedObservationSchema`. **Deletion** (`0xab495b27…a48f`, block 289803): the query returns 0 rows and `getEntity` throws `NoEntityFoundError`, while the retained observation with `deletedAtBlock` stays valid. **Fail-closed:** a known key gone without retained bytes throws, and conflicting readonly bytes throw `ConflictingCaptureError` (`dedupeObservations`). Pages of one query can report different blocks; nothing is claimed as a historical read |
| S11 Cross-runtime cipher and canonical test vectors | todo | **B**, before B4. Canonical vectors already match on Node and headless Chromium (`pnpm vectors:browser`, in CI); the cipher choice and the Hermes run of both wait for a dev build |
| S12 Linked-create prediction/custody or confirmed sequential fallback | doing | **B (Node half done, 2026-11-06).** `predictEntityKeys({ count: 3 })` + `executeBatch` (shift, clock and pass referencing `key(shift)`, with the predicted salts; `0xa52b8c5d…e2db`): all three minted keys equal the predictions and both references resolve. Entity nonce +3 vs transaction count +1, so the two nonces are separate. **Interference:** an unrelated create landing first (`0xf84a1998…d9fe3`) moved every key; the stale batch (`0x42fe3bc9…1891`) minted different keys, its clock references a shift that does not exist, and the script stops without retrying. **Sequential rehearsal:** confirmed shift (`0x301f6ac1…eb65`) journaled → simulated crash → resume reconciles and batches clock + pass (`0x94cdf2bc…2e11`) → a second resume sends nothing, and a second step 1 is refused while the journal exists. **Open (A + B, phone/web):** exclusive custody under AppKit before `linked-create` can be chosen; `shiftWriteProfile` stays unmeasured |

**Fallbacks chosen:** funding = **desk wallet + readonly `drip` record** (S6: Rabdi has no EVM, so no `Faucet` contract). Shift writes: not chosen yet (S12 custody pending).

**Spike spend:** 0.0018 tGLM over 12 transactions from `0x36b7…E2cF` (90 → 89.998 tGLM, 2026-11-06).

**Capability evidence:** recorded 2026-11-06: SDK package/APIs/limits (S9), both chains' confirmation depths and reset IDs (S7, S10), funding route (S6). Still unmeasured: archive log limits, cipher package/encoding (S11) and linked-create custody (S12). Revised requirements do not count as passed spike checks.

### Approved plan repair · 2026-11-06

Scope approved in conversation: repair evidence, interfaces, ENS grants/lock, judging/duty/ticket semantics, integrations and workflow. No implementation milestone is marked done by this repair. Canonical decisions and interface signatures live in `01-evidence-and-interfaces.md`.

| Audit concern | Revised contract / owning phase | Plan status |
| --- | --- | --- |
| Historical Rabdi reads and incomplete evidence | Operator-attested retained bundle, explicit completeness limit; B1 capture, B2 verification | revised |
| Readonly deletion, mutable submitted contents | Retained candidates, immutable submission snapshot, no first-ever-history claim; B1/B4 | revised |
| ENS ownership vs address, role discovery | Distinct reader methods and directory; P0/A2 | revised |
| Missing freeze grants/renewal and split locks | Stable registrar forwarders, sole-writer publication resolver, event + winner atomic lock; A1/A2/A4 | revised |
| Pure evaluation context, revocation cutoff | Explicit confirmed context and registration continuity; B2/B4 | revised |
| Encrypted scores vs live rankings | Completion before freeze, rankings afterward; B4/I4 | revised |
| Missing route inputs | Located stops, caller-filtered tickets, explicit time/mm units; P0/A3/B3/B4 | revised |
| Claim/session deadlines and lost evidence | Logical deadlines separate from retention, bound sessions/claim-linked resolution; B1/B3 | revised |
| Uncertain publication outcomes | Durable intent/raw bytes, receipts/state reconciliation and exact-job resume; P0/B4/A4 | revised |
| Integration dependencies and operational rules | I1 owner-only, I2 core-only, phase fixtures, actual infrastructure/build profile, manual commits/publishing | revised |
| Independent review: I4 could skip earlier live integrations | I4 now requires I1–I3 and explicitly asserts all providers live | revised |
| Independent review: cross-judge recusal forgery | Recusal creator must own its target judge badge; organizer exception and rejection check in B1/B4 | revised |
| Follow-up review: premature permanent freeze | Explicit `[results, freezeDeadline)` cutoff window before key disclosure/publication, independently enforced by verification; P0/B2/B4/I4 | revised |
| Follow-up review: stale lead notes on reissue | Registration-ID/holder-bound permission envelope, reader/mock/script/rule agreement and reissue regression; P0/A2/B2/B3/I2 | revised |
| Follow-up review: junk ciphertext blocks freeze | Authorization before decryption; invalid candidates rejected per record, required evidence/key failures still block; B2/B4/I4 | revised |
| Follow-up review: untested atomic linked writes | P0-S12 proves predictions/custody or selects confirmed sequential replacement with explicit pending activation; P0/B1/B3/I3 | revised |
| Follow-up review: encrypted draft cannot reopen | Durable same-device editable state with separate encrypted Arkiv mirror and explicit storage-loss behavior; B1/B4/I4 | revised |
| Follow-up review: partner ancestor expires before freeze | Structural namespace lifetime covers supported window; judge/staff expiry separated and on-chain ancestor checks; P0/A1/A2/B4/I4 | revised |

**Remaining product limitations:** capture completeness is operator-attested; issuer-controlled raw badge bitmaps and ancestor-name authority remain trusted; prize selection is manual until specified. Editable score recovery is device-local; the sequential shift fallback takes two approvals with an inactive interval. A stronger archival/inclusion or restricted-issuer design is outside this MVP. P0 feasibility gates must pass before dependent capabilities are implemented.

### Approved plan repair · 2026-11-06 (consistency pass)

Scope approved in conversation: a pass over A1–A4, B1–B4, I1–I4 and the shared files, with the user's answers to each open question. No implementation milestone is marked done by this repair.

| # | Concern | Revised contract / owning phase | Plan status |
| --- | --- | --- | --- |
| D1 | Partner/head-judge raw issuance bypassed badge expiry, address records and revival | Issued only through `LanyardRegistrar.registerJudge` / `registerPartnerBadge`; registrar holds register/renew on `judges` and partner sub-books; partners/head judge keep unregister only; A1/A2/A4/CONTEXT | revised |
| D2 | No head-judge console | A4.3 head-judge console (issue via registrar, revoke via unregister) | revised |
| D3 | No-contract funding fallback had no repeat protection; wallet unclear | Faucet contract stays primary; fallback = dedicated desk wallet sends tGLM and writes readonly `drip` record, refusing repeats; P0/B1/I1/CONTEXT/README | revised |
| D4 | `seat_assignment.hacker` was ambiguous; leads' badge unclear | Stores `hacker_address` + `hacker_label`, checked by owner; every team member incl. lead holds a `hackers` badge; P0.4/A1/A4/B1/B2/B3/B4/CONTEXT | revised |
| D5 | Global judges had no track scope | New non-partner `main` track; global judges score `main` only, partner judges own track only; `main` rubric by organizer, assignments by organizer or head judge; 3 global judge personas; P0/B2/B4/CONTEXT/README | revised |
| D6 | Late volunteers couldn't self-start | Self clock-in window `[starts_at-3600, starts_at+900]`, else "Ask a lead"; B3/CONTEXT | revised |
| D7 | Tickets didn't require a badge | Ticket counts only if creator holds a valid `hackers` badge at creation; B3/CONTEXT | revised |
| D8 | Seed sizes disagreed (3 teams vs 15 projects) | 3 teams / 3 projects; B4 | revised |
| D9 | I3 ENS mode undefined | I3 requires I2 complete and runs with ENS = `sepolia`; I3/README/CONTEXT | revised |
| D10 | RPC-key rules contradicted each other | Read-only, app-restricted RPC keys may ship in `EXPO_PUBLIC_*` as public values (rotated if abused); never signing/operator/decryption keys; proxy only as fallback; P0/B1/I4/CONTEXT/README | revised |
| M1–M3 | A1 gas wording, history-fixture branch, A1.1 requirement order | A1 wording; `sepolia-history.json` committed on I2; A1.1 R1–R5 in order | revised |
| M4–M5 | CONTEXT said decryption key goes in results record; faucet shown as fixed | Published in the evidence bundle; faucet decision lists fallback | revised |
| M6 | `OpenTicket` vs `RoutingTicket` | P0.2 uses `RoutingTicket` and `LocatedStop` from `01` | revised |
| M7 | `/teams/[team]` route unowned | `app/teams/**` owned by Track B | revised |
| M8 | Partner POIs had no partner ID | POI `partner-table` kind with `partner` ID; A3.1-R7 blocks export without one per partner | revised |
| M9 | P0.1 CI ran `expo export` before the app existed | Runs once P0.5 creates the app (at the repo root) | revised |
| M10 | Bug-hunt prompt skipped the authoritative contract | Prompt also reads `01-evidence-and-interfaces.md` | revised |

### Approved plan repair · 2026-11-06 (single app, Track B first)

Scope approved in conversation: Person A (`@kronzter`) unavailable at P0 start; Person B (`@arnavmahajan630`) builds the P0 slice B1 needs. No implementation milestone is marked done by this repair.

| # | Concern | Revised contract / owning phase | Plan status |
| --- | --- | --- | --- |
| S1 | 8-package pnpm monorepo and ENSv2 git submodules add Expo/Metro/EAS friction | One Expo project at the repo root, plain `src/` folders, `cli/`, one `contracts/` Foundry project with Soldeer deps; ESLint import boundaries + CODEOWNERS; all plan paths rewritten | revised |
| S2 | P0 blocked on both builders | Track B slice (P0.1, P0.2, P0.4a, P0.5a, P0.6a S6/S9/S10/S12) merges first; P0.3, remaining fixtures, AppKit/Android and ENSv2 deferred to before the phase that needs them (`P0-foundation.md`) | revised |
| S3 | One commit per spec; agents never push | Several small commits per spec ending in a `docs(tracker)` commit; titles describe the change, with the spec ID only in a `Refs:` footer, and no assistant attribution. Agents push non-`main` branches, never `main`. PRs target the phase branch directly: stacked PRs #2–#4 merged into their stacked bases before retargeting, so #5 brought the same commits into `phase/P0-foundation`, and stacking is no longer used | revised |
| S4 | No local Android build host (Windows, no WSL/SDK); `--local` blocked S1 | APKs build on EAS cloud (`pnpm app:dev-apk`, `pnpm app:apk`); `--local` scripts kept as optional; builds receive only public `EXPO_PUBLIC_*` values and EAS holds no secret; P0/I3/I4/CONTEXT/README/workflow | revised |

### Specs

| Spec | Owner | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| P0.6 Wallet and chain spike | pair | doing | | **A (phone half):** S1, S2, S7 done on Android (2026-11-06); S8 keyless read half measured (no failures or 429s, but ~137 reads/min, below the 200/min target; burst and subscriptions open); S5 (web) open. **B (Node half):** S6 (fallback), S9 and S10 done; S7 config values recorded; S12 Node half done, custody pending. **Paired:** S3, S4, S8 subscriptions, S11 and S12 custody wait for B's SDK pin (this PR) on A's phone. See the Spike table |
| P0.1 Repo skeleton and CI | B (swapped from A) | done | bd95a4b | PR #1; CI green ([run 42172719701](https://github.com/kronzter/lanyard-ethglobal/actions/runs/42172719701), on `069a510`, the identical tree before the attribution-trailer rewrite). Single Expo app (SDK 58, Node 24, pnpm hoisted), `lanyard/boundaries` lint rule, context-aware secret scan (fake key rejected, hashes and Anvil keys allowed, verified in a fresh clone), one Foundry project with Soldeer forge-std 1.17.0, CODEOWNERS test. ENSv2 pin deferred to A1 |
| P0.2 Shared types, config, deployments | B | blocked | 9ad0618 | Implemented in `src/shared/` (186 tests): canonical labels (ENSIP-15 + strict policy), RFC 8785 canonical JSON + keccak + strict parser, event config (placeholder Dec 2026 IST times; mock authority wallets from the public test mnemonic), freeze window and `namespaceExpiry`, venue/routing shapes, mock/live deployments schema, team-page content and URL helper. Measured 2026-11-06: Sepolia and Rabdi confirmations (96 each) and reset IDs (S7, S10), funding profile `desk-wallet` (S6), so `requireLive` now checks real identities. **Still blocked on:** score cipher (S11) and `shiftWriteProfile` (S12 custody); `configHash` throws `BlockedCapabilityError` until both are measured |
| P0.3 Interfaces, mocks, conformance | B (A reviews) | done | 7954c00 | `EnsReader`, `IdentityDirectory`, `EvaluationContext`, `Router` and `ResultsPublisher` interfaces; registration-ID hash and registration-bound `lanyard.perms` envelope; `MockEnsReader`, `MockIdentityDirectory`, `StubRouter` (Manhattan mm, straight paths, walls ignored) and `MockResultsPublisher` (stored mock transactions with success/revert/pending/crash receipts, reconcile, atomic lock); `runEnsReaderConformance` (13 checks), `runRouterConformance` (12) and `runResultsPublisherConformance` (11), each scenario- or harness-driven so the real implementations reuse them, each with a broken-mock self-test that is caught; evidence schemas: `CapturedObservation`, signed `EvidenceBody`/envelope with `verifyEnvelope`, `resultsBody`/`resultsHash`, 128 KiB summary check, `RULES_VERSION` manifest; app providers serve the ENS mocks and stub router, and `cli/providers.ts` serves the fixture reader plus a file-backed mock publisher that survives restarts; 12 canonical vectors match on Node and headless Chromium (CI uses Chrome). **Hermes vectors** run with spike S11 |
| P0.4 Fixtures | B | done | c5cbe67 | `personas.json` (46, R1), `timeline.json` (R4), `ens-history.json` (R3 plus R5 ENS cases), `venue.small.json` (R2: 20×12, 12 seats, 2 zones, help desk per zone + stage, walled-in seat unreachable by BFS), `team-pages.json`, and `evidence-scenarios.json` (R5 Arkiv/publication cases: deleted captured and uncaptured finals, expired lease with retained claim, publication restart, out-of-window cutoffs). Stories in `fixtures/README.md` |
| P0.5 App shell | A (web slice by B) | doing | 7c41578 | **P0.5a done (web):** route folders with phase placeholders (R1), `flags.ts` + `providers.ts` composition root (R4; mock mode serves the fixture `EnsReader` and `IdentityDirectory` since `08b2cdd` and the `StubRouter` since `893e1ee`; the `sepolia`/`grid` modes fail loudly until their integrations), web-only guard (R7, unit-tested; checked on Android 2026-11-06: the organizer screen shows "Open on web"), public `/teams/[team]` with no wallet gate, `output: "single"`, static-host rewrites (`public/serve.json`, `_redirects`), and `smoke:web` proving direct navigation/reload in CI plus a headless-Chromium render locally (R8). Public host **chosen 2026-11-06: Vercel** (`vercel.json`: `pnpm web:export` → `dist`, SPA rewrite to `/index.html`); the exact `https://…vercel.app` origin is recorded when the Vercel project is created, before A2 writes live ENS `url` records (mock stays `http://localhost:8081`). No deployment yet. **R2 config (A):** `eas.json` `development`/`preview` APK profiles, `pnpm app:dev-apk`/`app:apk` on EAS cloud plus `:local` variants, `expo-dev-client` 58.0.18, EAS project linked (`owner: kronzter`); the first cloud APK build is still pending. **R5 done (A, web-verified):** shared `VenueMapProps` (`venue`, `highlight`, `path`, `onSeatTap`), pure `src/venue/map-geometry.ts` (unit-tested), `StubVenueMap` on `react-native-svg` 15.16.0 (walkable floor, seats, POIs, straight path, labels; loads only absolute image URIs), served lazily by `providers.venueMap()` in `stub` mode, previewed on `/venue` (tap a seat → route from its zone's help desk, checked in a browser); Android render pending a dev APK. **R6 done in mock mode (A, web-verified):** `src/shell/roles.ts` combines configured organizer/results/partner authority wallets (no badge needed) with ownership-checked labels from `providers.identityDirectory()`, maps each role to its screens and builds ENS names forward for display only; a `SessionProvider` holds the wallet, read block, roles and active role; the home screen shows an active-role selector (no screens until one is chosen when a wallet has several) and an onboarding message for wallets with no badge. Until R3, mock mode connects a fixture persona or any pasted address at a chosen fixture moment (default event start + 2 h; the fixture head is after the edition lapses). Checked in a browser: zkpay lead (team lead + hacker), unknown wallet (onboarding), organizer (authority + structural names). Live mode waits for AppKit. Coordinator and head judge are not config authorities; their grants surface with A2. **R3 done on web (A, web-verified):** Reown AppKit behind one `useWallet()` (`src/shell/wallet/`): address, chain, viem wallet client and EIP-1193 provider for Sepolia and Rabdi; wagmi 2.19.5 is the shared layer (native `@reown/appkit-react-native` 2.0.6 + its wagmi adapter on Android, `@reown/appkit` 1.8.24 wagmi adapter on web); `EXPO_PUBLIC_REOWN_PROJECT_ID` + `EXPO_PUBLIC_SEPOLIA_RPC_URL` (Rabdi falls back to the keyless RPC); without them the app runs with the wallet marked unavailable (CI path). A `WalletBridge` feeds the real address into the session (mock moment in mock mode, latest Sepolia block in `sepolia` mode); mock mode keeps the fixture picker. Workarounds to revisit: `pnpm.overrides` pins the web adapter's `@wagmi/connectors` to 6.2.0 (8.x needs wagmi 3), and `metro.config.js` maps `./x.js` to `./x.ts` inside packages that ship TS sources (`ox`). Checked in a browser: the AppKit modal opens (email, Google, WalletConnect QR, MetaMask), no console errors. **Android checked (2026-11-06):** dev APK runs, MetaMask mobile connects (S1). EAS `preview` env holds the two public values (`EXPO_PUBLIC_REOWN_PROJECT_ID`, `EXPO_PUBLIC_SEPOLIA_RPC_URL`). **Pending (A):** a `preview` APK on both builders' phones |

**Bug hunt:** deferred: it runs once over all of P0 after the P0.5 shell and the P0.6 spike are complete · **Merged:** no (`phase/P0-foundation` merges into `main` after the bug hunt)

**Status · 2026-11-06 (evening):** P0.1, P0.3, P0.4 done. P0.5 merged into `phase/P0-foundation` (#8, #9, #10, #12, #13; #15 open) and checked on Android; only a `preview` APK on both phones is left. P0.2 is blocked only on S11 (score cipher) and S12 (shift-write profile); both chain identities and the desk-wallet funding profile are measured. P0.6: A's phone half mostly done (S1, S2, S7; S8 partly); B's Node half done (S6 → desk-wallet fallback, S9, S10, S12 prediction); open are the paired S3, S4, S8 subscriptions, S11 and S12 custody, and A's S5. Then the bug hunt (swap specs), delete `spike/`, and merge into `main`. Drafts waiting for P0: #11 (A3.1 Mumbai venue), #14 (A1.1 + A1.2). Biggest risk: S3 (Arkiv SDK on Hermes with the AppKit signer); per the fallback table, stop and decide jointly if it fails.

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### Next up

**Person B · `@arnavmahajan630`**

1. ~~Merge PR #7~~ merged 2026-11-06 (router, results publisher, evidence schemas, remaining fixtures, browser vectors).
2. ~~Node half of the spike~~ done 2026-11-06 (S6 → desk-wallet fallback, S9, S10, S7 config values, S12 Node half; 0.0018 tGLM spent). Then: the spike PR from `p0/P0.6a-arkiv-spike`, and a **plan repair for the reserved `by` attribute** (the Arkiv SDK rejects it as a query keyword; every record kind in `B1-arkiv-data.md` and `00-CONTEXT.md` §6 uses it), needing your approval before B1.
3. With Person A: S3/S4 on a phone and the Hermes run of the canonical vectors and cipher (S11).
4. Once the shell and the spike are complete: the P0 bug hunt (fresh agent session, prompt in `00-README.md`), fixes, delete `spike/`, merge `phase/P0-foundation` into `main`.
5. B1 can start now as a draft stacked on `phase/P0-foundation` (everything it reads from P0 is merged; Node tests use a local key); funding uses the desk-wallet profile (S6), and record attributes wait on the `by` plan repair. Retarget to `phase/B1-…` after P0 merges into `main`.

**Person A · `@kronzter`**

1. ~~Review the merged P0 work (PRs #1, #5, #6, #7)~~ done 2026-11-06: layout, CODEOWNERS, shared types, mocks, conformance suites and `roleOfLabel` agree with the plans; only these tracker lines were stale.
2. ~~Set up an Expo account and eas-cli, get a Reown project ID and an archive Sepolia RPC key~~ done 2026-11-06.
3. Phone half of the spike: ~~S1, S2, S7~~ done 2026-11-06; S8 read half measured. Open: S8 burst and a true 200/min run, S5 on web (Chrome + MetaMask at `/spike`), and with B: S3, S4, S8 subscriptions, S11 on Hermes (S3 first).
4. ~~Rest of the app shell (R2, R3, R5, R6, R7 on Android)~~ merged 2026-11-06. Open: merge #15, a `preview` APK (`pnpm app:apk`) on both phones.
5. A1.1 + A1.2 drafted (#14; fork mode A passes; `lanyard.eth` registered on Sepolia). A1.3 on hold until P0 is stable; live deploy after P0 merges into `main`.
6. With B: the P0 bug hunt, fixes, delete `spike/` (A's spike screen is local-only), merge `phase/P0-foundation` into `main`.

---

## Track A · Person A

### A1 · Namespace

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| A1.1 Base name and edition registry | todo | | Pre-check 2026-11-06 (read-only, public Sepolia RPC): all ENSv2 addresses from tag `sepolia-deployment-2026-09-15` (`f2f0a05`) have code (RootRegistry `0x9703…a9ce`, ETHRegistry `0x657e…e09e`, UserRegistryImpl `0xa803…0263`, VerifiableFactory `0x9e72…841c`, PermissionedResolverImpl `0x14f0…f243`, PublicResolverV2 `0xd7e5…a50f`, UniversalResolver proxy `0xeEeE…EeEe`, ETHRegistrar `0xabe7…94ca`); Root and ETH registries report `isEmancipated() == true`; `ETHRegistrar.isAvailable("lanyard")` is **true** (not yet registered). Plan drafting |
| A1.2 Badge books and LanyardRegistrar | todo | | |
| A1.3 Team names and reserved winner | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### A2 · Permissions and EnsReader

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| A2.1 Resolvers | todo | | |
| A2.2 Scoped grants, `registerJudge` / `registerPartnerBadge` | todo | | |
| A2.3 Revoke and revive | todo | | |
| A2.4 SepoliaEnsReader | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### A3 · Venue and routing

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| A3.1 Venue editor and export | todo | | |
| A3.2 GridRouter | todo | | |
| A3.3 Real VenueMap | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### A4 · Winners and consoles

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| A4.1 WinnerRegistrar | todo | | |
| A4.2 Results lock and publisher | todo | | |
| A4.3 ENS consoles (desk, coordinator, partner, head judge, permission map) | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

---

## Track B · Person B

### B1 · Arkiv data and faucet

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| B1.1 Chain and faucet (or desk-wallet `drip` fallback) | todo | | |
| B1.2 Record kinds and writers | todo | | |
| B1.3 Queue, batches, readers, watcher | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### B2 · Rules and verifier

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| B2.1 Time mapping | todo | | |
| B2.2 Rules core | todo | | |
| B2.3 Determinism and verify | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### B3 · Volunteers and tickets

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| B3.1 On-duty, shifts, clocks | todo | | |
| B3.2 Help tickets | todo | | |
| B3.3 Seats and partner tickets | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### B4 · Judging and freeze

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| B4.1 Projects, submission, acceptance | todo | | |
| B4.2 Judge flow | todo | | |
| B4.3 Aggregation and leaderboard | todo | | |
| B4.4 Freeze pipeline | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

---

## Integrations (joint)

### I1 · Names meet records

**Smoke (`pnpm e2e:i1`):** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### I2 · Real ENS history

**Smoke (`pnpm e2e:i2`, hashes match):** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### I3 · Real venue and router

**Requires I2 complete.** **Two-phone smoke:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### I4 · Full demo

**Demo script green twice:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

---

## Interface change log

Every change to `src/shared/interfaces` after P0 gets a row here. Either person may append a row.

| Commit | Interface | Change | Additive? | Real impl updated in |
| --- | --- | --- | --- | --- |
