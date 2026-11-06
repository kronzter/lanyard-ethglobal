# B4 · Judging and freeze

**Track:** B · **Branch:** `phase/B4-judging` · **Depends on:** B1–B3, P0 `MockResultsPublisher` + `StubRouter` · **Integration:** I4

## Goal

Partners judge their own tracks, global judges judge the non-partner `main` track, teams own their submissions, scores stay hidden until freeze, and anyone can recompute the results. The freeze CLI calls `ResultsPublisher` so winners get `winner.<team>.<edition>.<base>` (mocked until I4).

Use [the shared evidence, evaluation, routing and recovery contract](01-evidence-and-interfaces.md). Rankings are shown only after freeze. Capture is operator-attested; earliest means earliest valid candidate in the retained captured set, not a provably complete first-ever chain history.

## Out of scope

The winner-name contract and the resolver lock (A4). Issuing partner judges (A4.3 console; seeds use the A2.2 scripts). **Prize rules are TBD** (`00-CONTEXT.md` §14): until they're decided, the freeze takes the winning teams and their prize strings from `fixtures/prizes.json`.

---

### B4.1 · Projects, submissions, acceptance, assignments

**Flow:** lead edits a mutable project draft → creates a readonly submission containing exact project content/team/track/lead plus its content hash → organizer accepts that submission key/track → organizer or that track's partner assigns judges to that submission and frozen rubric. Capture retains each readonly dependency while available. Later draft edits cannot affect the submission, assignment or ranking.

