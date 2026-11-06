# I2 · Real ENS history

**Joint integration** · **Branch:** `int/I2-real-ens-history` · **Starts when:** A2 and B2 are both merged · **Driver:** B

This doesn't block A3 or B3.

**Run scope · 2026-11-07:** the user requested A2/B2 synchronization and explicitly waived the bug hunt and cross bug hunt for this run. The automated `pnpm e2e:i2` scenario uses a local fork of the deployed Sepolia contracts and captured FakeArkiv records; it compares app/CLI bundle bytes and Node/Chromium hashes. Live transaction history, two physical laptops and Android/Hermes remain separate acceptance legs, tracked in `TRACKER.md`; fork evidence must never be presented as live Sepolia/Rabdi evidence. See `e2e/README.md` for execution and artifacts.

## Goal

The B2 core and preparation run on real historical ownership, address, expiry and note reads through A2.4 on Node/Android, matching the mock. This checkpoint does not need B3 shift rules or screens. Compare exact retained bundle bytes and context under the shared evidence contract.

## What gets swapped

| Before | After |
| --- | --- |
| `EXPO_PUBLIC_LANYARD_ENS=mock`, `LANYARD_ENS=mock` | Both `sepolia` (the default in `.env.example`) |
| `fixtures/ens-history.json` scripted | Plus `fixtures/sepolia-history.json`, recorded by the A2.3 scripts |

## Scenario played live on Sepolia + Rabdi

1. Priya owns `priya.volunteers`; explicitly set a different forward address in a test fixture. Historical `owner` still authorizes Priya; `address` remains display data.
2. Coordinator grants then removes `shift-manager` using the registration/holder-bound `lanyard.perms` envelope. B2 `prepare` snapshots show the historical note and binding, without evaluating a B3 shift kind.
3. Unregister `ravi.volunteers`; the historical owner becomes null and `unregisteredBetween` reports the exact interval. Re-registering the label never rewrites its earlier owner/history.
4. Revive an expired, never-unregistered registration by root renewal; verify exact expiry behavior and ownership through the reader.
5. Organizer writes `seat_assignment`, then a volunteer writes a forged one. B2's shipped authority rule counts the former and rejects the latter with a reason.
6. Retain those readonly rows, freeze an explicit test context/config, and export one identical input bundle for the two laptops and Android app. B3/I4 later test actual lead-note authorization of shifts.
7. Reissue a lead label while leaving its old resolver text intact. The new `registrationId` differs and the old note is ineffective; a fresh coordinator grant binds to the new ID/holder. Renewal and ordinary role changes leave the same registration ID intact. Preserve snapshots before and after each operation.

## Steps (one commit each)

1. `chore(fixtures): I2 add recorded sepolia history from A2 scripts`
2. `feat(app): I2 default ENS flag to sepolia`
   Wire both app providers and the Node `cli/providers.ts` composition root to A2's reader/directory; the CLI's `LANYARD_ENS` flag must select the real reader too.
3. `test(e2e): I2 historical owner and lead-note snapshot reads`
4. `test(e2e): I2 revoke and revive scenario on sepolia and rabdi`
5. `test(e2e): I2 rules output hash matches across two machines and the app`

## Smoke test

`pnpm e2e:i2` plays the scenario, checks prepared ownership/address/note/expiry snapshots and B2's authority verdicts, then runs `lanyard hash mumbai2026 --bundle <path>` on the exact exported bundle on both laptops and Android. Every output hash matches; no historical Rabdi query or B3 rule is assumed.

## Cross bug hunt

**A attacks B's code:**
- [ ] Equal-timestamp and between-block mappings select the latest Sepolia block with timestamp ≤ the source timestamp, consistently
- [ ] Re-register a revoked label to a new owner: old records stay tied to the old owner
- [ ] Throttle the archive RPC: the rules and the CLI fail loudly, never silently counting or rejecting
- [ ] The app on a slow mobile network: shows "checking…" rather than a wrong verdict

**B attacks A's code:**
- [ ] `SepoliaEnsReader` vs direct viem reads for 20 random (label, block) pairs: identical
- [ ] `sepoliaBlockAt` at exact block timestamps and between blocks
- [ ] Cache keys include query, chain/reset and block hash; a newer note value or changed canonical hash cannot reuse stale historical data
- [ ] Registration-bound notes survive renewal, not reissue; a same-wallet reissue also needs a fresh note and historical prior grants still reproduce

**Re-run the riskiest items from the A2 and B2 phase bug hunts.**

Findings go in `TRACKER.md › I2`.

## Done when

- [ ] `pnpm e2e:i2` is green; the hashes from two machines and the app match
- [ ] Highs fixed (on the owner's `fix/` branch); Mediums fixed or in Known limitations
- [ ] I2 marked done in `TRACKER.md`; merged into `main`
