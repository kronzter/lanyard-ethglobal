# Integration smoke tests

Integration scenarios (`pnpm e2e:i1` … `e2e:i4`) are maintained on integration branches.

## I1 · A1/B1 integration (live)

Seed once, then run the smoke:

1. `pnpm e2e:i1:seed` gives the live cast (team `zkpay`, Person A–D with `hackers` badges and A owning `zkpay`, plus volunteers `priya` and `ravi`) fresh wallets. A missing persona key is generated into the git-ignored `.env` under its `LANYARD_KEY_*` name and never printed. Names are issued on live Sepolia through A1's own `issue-badge.ts` / `register-team.ts` with `ORGANIZER_PRIVATE_KEY` (the deployed organizer in `src/shared/live-event.config.ts`). Each persona and the organizer then get first-time tGLM through B1's `lanyard drip` (desk-wallet profile). Every step re-plans from chain state, so a rerun sends nothing new. Public addresses and transactions go to `fixtures/sepolia-personas.json`.
2. `pnpm e2e:i1` needs `SEPOLIA_RPC_URL` (archive) and the seeded keys in `.env`.
   - **Step 3** traverses the A1 registries directly (`lanyard` → `mumbai2026` → book/team → holder) at each name's issuance block and at head. Owner, status, expiry and every ancestor must hold, the name must not hold one block earlier, and A2's reader (CLI composition root) must agree.
   - **Step 4** writes a venue (organizer), a shift (Priya), a clock-in (Ravi), a ticket (`zkpay-b`) and a project draft (`zkpay-a`) to live Rabdi. Each record's native creator, owner, flags and attributes are read back. Its creation timestamp maps to the latest Sepolia block at or before it, where the `by_label` registry owner must equal the creator; the venue checks the frozen organizer authority instead. Ravi's batch also carries a duty pass labelled `priya.volunteers`, and the check must flag it.

Each step-4 run writes new records into the live `mumbai2026` event (cents of tGLM). No submission is written, so I1 never becomes `zkpay`'s earliest submission. Global judges are not seeded because only the head judge's wallet issues them.

Artifacts under `.lanyard/i1/` (git-ignored): `ownership.json`, `records.json` (each record's timestamp → Sepolia block → owner check), and `observations.jsonl` (retained readonly observations in capture format, for the later bundle). This is not historical Arkiv fetching, and it evaluates no B2/B3/B4 verdicts. The Android/AppKit write (plan step 5) and the cross bug hunt were skipped at the user's request on 2026-11-07.

## I2 · A2/B2 integration

Run `pnpm e2e:i2`. It requires `anvil` on PATH and a headless Chromium binary (`BROWSER` overrides `chromium`). `SEPOLIA_RPC_URL` selects an archive RPC; without it the test uses the public Sepolia PublicNode endpoint. It checks the upstream chain ID and genesis hash, then forks its finalized block on a temporary local port. No signing key is needed. All test transactions target that local fork.

The scenario checks registry ownership independently of forward addresses, coordinator-scoped permission grants/removal, historical unregister intervals, reissue to another wallet, exact expiry and root revival, stable registration identity through role changes/renewal, and stale notes after a same-wallet reissue. The app and CLI composition roots use the same independently configured organizer/head-judge addresses, checked against the deployed registrar.

Two readonly seat assignments go through the Arkiv writer and capture implementations using `FakeArkiv`: the organizer's row counts and the volunteer's forgery stays visible with a rejection reason. Both composition roots prepare identical ENS entries and canonical bundle bytes. A separate CLI process and Chromium reproduce the bundle's output hash. This scenario uses B2's authority rules and does not depend on B3 shift evaluation.

Artifacts are written under `.lanyard/i2/` (git-ignored):

- `bundle.json`: the exact development evidence body to copy to another machine.
- `sepolia-history-fork.json`: fork operations and historical permission snapshots, explicitly marked as fork evidence.
- `reproduce.html`: a self-contained browser reproduction of that bundle.

On the other machine, run `pnpm lanyard hash mumbai2026 --bundle <copied-bundle.json>` from the same rules version, or open the copied `reproduce.html` in a browser. The hash must match. The development body is unsigned and outside the event's freeze window; it does not publish results or disclose the event score key.

This automated test establishes A2/B2 code integration on the deployed Sepolia contracts. It does not substitute for recorded live Sepolia/Rabdi transactions, a second physical laptop, or the Android/Hermes check. Those acceptance legs remain pending in `plans/TRACKER.md`. Fork records are never written to the live `fixtures/sepolia-history.json` consumed by A2's operator scripts.

ENS now defaults to `sepolia` in both composition roots and `.env.example`. Existing explicit `mock` settings still select fixtures. For the app set `EXPO_PUBLIC_LANYARD_ENS=sepolia` and supply `EXPO_PUBLIC_SEPOLIA_RPC_URL`; for Node export `LANYARD_ENS=sepolia` and `SEPOLIA_RPC_URL`. The CLI consumes the process environment; it does not load secret files. Live organizer/head-judge config lives in `src/shared/live-event.config.ts`; fixture config and vectors retain their original wallets. Results and partner authority placeholders still need their own deployment configuration before live judging/publication.

The user waived the I2 bug hunt and cross bug hunt on 2026-11-07. No independent bug hunt is part of this run.
