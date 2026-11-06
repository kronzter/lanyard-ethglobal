# Lanyard · Tracker

Implementation progress goes here; explicit user-authorized plan corrections are recorded separately below. **Edit only your own track's progress** to avoid conflicts. P0/integration sections are updated with their work. Update status with its spec. Commits happen only when the user asks; agents may push non-`main` branches and open PRs, and the user merges.

**Builders:** Person A = `@kronzter` (ENS & venue track, app shell) · Person B = `@arnavmahajan630` (Arkiv & flows track).

Status values: `todo` · `doing` · `done` · `blocked`. Finding status: `open` · `fixed <sha>` · `known limitation`.

---

## P0 · Foundation (joint)

### Spike (P0.6)

| Check | Result | Notes |
| --- | --- | --- |
| S1 Local dev APK + AppKit connects MetaMask mobile | todo | **A.** Needs an Android SDK + eas-cli build host, a Reown project ID and MetaMask on a phone |
| S2 Wallet adds and switches to Rabdi | todo | **A**, with B pairing |
| S3 Arkiv SDK on Hermes with AppKit signer (record polyfills) | todo | **A + B** pair (phone). Hermes needs `crypto.getRandomValues`: the SDK's random entity salt throws `NoRandomSourceError` without it |
| S4 `executeBatch` = one approval | todo | **A + B** pair (phone wallet) |
| S5 S2–S4 on Expo web (wagmi adapter) | todo | **A**, after the AppKit web adapter is wired |
| S6 Deploy + call a contract on Rabdi (decides Faucet vs desk-wallet `drip` fallback) | todo | **B**, Node. Blocked on a tGLM-funded throwaway key in `.env` as `RABDI_SPIKE_PRIVATE_KEY` |
| S7 Archive Sepolia read at a past block from the phone (public read-only app key) | todo | **A**. Needs an archive Sepolia RPC key restricted to the app |
| S8 Rabdi RPC load (keyless, then public app key if needed) + ENS read volume | todo | **A + B**. Keyless single reads work; load test pending, ideally with an Arkiv access key from hub.arkiv.network to compare |
| S9 Installed SDK/schema/index/access/gas evidence | doing | **B.** `@arkiv-network/sdk` 1.0.1 pinned on `p0/P0.6a-arkiv-spike`. Source inspected: schema-typed creates (`defineSchema`, indexed columns), creation flags `readonly`/`permissionlessExtension`, expiries only via `ExpirationTime` capped at `MAX_LIFETIME` 7,884,000 blocks, query module has no `ne`/`not`, `predictEntityKeys`. Explicit `rabdi({ accessKey: "" })` reads work against the public endpoint (SDK warns it is heavily rate limited). Gas behaviour pending writes |
| S10 Capture/deletion/reset/confirmation evidence | doing | **B.** Read half measured 2026-11-06: each query page reports the block it was read at (pages of one query can differ); genesis hash `0xa65a2b9e25129f0e8ccdf494dfd66ec744bdf400c806b832b1da86b0b939cbce` is the reset-identity candidate; `finalized` advances in 32-block epochs and lagged `latest` by 65–93 blocks over 4 min. Create/delete/readback and the confirmation depth to freeze into config wait for the funded key |
| S11 Cross-runtime cipher and canonical test vectors | todo | **B**, before B4; Hermes run with A's dev build |
| S12 Linked-create prediction/custody or confirmed sequential fallback | doing | **B** (Node), then **A + B** on phone/web for wallet custody. SDK derives `key = keccak256(chainId, 0x4400…0044, owner, entityNonce, salt)`; the entity nonce is separate from the transaction nonce, and a prediction only holds while nothing else from that owner lands first. On-chain prediction and intervening-create test wait for the funded key |

**Fallbacks chosen:** none yet.

**Capability evidence:** SDK package/declarations, exact versions, confirmation depths, archive log limits, build host, cipher package/encoding and linked-create prediction/custody or sequential fallback remain unmeasured until P0.6 records them. Revised requirements do not count as passed spike checks.

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
| M9 | P0.1 CI ran `expo export` before the app existed | Runs once P0.5 creates `apps/app` | revised |
| M10 | Bug-hunt prompt skipped the authoritative contract | Prompt also reads `01-evidence-and-interfaces.md` | revised |

### Approved plan repair · 2026-11-06 (single app, Track B first)

Scope approved in conversation: Person A (`@kronzter`) unavailable at P0 start; Person B (`@arnavmahajan630`) builds the P0 slice B1 needs. No implementation milestone is marked done by this repair.

| # | Concern | Revised contract / owning phase | Plan status |
| --- | --- | --- | --- |
| S1 | 8-package pnpm monorepo and ENSv2 git submodules add Expo/Metro/EAS friction | One Expo project at the repo root, plain `src/` folders, `cli/`, one `contracts/` Foundry project with Soldeer deps; ESLint import boundaries + CODEOWNERS; all plan paths rewritten | revised |
| S2 | P0 blocked on both builders | Track B slice (P0.1, P0.2, P0.4a, P0.5a, P0.6a S6/S9/S10/S12) merges first; P0.3, remaining fixtures, AppKit/Android and ENSv2 deferred to before the phase that needs them (`P0-foundation.md`) | revised |
| S3 | One commit per spec; agents never push | Several small spec-tagged commits ending in a `docs(tracker)` commit; per-spec stacked PR branches; agents push non-`main` branches, never `main` | revised |

