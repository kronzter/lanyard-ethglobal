# B2 · Rules engine and verifier

**Track:** B · **Branch:** `phase/B2-rules-verifier` · **Depends on:** B1, P0 `EnsReader` mock · **Integration:** I2

## Goal

`src/rules`: one pure function, used by the app (on Hermes and in the browser) and by `lanyard verify` (on Node), that decides which Arkiv records count. Anyone can write anything to Arkiv; the rules decide what's real.

**Arkiv decides who can edit a record (its owner). ENS decides whether the record counts (the writer held the right badge at that moment).**

Built entirely against `MockEnsReader` and `fixtures/ens-history.json`. The real reader arrives at I2.

Implement [the evidence/evaluation contract](01-evidence-and-interfaces.md). Verification reproduces operator-attested captured inputs; it does not query historical Rabdi state or prove capture completeness.

## Out of scope

Feature-specific rules for volunteers, tickets and judging. Those ship with their features in B3 and B4, plugged into the engine built here.

## How a record is judged

1. **Writer.** `$creator` and creation flags match the kind policy. Current ownership controls mutation, not captured provenance.
2. **Claimed badge.** The `by` attribute names an ENS label, e.g. `priya.volunteers`.
3. **Badge belonged to writer.** `EnsReader.owner`, not its address record, matches the creator at creation time. Authority-only kinds instead match frozen authority addresses; their descriptive `by` labels need not be badges.
4. **Badge allowed it.** At that time the badge was unexpired, not unregistered, and carried any needed permission note.
5. **Kind-specific condition** (registered by B3/B4).

"At the time" uses captured creation block/timestamp → `EnsReader.sepoliaBlockAt(timestamp)` → historical ENS reads. Retain observation metadata instead of relabeling a later read as historical state. Explicit evaluation context supplies present-tense duty, expiry and judge-revocation checks. Unavailable timestamps are errors, not guessed two-second conversions.

Records that fail are kept and shown greyed out with a reason, never hidden.

---

### B2.1 · Time mapping

**Requirements**
- **B2.1-R1** THE `src/rules` module SHALL retain available recent Arkiv creation timestamps in B1's capture store and map them through `EnsReader.sepoliaBlockAt`. Missing timestamp evidence fails; arbitrary old Rabdi block reads are not a dependency.
- **B2.1-R2** WHEN a timestamp falls between two Sepolia blocks, THE mapping SHALL pick the earlier block.
- **B2.1-R3** THE mapping SHALL be an input to the rules, prepared outside them, so the rules stay pure.

**Commit:** `feat(rules): B2.1 arkiv-to-sepolia time mapping`

---

### B2.2 · Rules core

**Requirements**
- **B2.2-R1** THE rules SHALL implement `evaluate(records, ensSnapshot, context, config, ruleVersion)` from the shared contract, with explicit cutoffs, frozen config/authorities and no clocks, randomness or network calls inside.
- **B2.2-R2** THE engine SHALL apply steps 1–4 to every record, then call the kind's registered rule, returning `{ counts: boolean, reason?: string }` per record.
- **B2.2-R3** THE engine SHALL ship the organizer-only kinds now: `venue`, `seat_assignment` and `acceptance` count only if written by the organizer; a `seat_assignment` also requires `EnsReader.owner(hacker_label)` == `hacker_address` at creation; `rubric` only if written by the organizer (any track, and the only writer for `main`) or by a partner for its own track; `results` only by the results key; `drip` only by the configured desk wallet.
- **B2.2-R4** THE engine SHALL use integer arithmetic, stable sorting, and deterministic tie-breaks (earliest block, then lowest record key).
- **B2.2-R5** `prepare(records, ensReader, context, config)` SHALL deduplicate creation-time, action-time and evaluation-cutoff ownership/expiry/registration-ID/note reads and unregister intervals. Required read failures throw; current state is never a historical substitute. Permission notes require their shared registration/holder binding, not just the presence of a permission string. Pin continuous judge registration and every present-tense decision at the supplied cutoff. B4 extends preparation with authorization before score decryption and independently regenerated plaintext/rejection entries; raw captured bytes remain separate.
- **B2.2-R6** THE `src/rules` module SHALL import nothing Node-only, so it runs unchanged on Hermes, in the browser and on Node.

