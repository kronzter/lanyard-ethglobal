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

## Deferred

`ens-history.json` lands before B2, `venue.small.json` before B3, and the
evidence edge-case scenarios before B4 (`plans/P0-foundation.md` › Track B slice).