### Specs

| Spec | Owner | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| P0.6 Wallet and chain spike | pair | doing | | **B (Node half):** S9, S10, S12 in progress; S6 and the write halves need a funded Rabdi key. **A (phone half):** S1–S5, S7, S8 not started. See the Spike table |
| P0.1 Repo skeleton and CI | B (swapped from A) | done | bd95a4b | PR #1; CI green ([run 42172719701](https://github.com/kronzter/lanyard-ethglobal/actions/runs/42172719701)). Single Expo app (SDK 58, Node 24, pnpm hoisted), `lanyard/boundaries` lint rule, context-aware secret scan (fake key rejected, hashes and Anvil keys allowed, verified in a fresh clone), one Foundry project with Soldeer forge-std 1.17.0, CODEOWNERS test. ENSv2 pin deferred to A1 |
| P0.2 Shared types, config, deployments | B | blocked | 9ad0618 | Implemented in `src/shared/` (186 tests): canonical labels (ENSIP-15 + strict policy), RFC 8785 canonical JSON + keccak + strict parser, event config (placeholder Dec 2026 IST times; mock authority wallets from the public test mnemonic), freeze window and `namespaceExpiry`, venue/routing shapes, mock/live deployments schema, team-page content and URL helper. **Blocked only on measured values:** Sepolia confirmations/reset ID (S7), Rabdi confirmations/reset ID (S10), score cipher (S11), `shiftWriteProfile` (S12), funding profile (S6). They are `unmeasured`, so `configHash` and `requireLive` throw `BlockedCapabilityError` |
| P0.3 Interfaces, mocks, conformance | pair | todo | | Deferred until each consumer needs it: `EnsReader` + `IdentityDirectory` mocks before B2, `StubRouter` before B3, `MockResultsPublisher` before B4. B writes them; A reviews, since A2.4/A3.2/A4.2 must pass the same suites |
| P0.4 Fixtures | B | doing | b0a654e | **P0.4a done:** `personas.json` (46 personas, R1 roster; addresses from the public test mnemonic, verified by re-derivation; authority personas match `event.config.ts`; key env names only, listed in `.env.example`) and `assertByLabelsKnown`. **Deferred per the Track B slice:** `ens-history.json` and `timeline.json` (before B2), `venue.small.json` (before B3), R5 evidence scenarios (before B4) |
| P0.5 App shell | A (web slice by B) | doing | 7c41578 | **P0.5a done (web):** route folders with phase placeholders (R1), `flags.ts` + `providers.ts` composition root failing loudly for unwired providers (R4), web-only guard (R7, unit-tested; Android check pending), public `/teams/[team]` with no wallet gate, `output: "single"`, static-host rewrites (`public/serve.json`, `_redirects`), and `smoke:web` proving direct navigation/reload in CI plus a headless-Chromium render locally (R8). Intended public origin **not chosen yet** (mock `http://localhost:8081`); record it before A2 writes live ENS `url` records. **Pending (Person A / phone):** `eas.json` and local APK scripts (R2), AppKit `useWallet()` (R3), stub `<VenueMap>` (R5), `IdentityDirectory` role selection (R6) |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### Next up

**Person B · `@arnavmahajan630`**

1. Finish the Node half of the spike: S6 (deploy and call a contract on Rabdi), S10 writes (create, delete, readback; freeze the confirmation depth and reset ID into config), S12 on-chain key prediction. Needs `RABDI_SPIKE_PRIVATE_KEY` funded with tGLM.
2. Merge PRs #1–#4 and the spike results into `phase/P0-foundation`, then into `main`.
3. Start B1 from `main`: B1.1 Rabdi chain config plus the Faucet contract or the desk-wallet `drip` fallback (decided by S6). The B1.1 faucet screen signs with the desk wallet, so its in-app signing waits for A's `useWallet()`; contract, writer code and Node tests do not.
4. Before B2: P0.3 `EnsReader`/`IdentityDirectory` interfaces, mocks and conformance, plus `ens-history.json` and `timeline.json`.

**Person A · `@kronzter`**

1. Review PRs #1–#4 (repo layout, CODEOWNERS, shared types).
2. Set up a local Android build host (Android SDK, JDK, eas-cli) and get a Reown project ID and an archive Sepolia RPC key.
3. Phone half of the spike: S1–S5, S7, S8 (S3/S4 paired with B).
4. Rest of the app shell: `eas.json` and the local APK scripts (R2), AppKit `useWallet()` on Android and web (R3), stub `<VenueMap>` (R5), `IdentityDirectory` role selector (R6), and the "Open on web" check on a real Android build.
5. Then A1: add ENSv2 as a Soldeer git dependency (candidate `ensdomains/contracts-v2` tag `sepolia-deployment-2026-09-15` = `f2f0a05`) and verify ABI and on-chain implementation compatibility.

---

## Track A · Person A

### A1 · Namespace

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| A1.1 Base name and edition registry | todo | | |
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