**Requirements**
- **B4.1-R1** A submission counts only when its captured creation timestamp is strictly less than `submissionDeadline`; equality is late. Derive deadlines from explicit timestamps, not an unspecified cross-chain deadline block.
- **B4.1-R2** WHEN anyone but the team lead (the team name's owner at that time) writes a submission, THE rules SHALL reject it.
- **B4.1-R3** Count the earliest valid captured submission per team before deadline by creation block/key, showing duplicates. Deleting a captured submission does not replace it; an earlier candidate deleted before observation cannot be ruled out and is disclosed as a limitation.
- **B4.1-R4** WHEN the organizer tries to patch a team's project, THE write SHALL fail, because only the owner can patch.
- **B4.1-R5** THE team screen SHALL show the creator, owner and block for the project and the submission, and SHALL disable "Submit" once a valid submission exists.
- **B4.1-R6** THE rules SHALL accept a `judge_assignment` from the organizer (any track), from a partner for its own track only, or from the head judge for the `main` track only. The assigned judge must match the track: a global judge (`judges` book) for `main`, that partner's judge for a partner track.
- **B4.1-R7** THE team screen SHALL render the winner badge through `providers.winnerBadge`, a no-op component until I4 wires in A4.3's `<WinnerBadge>`.
- **B4.1-R8** Submission bytes SHALL contain the canonical immutable content, project key, team/track IDs and lead address, bound by `content_hash`. Acceptance, assignment, final and recusal references SHALL use the submission key; a mutable project's current contents never determine results. Copies of external linked code/media are not implicitly archived: commit to their hashes and disclose any unavailable external bytes.
- **B4.1-R9** A track's earliest valid captured rubric created before submission deadline is the frozen rubric (block/key tie-break); later rubrics are ignored with a reason. The `main` track's rubric can only come from the organizer. Weights must be positive integers with nonzero total, criteria unique and scales bounded. Every assignment/final references that rubric. Only accepted, timely submissions and assignments made before judging end can supply scores.

**Commit:** `feat(rules): B4.1 projects, single submission, acceptance and assignments`

---

### B4.2 · Judge flow

**Requirements**
- **B4.2-R1** THE caller SHALL map each submission's frozen lead address to the latest valid seat assignment with that `hacker_address` in the evaluation venue (every lead holds a `hackers` badge), pass `LocatedStop[]` to `judgeRoute`, and list missing locations separately. The router has no Arkiv imports or hidden project lookup.
- **B4.2-R2** THE judge SHALL edit a durable device-local draft and mirror it to an encrypted Arkiv `score_sheet`, following the shared draft contract. Native AsyncStorage/browser IndexedDB save editable values before showing "Saved on this device"; remote sync status is separate. Restore by wallet/event/submission/assignment/rubric/key ID after restart, hide other wallets' drafts, and seal a readonly `final_score` from local values. On another device or after storage loss, require explicit score re-entry; ciphertext is not a recoverable editable draft and missing values are never replaced with zero. Reconcile existing finals before a new seal.
- **B4.2-R3** Remote score drafts and finals SHALL use the pinned P0.6-S11 authenticated sealed-envelope implementation and public key/key ID in frozen config. Bind event, submission, judge, rubric and assignment as authenticated associated data; use fresh secure randomness. Apply metadata/authority/reference/deadline/recusal eligibility before decryption. Validate the operator key against the configured public key and cipher test vector, then decrypt eligible candidates and validate criterion shape/ranges. Malformed envelopes, wrong context, failed authentication or invalid values reject that candidate with a deterministic reason; they do not halt valid results. Unavailable/mismatched operator keys, broken cipher implementation or missing/corrupt required evidence stop freeze. The event private key stays only with the freeze operator until intentionally published inside an allowed freeze; local editable drafts do not require it. It is never a wallet signing key.
- **B4.2-R4** A judge-authored `recusal {submission, judge}` counts only when the creator owns the target judge badge at creation and is assigned to that submission: judges may recuse only themselves. The configured organizer may recuse any assigned judge. Reject a different target, invalid assignment or cross-track reference with a reason. A valid captured recusal before the evaluation cutoff excludes that judge/submission pair.
- **B4.2-R5** WHEN a partner judge scores a project outside its own partner's track, or a global judge scores a project outside the `main` track, THE rules SHALL reject it.
- **B4.2-R6** At freeze, a judge needs valid badge ownership at final creation and continuous registration through the frozen Sepolia cutoff. An unregister/re-registration invalidates that registration's earlier scores, even if reissued to the same address. Renewal without unregister follows the shared eligibility policy. Revocations after cutoff cannot alter frozen results.
- **B4.2-R7** The earliest eligible, successfully decrypted and range-valid captured final per judge/submission counts; later valid finals show duplicates, invalid ones retain rejection reasons. A final's timestamp must be before `judgingEnd`, after its referenced submission/assignment, and its creator must be that assigned judge. A captured deleted final remains evidence; deletion before observation is not detectable completeness. Preserve raw ciphertext separately from derived plaintext/rejection entries so verification can regenerate every decision.

**Commit:** `feat(rules): B4.2 judge route, sealed scores, recusal and revoked-judge rules`

---

### B4.3 · Aggregation and leaderboard

**Requirements**
- **B4.3-R1** THE rules SHALL compute, per track, the **raw weighted mean** of each project's counted final scores, using that track's rubric weights. This is the only method.
- **B4.3-R2** Criterion values are integers in hundredths of the configured scale. Compute each judge total as `sum(value * weight)` and a project's rational mean as `sum(judgeTotals) / (judgeCount * sum(weights))`. Compare means by bigint cross multiplication, without rounding before ranking. Display hundredths by floor division; ties use earliest submission block then lowest submission key. Projects with zero counted judges are unranked, never assigned zero.
- **B4.3-R3** After freeze, flag score spread when `(max(judgeTotals)-min(judgeTotals))*100 > 30*sum(weights)*scaleHundredths`, using the one common scale in that track's rubric. Zero/one counted judge never triggers a spread flag.
- **B4.3-R4** Before freeze, show assignment/completion counts and revoked/invalid-judge status only, never numeric score totals or rankings. Freeze excludes revoked judges under its cutoff policy. After freeze, show the committed rankings unchanged by later revocations.
- **B4.3-R5** THE organizer leaderboard SHALL show rankings per track only after the published bundle is available and checked; score-spread flags are also post-freeze. There is no privileged browser decryption preview. Prize selection remains a separately disclosed manual input.

**Commit:** `feat(rules): B4.3 raw weighted mean aggregation and leaderboard`

---

### B4.4 · Freeze pipeline

**Requirements**
- **B4.4-R1** Freeze SHALL: finish/reconcile capture; freeze config/prizes and confirmed cutoff identities; require both cutoff timestamps in `[results, freezeDeadline)` before decryption, key disclosure or publication; reject known evidence gaps, missing required dependencies or conflicting state; prepare historical ENS and reject ineligible score rows; validate the operator key/cipher; decrypt eligible rows with deterministic per-record rejection of invalid ciphertext/values; evaluate/select valid finals; validate all prize recipients; retain/sign the canonical bundle and verify two local copies plus downloadable URI; persist the exact publication job; write one compact readonly `results` summary; set the event commitment; declare one name per winning team; then atomically lock publication. The shared contract defines hash domains, bundle scope, output encoding and recovery. A head number never substitutes for retained input bytes. A malformed or forged candidate cannot create a required dependency or force decryption merely by copying valid-looking reference keys.
- **B4.4-R2** WHEN freeze is run a second time, THE CLI SHALL refuse.
- **B4.4-R3** Persist prepared intent and locally signed raw bytes/hash/nonce before broadcast; separate submitted, receipt-confirmed and verified state. `--resume <job>` loads the identical bundle/config/operation hashes, reconciles receipts and publisher state and adopts exact matches. Unknown outcomes or conflicting state stop; do not rebuild the plan or allocate replacement nonces from an empty read. Test crashes before broadcast, after success before journal update, and between confirmations/readback.
- **B4.4-R4** `lanyard verify mumbai2026 --bundle <path>` SHALL print the scoped `MATCH` verdict from B2 against the persisted mock now and locked Sepolia publication at I4. It must still work after live Arkiv input/result expiry using the committed bundle; historical ENS remains independently checked online.
- **B4.4-R5** All cross-track ENS publication SHALL use `ResultsPublisher`; Arkiv capture/results writes use B's own data package. Only the Node composition root may import A's concrete publisher, never feature/rules modules or the app.
- **B4.4-R6** THE CLI SHALL run on the operator's machine, reading the results key and the decryption key from its local `.env`. Nothing in the app (`app/`, `src/`) can trigger it.
- **B4.4-R7** WHEN a team in `fixtures/prizes.json` has no counted submission, THE CLI SHALL refuse before writing anything.
- **B4.4-R8** THE compact results body SHALL include rankings, rule/config/output/bundle hashes, bundle URI/signature and cutoff identity. Compute `resultsHash` over that body before adding the summary's Arkiv key; no self-referential hash. Publish bundle hash, summary hash and key to ENS. Reject an oversized encoded summary before the first publication. The full bundle includes manual prizes and public decryption material and excludes the later results summary itself.
- **B4.4-R9** Early or out-of-window freeze SHALL refuse before revealing the decryption key or making any publication write. `--resume` may finish a saved in-window job after `freezeDeadline` using its unchanged cutoff; it must not recapture under a new context. Verifiers enforce the saved window independently. Fixtures SHALL cover exact `results`/`freezeDeadline` boundaries and a valid post-event-end cutoff with partner ancestors still live.

**Tasks**
- [ ] Freeze pipeline with a persisted step log for resume
- [ ] E2E: freeze, then verify prints `MATCH` on mocks
- [ ] Seed 2 partners plus the `main` track, 3 projects (the three demo teams), 6 partner judges and 3 global judges, one revocation, one recusal, and a placeholder `fixtures/prizes.json`
- [ ] Local capture runner, canonical signed bundle export/download check and scoped reproduction tests on a second machine
- [ ] Device-local draft persistence and recovery on native/web; account/context isolation, storage-loss messaging and separate remote-sync status

**Commit:** `feat(cli): B4.4 resumable freeze pipeline`

---

## Phase bug hunt

- [ ] A submission one block after the deadline: excluded
- [ ] A second submission from the same team: only the first counts, the second shows as a duplicate
- [ ] The organizer patches a project: fails
- [ ] A team member who isn't the lead submits: rejected
- [ ] A judge from partner A scores partner B's project: rejected
- [ ] A global judge scores a partner-track project, or a partner judge scores a `main` project: rejected
- [ ] The head judge assigns a judge to a partner track, or a partner writes a `main` rubric: rejected
- [ ] A judge targets another judge in a recusal: rejected; self-recusal and organizer-authored recusal of an assigned judge count
- [ ] A judge revoked before cutoff: all their captured scores are excluded; reissue does not restore that registration's scores; post-cutoff revocation leaves published rankings unchanged
- [ ] Two finals from one judge for one project: only the earliest counts
- [ ] Two projects with identical scores: the same tie-break on every machine
- [ ] Read a `final_score` from Rabdi before freeze: ciphertext only
- [ ] Restart native app/reload browser: local scores restore; wallet/context switch does not leak another draft; a fresh device requires re-entry without zeros or remote decryption
- [ ] Forged final with random ciphertext is rejected before decryption; invalid eligible ciphertext/ranges get per-record reasons and a later valid final can count
- [ ] Wrong operator key, missing required evidence or corrupt retained bytes still stop freeze; a bundle's claimed plaintext cannot bypass independent decryption
- [ ] Search the APK and the web export for the decryption key: absent
- [ ] Freeze twice: the second refuses
- [ ] Kill freeze after the results record is written: resume completes without a second record
- [ ] `prizes.json` names a team with no submission: freeze refuses before any write
- [ ] `lanyard verify` on a second laptop: `MATCH`
- [ ] Change one score byte in a copy of the inputs: verify prints the differing item
- [ ] Draft changes after submission cannot change frozen contents/track; exact submission/judging deadlines reject late records
- [ ] Delete a captured first final/submission: retained candidate still wins; delete before observation: disclose unproven completeness, never claim detection
- [ ] Pre-freeze organizer screens reveal no numeric ranking; post-freeze rational means and spread flags are deterministic
- [ ] New publisher/CLI instance reconciles a successful-but-unlogged transaction without another publication
- [ ] Missing capture dependency, hash/signature mismatch, unknown rules version, oversized summary or inaccessible/unverified bundle URI blocks publication
- [ ] Freeze before `results` or at/after `freezeDeadline` refuses before key export/upload/writes; verification rejects the same signed bad contexts
- [ ] A saved in-window job resumes and verifies after the deadline without changing cutoff; post-event-end partner judges still count before their own expiry

## Phase done when

- [ ] B4.1–B4.4 marked done in `TRACKER.md`
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] Merged into `main`
