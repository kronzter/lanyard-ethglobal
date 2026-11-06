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

## Deferred

`venue.small.json` lands before B3 and the evidence edge-case scenarios before B4 (`plans/P0-foundation.md` › Track B slice).
