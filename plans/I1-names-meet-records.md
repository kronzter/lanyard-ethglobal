# I1 · Names meet records

**Joint integration** · **Branch:** `int/I1-names-meet-records` · **Starts when:** A1 and B1 are both merged · **Driver:** A

This doesn't block A2 or B2. Both people start their next phase as soon as their own phase merges; this is a short sync.

## Goal

The A1-created names and B1 records agree on registry ownership. This checkpoint deliberately uses no resolvers, partner sub-books, permission notes or B3/B4 feature verdicts: those are not dependencies yet. Authority-only kinds match configured authority wallets and do not require invented ENS badges.

## What gets swapped

| Before | After |
| --- | --- |
| Placeholder persona addresses for A1 names | Seeded owner wallets for hackers, volunteers, global judges and teams already created in A1 |
| Fixture-backed Rabdi writes | Writes by those wallets funded through P0's chosen faucet or direct-transfer profile |
| Flags | Unchanged (the ENS flag stays `mock` until I2) |

## Steps (one commit each)

1. `chore(fixtures): I1 fill personas with seeded sepolia addresses`
2. `chore(fixtures): I1 fund available persona wallets using the chosen profile` (record transaction list)
3. `test(e2e): I1 badge/team creators match direct historical registry ownership` (traverse A1 deployments and read owner/status/ancestor expiry directly; no `getEnsAddress` dependency)
4. `test(e2e): I1 write representative B1 kinds using only A1 identities` (e.g. volunteer clock, hacker ticket, team project/submission and organizer venue; full partner/kind coverage belongs after A2/B4)
5. One record written from the Android app with a persona imported into MetaMask, through AppKit: checked by the same e2e test

## Smoke test

`pnpm e2e:i1` writes the representative records and checks native creator/flags plus the direct registry owner at the retained creation timestamp's Sepolia block. For organizer venue records, check frozen organizer authority instead. Record timestamp/observation evidence for the later bundle; this is not historical Arkiv fetching.

## Cross bug hunt

**A attacks B's code:**
- [ ] Write a record with `by` set to a badge you don't own: B1 doesn't stop it (correct, that's B2's job), and the e2e check flags it
- [ ] Use a persona wallet with zero tGLM: a clear error, no stuck queue
- [ ] Contract profile: duplicate drip reverts. Direct-transfer profile: desk uses a persisted funding ledger and reconciles uncertain transfers before another send; do not claim on-chain once-per-wallet enforcement
- [ ] Search the web export and the APK for any private key

**B attacks A's code:**
- [ ] Issue a badge from the onboarding script with a label that differs only in case: rejected
- [ ] Every A1-scope badge/team persona matches its registry owner; future partner personas and descriptive authority labels are explicitly outside this assertion
- [ ] `deployments/sepolia.json` loads through the P0.2 schema in B's code

**Re-run the riskiest items from the A1 and B1 phase bug hunts.**

Findings go in `TRACKER.md › I1`. Highs in track code are fixed by the track owner on `fix/<slug>` off `main`.

## Done when

- [ ] `pnpm e2e:i1` is green
- [ ] Highs fixed; Mediums fixed or in Known limitations
- [ ] I1 marked done in `TRACKER.md`; merged into `main`
