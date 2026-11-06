# fixtures

Shared, strict-JSON demo fixtures (JSON has no comments, so each file's story is told here).
Baseline files are shared (P0); phases may add their own fixtures additively (A: ENS history,
Mumbai venue; B: flow, prize and capture fixtures). Coordinate changes to existing shared files.
Tests live in `fixtures/test/`.

## `personas.json` (P0.4)

Every demo actor. Addresses are derived from the **public** `test test … junk` mnemonic at
`hdIndex`, so they work on a local anvil and are obviously test-only; `keyEnv` names the env var
that holds a persona's key for local seed/e2e scripts (listed, empty, in `.env.example`). No key
appears in any fixture.

| Who                                                                    | Count                     | `by` label                                                          |
| ---------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| Organizer, results key, desk wallet, volunteer coordinator, head judge | 1 each                    | descriptive (`organizer`, `results`, …); authorities hold no badge  |
| Partners `arkiv`, `ens`                                                | 2                         | `<partner>.partners`                                                |
| Partner booth staff                                                    | 2 per partner             | `<name>.staff.<partner>.partners`                                   |
| Volunteer leads (Priya, Rahul, Meera, Kabir)                           | 4                         | `<name>.volunteers`                                                 |
| Volunteers (Ravi, Anita, …)                                            | 10                        | `<name>.volunteers`, alternating `west`/`east` zones                |
| Partner judges                                                         | 3 per partner             | `<name>.judges.<partner>.partners`                                  |
| Global judges (`main` track only)                                      | 3                         | `<name>.judges`                                                     |
| Teams `zkpay`, `chainchat`, `seatsense`                                | 4 people each, Person A–D | `<team>-<a…d>.hackers`; Person A is the lead and also owns `<team>` |

The organizer, results and partner addresses are the authority wallets in
`src/shared/event.config.ts` (HD indices 0, 1, 5, 6). Any fixture's `by` labels can be checked
with `assertByLabelsKnown` from `src/shared/fixtures/personas.ts`.

## `team-pages.json` (P0.2)

The four public team-page states: `populated` (zkpay, published), `awaitingSubmission`
(chainchat registered, no submission yet), `unknownTeam` (not registered) and `unavailable`
(evidence could not be read). Errors must never look like an empty team.

## `timeline.json`

A mock Sepolia chain: block `9000000` is genesis, three days before the event starts, with one
block every 12 s. Every key time in `src/shared/event.config.ts` (`eventStart` … `freezeDeadline`)
is listed with the latest block at or before it. `head` sits 75 days after the freeze deadline,
past the edition's expiry, so readers can be asked about late blocks. A timestamp between two
blocks maps to the earlier one.

## `ens-history.json`

Registry and resolver events on the mock chain, replayed block by block by `MockEnsReader`.
Each event may carry a `note` explaining its purpose. `registries` maps each parent label to the
registry holding its children (`@base` holds the edition itself).

| When                                          | What happens                                                                                                                                                   | Why it is there                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Before the event                              | The organizer owns the edition and the four books; partners own `<p>.partners` and their `judges`/`staff` sub-books. All outlive `namespaceExpiry`             | Structural ancestors, including partner names, survive the event end and the freeze window |
| Event start                                   | Teams register to their Person A; every badge is issued with an address record. Volunteer and staff badges end at `eventEnd`, judge badges at `freezeDeadline` | Badges issued                                                                              |
| Event start                                   | Anita's address record points at Ravi                                                                                                                          | Owner/address disagreement: ownership, not the address, decides roles                      |
| Event start                                   | Leela's badge expires exactly at `submissionDeadline`                                                                                                          | A badge reaching expiry (invalid at exactly its expiry)                                    |
| +1 h                                          | Priya, Rahul, Meera and Kabir get registration-bound `lanyard.perms` notes                                                                                     | Priya made lead                                                                            |
| +4 h, +5 h                                    | Rahul's badge is renewed; Meera's roles change                                                                                                                 | The registration ID stays stable                                                           |
| +6 h → +8 h                                   | Omar's badge expires, then is renewed                                                                                                                          | An expired badge revived (same registration)                                               |
| +20 h                                         | Priya's note is removed                                                                                                                                        | Lead note removed at a known block                                                         |
| +30 h                                         | Kabir's badge is unregistered and reissued to him; the note is not rewritten                                                                                   | A stale registration-bound note grants nothing                                             |
| `submissionDeadline` + 1 h                    | `ben.judges.arkiv.partners` is unregistered                                                                                                                    | A judge unregistered mid-judging                                                           |
| `results` + 1 h                               | `gita.judges` is unregistered                                                                                                                                  | Revocation after a freeze cutoff at `results`                                              |
| Block 9,471,000 (`namespaceExpiry` + 30 days) | The edition lapses while team names are still unexpired                                                                                                        | Ancestor expiry: children stop resolving                                                   |

## `venue.small.json`

A hand-made 20×12 hall with 1 m cells, used until A3.1 exports the real Mumbai venue.

- Zones `west` (columns 0–9) and `east` (10–19), split by a wall in column 10 that is open from
  row 8 down.
- A row of tables walls off row 6 between columns 3 and 8.
- Twelve seats: `w1`–`w6` in the west, `e1`–`e5` plus `e6-walled` in the east.
- Points of interest: a `help-desk` in each zone (helpers start there when they clock in) and the
  main `stage`.
- `e6-walled` at (16, 9) is surrounded on all eight sides by walls. Grid routing must report it
  unreachable; the stub router, which ignores walls, still gives it a distance.

## `evidence-scenarios.json`

Edge cases for capture, rules and the freeze pipeline, on a mock Rabdi chain (2 s blocks). The
observations use the `CapturedObservation` format from `src/shared/evidence/observation.ts`.

| Scenario                    | What it proves                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deletedCapturedFinal`      | Ana's final score was captured and later deleted by its owner. The retained readonly bytes remain usable evidence                                                   |
| `deletedUncapturedFinal`    | Chen's final score key entered the inventory but vanished before its bytes were retained: a capture gap that stops automatic freeze, never a silently missing score |
| `expiredLeaseRetainedClaim` | Ravi's claim on Person B's ticket was made 20 minutes before evaluation; its physical expiry was extended, but the logical 15-minute lease has lapsed               |
| `publicationRestart`        | The freeze CLI broadcast the event results and crashed before journaling the receipt; a restarted CLI reconciles and adopts it without resending                    |
| `cutoffs`                   | Cutoffs at `results − 1` and `freezeDeadline` are rejected; `results` and `freezeDeadline − 1` are accepted                                                         |
