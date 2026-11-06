# Lanyard · Tracker

Implementation progress goes here; explicit user-authorized plan corrections are recorded separately below. **Edit only your own track's progress** to avoid conflicts. P0/integration sections are updated with their work. Update status with its spec, but commit only when the user asks; the user pushes manually.

Status values: `todo` · `doing` · `done` · `blocked`. Finding status: `open` · `fixed <sha>` · `known limitation`.

---

## P0 · Foundation (joint)

### Spike (P0.6)

| Check | Result | Notes |
| --- | --- | --- |
| S1 Local dev APK + AppKit connects MetaMask mobile | todo | |
| S2 Wallet adds and switches to Rabdi | todo | |
| S3 Arkiv SDK on Hermes with AppKit signer (record polyfills) | todo | |
| S4 `executeBatch` = one approval | todo | |
| S5 S2–S4 on Expo web (wagmi adapter) | todo | |
| S6 Deploy + call a contract on Rabdi | todo | |
| S7 Archive Sepolia read at a past block from the phone | todo | |
| S8 Public Rabdi RPC load + ENS read volume | todo | |
| S9 Installed SDK/schema/index/access/gas evidence | todo | |
| S10 Capture/deletion/reset/confirmation evidence | todo | |
| S11 Cross-runtime cipher and canonical test vectors | todo | |
| S12 Linked-create prediction/custody or confirmed sequential fallback | todo | |

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

### Specs

| Spec | Owner | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| P0.6 Wallet and chain spike | pair | todo | | |
| P0.1 Repo skeleton and CI | A | todo | | |
| P0.2 Shared types, config, deployments | B | todo | | |
| P0.3 Interfaces, mocks, conformance | pair | todo | | |
| P0.4 Fixtures | B | todo | | |
| P0.5 App shell | A | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

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
| A2.2 Scoped grants | todo | | |
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
| A4.3 ENS consoles | todo | | |

**Bug hunt:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

---

## Track B · Person B

### B1 · Arkiv data and faucet

| Spec | Status | Commit | Notes |
| --- | --- | --- | --- |
| B1.1 Chain and faucet | todo | | |
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

**Two-phone smoke:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

### I4 · Full demo

**Demo script green twice:** todo · **Merged:** no

| # | Found by | What we tried | Expected | Actual | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |

---

## Interface change log

Every change to `packages/shared/src/interfaces` after P0 gets a row here. Either person may append a row.

| Commit | Interface | Change | Additive? | Real impl updated in |
| --- | --- | --- | --- | --- |