**Tasks**
- [ ] Engine with a per-kind rule registry
- [ ] `prepare` step
- [ ] Organizer-only and results-key kinds
- [ ] Organizer screen (web-only) listing greyed records with reasons
- [ ] Canonical bundle/config schema, operator attestation, explicit cutoffs and retained version selection

**Commit:** `feat(rules): B2.2 pure rules engine with prepare step`

---

### B2.3 · Determinism and `lanyard verify`

**Requirements**
- **B2.3-R1** THE rule version SHALL use the reproducible source-manifest hash in the shared contract, exported as `RULES_VERSION`. All runtimes SHALL use its canonical bigint/bytes/map encoding for input/config/output hashes.
- **B2.3-R2** WHEN the input order is shuffled 1,000 times, THE output SHALL not change.
- **B2.3-R3** `lanyard verify <event> --bundle <path>` SHALL authenticate bundle hash/signature against the locked publication when online, check the configured signer/config/rule version, independently read historical ENS state and recompute captured inputs. Print `MATCH — operator-attested captured inputs; completeness not proven` or the first difference. Without a path, fetch and hash-check the committed bundle URI. An expired Arkiv results row is not required: use the locked ENS commitment and bundle. A wholly offline reproduction is labeled `LOCAL_REPRODUCTION`, never an independently checked publication/ENS verdict.
- **B2.3-R4** WHEN any read fails, THE CLI SHALL exit non-zero, naming the failing read, and never print `MATCH`.
- **B2.3-R5** Pure evaluation/hash of a prepared 2,000-record bundle SHALL finish under a minute. Measure cold archive preparation separately, including call counts/cache hits, respecting P0's rate limits; do not promise an unmeasured network SLA.
- **B2.3-R6** `lanyard hash <event> --bundle <path>` SHALL print the rules output hash for identical bundle/config/context bytes without a published results record. There is no historical `--arkiv-block` mode.
- **B2.3-R7** THE app SHALL import the same prepared bundle and show the same output hash as Node; equal numeric heads without equal inputs are not a determinism test.
- **B2.3-R8** Published-result verification SHALL independently enforce both saved cutoff timestamps in `[results, freezeDeadline)`, with the shared config ordering. An early or late cutoff cannot produce `MATCH` even with a valid operator signature. Verification long after the window remains valid for an in-window frozen context; current time is irrelevant. `hash` may evaluate explicit development contexts but cannot claim a published-result verdict.

**Commit:** `feat(cli): B2.3 RULES_VERSION, lanyard verify and lanyard hash`

---

## Phase bug hunt

- [ ] A badge owned by a different wallet is rejected even when its address record points at the creator
- [ ] A record written one block before a badge's `unregister`: counts. One block after: rejected
- [ ] A badge unregistered, then the label re-registered to someone else: old records stay tied to the old owner
- [ ] A record at exactly a badge's expiry second: rejected
- [ ] A timestamp between two Sepolia blocks: the earlier block is used
- [ ] A `seat_assignment` written by a volunteer: rejected with a reason, still shown
- [ ] An organizer `seat_assignment` whose `hacker_label` isn't owned by `hacker_address`: rejected with a reason
- [ ] The same inputs on two laptops, and on the Android app: identical output hash
- [ ] Grep `src/rules` for `Date.now`, `Math.random`, `fetch` and Node built-ins: none
- [ ] Prepared 2,000-record evaluation/hash finishes under a minute; cold network preparation measured separately
- [ ] The mock RPC throws mid-verify: the CLI fails loudly
- [ ] Canonical bytes/hash agree on Node/browser/Hermes for bigint, maps, bytes and non-ASCII strings
- [ ] Missing inputs/config, altered signature, unavailable rule version, capture gap or changed block hash: no `MATCH`
- [ ] Deleted captured source rows still reproduce; deletion before first observation is explicitly unprovable
- [ ] Current changes cannot alter a frozen evaluation; changing its cutoff is a new input
- [ ] Signed early/late publication contexts fail verification, while a valid saved context verifies after `freezeDeadline`
- [ ] Reissued badge plus old lead note fails binding checks; old historical actions and same-registration renewal remain reproducible
- [ ] B4 score preparation rejects forged/junk rows before decryption and recomputes eligible per-record decryption verdicts instead of trusting bundled plaintext

## Phase done when

- [ ] B2.1–B2.3 marked done in `TRACKER.md`
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] Merged into `main`
