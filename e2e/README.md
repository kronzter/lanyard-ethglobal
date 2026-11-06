# Integration smoke tests

Integration scenarios (`pnpm e2e:i1` … `e2e:i4`) are maintained on integration branches.

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
