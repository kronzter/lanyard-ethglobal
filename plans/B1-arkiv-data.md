# B1 · Arkiv data layer and faucet

**Track:** B · **Branch:** `phase/B1-arkiv-data` · **Depends on:** P0 (including the P0.6 spike results) · **Integration:** I1

## Goal

One package, `packages/arkiv`, that every screen uses to write, read and watch Lanyard's records on Rabdi, signing with the user's own wallet through AppKit. Plus the on-chain `Faucet` that gives each new user their first tGLM. Track B's later phases build only on this.

Follow [the evidence contract](01-evidence-and-interfaces.md): live rows are current observations, readonly does not prevent deletion/transfer, and retained capture is operator-attested rather than a historical chain snapshot. Funding uses the `Faucet` contract, or the P0.6 desk-wallet + `drip` record fallback.

## Out of scope

Deciding whether a record *counts* (B2). ENS reads: until I2, `by` labels come from `fixtures/personas.json`.

## Record kinds

Every record carries `app: "lanyard"`, `event: "mumbai2026"`, `kind`, and `by` (the writer's relative ENS label).

| `kind` | Owner | Flags | Expires | Other attributes |
| --- | --- | --- | --- | --- |
| `venue` | Organizer | readonly | Event end + 30 d | `version` (payload: `venue.json`) |
| `seat_assignment` | Organizer | readonly | Event end + 7 d | `hacker_address`, `hacker_label` (the `hackers` badge), `seat`, `venue` |
| `shift` | Lead | readonly | Event end + 7 d | `volunteer`, `zone`, `starts_at`, `ends_at`, `supersedes?` |
| `clock` | Lead or volunteer | readonly | Event end + 7 d | `volunteer`, `shift`, `action` (`in`/`out`), `stated_at?` |
| `duty_pass` | Lead | readonly | Event end + 7 d | `volunteer`, `shift`, `ends_at` (logical display deadline) |
| `ticket` | Hacker | readonly | Event end + 7 d | `seat`, `venue`, `category`; logical close = creation timestamp + 4 h |
| `ticket_claim` | On-duty volunteer, or partner staff for partner tickets | readonly | Event end + 7 d | `ticket`; logical lease end = creation timestamp + 15 min |
| `ticket_resolution` | Same as the winning claim | readonly | Event end + 7 d | `ticket`, `claim`, `seat` |
| `ticket_confirmation` | Ticket's hacker creator | readonly | Event end + 7 d | `ticket`, `resolution` |
| `project` | Team lead | none | Results + 30 d | `team`, `track`; bytes: editable `TeamPageContent` and project contents |
| `submission` | Team lead | readonly + permissionlessExtension | Maximum | `project`, `team`, `track`, `content_hash`; bytes: immutable project/`TeamPageContent` snapshot and lead address |
| `acceptance` | Organizer | readonly | Results + 30 d | `submission`, `track` |
| `rubric` | Organizer or partner | readonly | Results + 30 d | `track` (payload: criteria, weights, scale) |
| `judge_assignment` | Organizer or partner | readonly | Results + 30 d | `judge`, `submission`, `rubric` |
| `score_sheet` | Judge | none | Judging end + 2 d | `submission`, `judge`, `rubric`, `assignment`; encrypted mirror of a device-local editable draft |
| `final_score` | Judge | readonly | Results + 30 d | `submission`, `judge`, `rubric`, `assignment`; authenticated encrypted bytes |
| `recusal` | Target judge (self only) or organizer | readonly | Results + 30 d | `submission`, `judge`; target binding is mandatory |
| `results` | Results key | readonly + permissionlessExtension | Maximum | bytes: compact rankings, results/bundle/config hashes, URI, operator signature, cutoffs and rule version |
| `drip` | Desk wallet | readonly | Event end + 7 d | `recipient`, `tx`; written only under the P0.6 desk-wallet funding fallback |

Attribute types: labels and IDs are `str` (≤128 bytes); times are `u64` Unix seconds; references are record keys.

Declare per-column indexes explicitly for all reader predicates. JSON snapshots, score ciphertext and summaries use bytes columns and are not indexed. Draft `project`/`score_sheet` rows never supply authoritative submitted contents. Use immutable `submission` references throughout adjudication. Validate creation flags and `$creator`, not only public tags. Badge/team kinds use historical registry ownership; authority-only kinds use frozen configured addresses. Current ownership does not rewrite captured provenance.

Expiry is physical retention in blocks, not the application's lease/session clock. Ticket/claim deadlines derive from the observed creation timestamp. Extending retention never extends a logical deadline. Retain judging dependencies in capture through freeze and in the exported bundle afterward; short-lived drafts are not verification inputs.

---

### B1.1 · Chain and faucet

**Requirements**
- **B1.1-R1** THE package SHALL pin P0.6-validated SDK 1.0.x/viem versions and export Rabdi config (ID `7794095`) and keyless wallet-add parameters. Reader access configuration is separate and redacted in logs: the app may ship a dedicated read-only Arkiv access key as a public value if P0.6 shows keyless is too limited (proxy only as the further fallback); no operator or signing key goes in wallets or app bundles.
- **B1.1-R2** THE app-side Arkiv client SHALL sign with the EIP-1193 provider from the shell's `useWallet()` (AppKit), never with a raw key. Only local scripts and the CLI take a key, from their own `.env`.
- **B1.1-R3** THE `Faucet` contract (`packages/faucet`, on Rabdi) SHALL hold organizer-funded tGLM, and its `drip(address)` SHALL send a fixed amount at most once per address, callable only by the organizer or addresses the organizer has given the desk role.
- **B1.1-R4** THE `/organizer/faucet` web-only screen SHALL let a desk wallet scan or paste an address, call `drip`, and show the transaction and the new balance. A fresh wallet has no gas to call `drip` itself, which is why the desk calls it.
- **B1.1-R5** THE package SHALL expose an in-memory `FakeArkiv` with the same app API for tests, enforcing native owner/flags/expiry behavior, allowing owner deletion/transfer of readonly records, and rejecting historical-query options. Simulate changing pages and capture gaps.
- **B1.1-R6** THE faucet address SHALL be written to `deployments/rabdi.json`.

If the P0.6 spike chose the no-contract fallback, R3 and R6 are dropped and these apply instead:
- **B1.1-R7** THE `/organizer/faucet` screen SHALL send a fixed tGLM amount (from `event.config.ts`) from the dedicated desk wallet, then write a readonly `drip {recipient, tx}` record from that wallet after the transfer receipt.
- **B1.1-R8** WHEN a `drip` record from the configured desk wallet already exists for that address, THE screen SHALL refuse before sending. An uncertain earlier transfer is reconciled by its receipt before any new send.
- **B1.1-R9** THE desk wallet address SHALL be written to `deployments/rabdi.json`.

**Commit:** `feat(arkiv): B1.1 rabdi chain config, faucet contract and faucet screen`

---

### B1.2 · Typed record kinds and writers

**Requirements**
- **B1.2-R1** THE package SHALL define one typed schema per kind in the table above and export a writer per kind.
- **B1.2-R2** WHEN any write is made, THE writer SHALL attach the four common attributes, plus the expiry and flags from the table.
- **B1.2-R3** WHEN a write would exceed Arkiv limits (32 attributes, 128-byte strings, 128 KiB payload, maximum lifetime), THE writer SHALL reject it before sending.
- **B1.2-R4** WHEN an extension would move expiry earlier, THE writer SHALL reject it.
- **B1.2-R5** THE `arkiv/schema.md` SHALL be generated from the schemas, not written by hand.

**Commit:** `feat(arkiv): B1.2 typed record kinds and writers`

---

### B1.3 · Write queue, batches, readers, live watcher

**Requirements**
- **B1.3-R1** THE wrapper SHALL persist intent before a wallet call, serialize writes per device/account, preserve hash/nonce evidence, and check successful receipts and readback. On uncertain send, timeout, backgrounding or restart it SHALL reconcile known transactions before a new signature; empty readback never proves failure. Without enough evidence, remain `uncertain`. A local queue does not guarantee cross-device coordination.
- **B1.3-R2** WHEN the user rejects a request in their wallet, THE queue SHALL drop that write with a clear message and not retry it.
- **B1.3-R3** Lead clock-in + duty pass for an existing shift SHALL use one `executeBatch` and verify ordered created keys. Active replacement follows P0-S12's frozen `shiftWriteProfile`: `linked-create` predicts/reuses all exact keys/salts under proven exclusive creator custody, while `confirmed-sequential` first confirms/persists the replacement key and then batches its clock/pass. The latter takes two approvals and has a visible inactive interval; persist/reconcile each step without resending a confirmed shift. Prediction/readback mismatch or uncertain custody stops new writes. An offer is derived UI state, not an entity or an atomic claim race.
- **B1.3-R4** THE readers SHALL be typed, and SHALL skip, not crash on, records that fail schema parsing.
- **B1.3-R5** THE live hook SHALL use events as invalidation, re-read affected current rows, periodically reconcile bounded scans, and sweep physical/logical deadlines. On gaps, reconnects or resets, rebuild current state and disclose incomplete status. Never fabricate old values or silently reopen an unverifiable resolved ticket.
- **B1.3-R6** THE readers SHALL never use `ne()` or `not()`; a lint rule enforces this.
- **B1.3-R7** THE readers SHALL cache on the device and stay inside the public-RPC limits measured in P0.6.
- **B1.3-R8** THE package SHALL provide `captureForEvent` and an append-only local observation store per the shared contract, exporting raw typed bytes/metadata, observed page blocks/hashes, known keys and gaps. Malformed trusted inputs or lost known evidence SHALL block automatic freeze.

**Tasks**
- [ ] Per-device/account queue with durable intent, receipt reconciliation and unresolved-send state across restarts
- [ ] Batch helper
- [ ] Readers: `ticketsOpenInZone`, `myShifts`, `projectsForJudge`, `leaderboardInputs`, `allRecordsForEvent`
- [ ] `useArkivLive` React hook
- [ ] Bounded indexed readers, explicit paging budgets, capture store and startup/reconnect reconciliation
- [ ] Start `arkiv/friction.md`, and add to it every time something surprises you

**Commit:** `feat(arkiv): B1.3 write queue, batches, readers and live hook`

---

## Phase bug hunt

- [ ] A string attribute over 128 bytes, 33 attributes, a payload over 128 KiB: all rejected before sending
- [ ] Expiry beyond the maximum lifetime: rejected with a clear error
- [ ] Extending to an earlier deadline: rejected
- [ ] Patching a readonly record on Rabdi: `ReadOnlyEntity`
- [ ] A stranger writes junk with `app: "lanyard"`: readers skip it, nothing crashes
- [ ] Kill the network mid-write and reconnect: no duplicate, the queue reconciles
- [ ] Background the app while the wallet is asking for approval, approve, come back: exactly one record
- [ ] Reject the request in the wallet: the write is dropped with a message, with no retry loop
- [ ] Phone/web concurrent writes: conflicting nonce/history evidence stops automatic retries; concurrent custody is disclosed as unsupported
- [ ] A clock-in batch asks for exactly one approval
- [ ] Active shift replacement uses the selected S12 profile: exact predicted links or two confirmed steps; rejection/restart after the first step preserves its key and never invents duty
- [ ] An intervening create invalidates linked predictions; mismatched keys/references stop progress without retrying or silently changing profile
- [ ] The watcher loses its connection: `onError` fires and the UI shows "live updates paused"
- [ ] A record passes its `$expiresAt` block: the hook drops it without an event
- [ ] An owner extends claim retention: the logical lease still ends after 15 min
- [ ] Delete/transfer readonly records: native behavior is modeled and captured provenance is preserved
- [ ] Changing page blocks or an exhausted page budget never produce an atomic/historical snapshot claim
- [ ] A known missing claim makes resolution unverifiable rather than silently reopening the ticket
- [ ] Contract profile: `drip` twice to one address: the second reverts. `drip` from a wallet without the desk role: reverts
- [ ] Desk-wallet fallback: a second send to an address with a desk-wallet `drip` record is refused before sending; a `drip` record written by any other wallet is ignored
- [ ] Search the web export and the APK for any private key: absent
- [ ] Sneak a `ne()` into a reader: lint fails

## Phase done when

- [ ] B1.1–B1.3 marked done in `TRACKER.md`
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] Merged into `main`
