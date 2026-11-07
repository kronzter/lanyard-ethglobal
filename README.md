# Lanyard

Event OS for hackathons, built for the `mumbai2026` edition. **ENSv2 on Sepolia** gives every
role an expiring name; **Arkiv on Rabdi** holds everything people do. One Expo dApp for
Android and web, with actor-signed writes and local operator CLIs.

The plans live in [`plans/`](plans/00-README.md). Start with
[`00-CONTEXT.md`](plans/00-CONTEXT.md) and the authoritative
[evidence and shared contracts](plans/01-evidence-and-interfaces.md). Progress lives in
[`plans/TRACKER.md`](plans/TRACKER.md).

## Layout

One repo, one `package.json`, no workspace packages and no git submodules.

| Path                                             | What                                                         | Owner                                |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------ |
| `app/`                                           | Expo Router screens                                          | per route (see `.github/CODEOWNERS`) |
| `src/shared/`                                    | Config, labels, canonical encoding, types, interfaces, mocks | both                                 |
| `src/arkiv/`, `src/rules/`                       | Arkiv records and the pure rules engine                      | Track B                              |
| `src/ens/`, `src/venue/`                         | ENS reader and venue routing                                 | Track A                              |
| `src/shell/`, `src/flags.ts`, `src/providers.ts` | App shell and the composition root                           | both                                 |
| `cli/`                                           | Node-only operator CLI (`pnpm lanyard`)                      | Track B                              |
| `contracts/`                                     | One Foundry project (Soldeer deps)                           | per folder                           |
| `fixtures/`, `deployments/`, `e2e/`              | Demo data, addresses, integration smoke tests                | see CODEOWNERS                       |

Folders are the track boundaries. `pnpm lint` enforces them (`lanyard/boundaries` in
`eslint.config.mjs`): the tracks never import each other outside `src/providers.ts` and
`cli/providers.ts`, `src/shared` and `src/rules` stay runtime-pure (Hermes, browser, Node), and
app code never imports `cli/`.

## Setup

Prerequisites: Node 24 (`nvm use`), pnpm 10.30.1, and Foundry 1.7.1 for contracts.

```bash
pnpm install          # also installs the pre-commit hook
pnpm forge:install    # Soldeer dependencies into contracts/dependencies/
pnpm ci:local         # everything CI runs
```

Copy `.env.example` to `.env` only when you run scripts that need keys. `.env` is never committed.

| Script                               | Does                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm web`                           | Expo dev server for web                                                  |
| `pnpm lint` / `pnpm format`          | ESLint (with import boundaries) and Prettier                             |
| `pnpm typecheck`                     | `tsc --noEmit`                                                           |
| `pnpm test`                          | Vitest                                                                   |
| `pnpm forge:fmt` / `pnpm forge:test` | Foundry format check and tests                                           |
| `pnpm web:export`                    | `expo export --platform web` into `dist/`                                |
| `pnpm secret-scan:all`               | Scan every tracked file for keys and mnemonics                           |
| `pnpm lanyard <cmd>`                 | Operator CLI (`verify`, `hash`, `capture`, `freeze`)                     |
| `pnpm ci:local`                      | Secret scan, lint, typecheck, tests, Foundry and web export, in CI order |

Android APKs are built on EAS cloud (`pnpm app:dev-apk`, `pnpm app:apk`). A builder with a
Linux/macOS/WSL host may add `--local` (`pnpm app:apk:local`). Builds get only public `EXPO_PUBLIC_*`
values; never store a signing, operator or decryption key as an EAS secret.

## Judging and freeze

Team leads edit `/team`; public `/teams/<team>` pages use validated immutable submissions. The web judging desk at `/organizer/judging` accepts snapshots and assigns judges under each track’s earliest valid rubric. Judges use `/judge`; editable scores recover only on the same installation/browser profile. AsyncStorage/IndexedDB saves are separate from encrypted Arkiv mirror sync. Clearing storage or using another device requires re-entry, and local storage is readable to someone with access to that device’s app data.

Start the local capture runner **before creating rubrics/submissions**, keep it running through preparation, and reconcile watcher failures/restarts before freeze:

```sh
pnpm lanyard capture --every 15
pnpm lanyard freeze mumbai2026 --prizes fixtures/prizes.json --bundle-uri https://your-host.example/mumbai2026/bundle.json
```

The local operator environment supplies `RESULTS_PRIVATE_KEY` (or `LANYARD_KEY_RESULTS`), `SCORE_DECRYPTION_KEY`, and read RPC values. No private material belongs in `EXPO_PUBLIC_*`, EAS or app storage. Both confirmed cutoffs must be in `[results, freezeDeadline)` before the score key can be disclosed. The default CLI publisher is persisted mock state until I4; mock transaction envelopes are not a live Sepolia signing test.

Preparation saves `.lanyard/freeze/mumbai2026/job.json`, the signed bundle beside it, and a second copy under `.lanyard/evidence-backup/mumbai2026/`. The command stops until the operator uploads that exact public bundle to the chosen HTTPS URI. Hosting publication is a separate operator action. Then resume the saved job:

```sh
pnpm lanyard freeze --resume .lanyard/freeze/mumbai2026/job.json
pnpm lanyard verify mumbai2026 --bundle .lanyard/freeze/mumbai2026/bundle.json
```

Resume checks both copies, the downloaded artifact, saved cutoffs, signer/config, historical ENS and exact operation hashes. It reconciles persisted signed bytes/hash/nonce and confirmed state; pending, unknown or conflicting outcomes stop without a replacement nonce. A saved in-window job can finish after the deadline. A stale `operator.lock` requires checking the process and journal before removing that lock; never remove/rebuild an uncertain publication job.

`fixtures/prizes.json` is a disclosed demo placeholder. Prize selection remains manual, separate from track rankings. Rankings use exact rational weighted means and become visible only from checked publication evidence; later badge changes do not rewrite them. Captured readonly records remain usable after deletion/expiry, but `MATCH` does not prove historical capture completeness or rule out unseen earlier deleted candidates. Verification still requires online historical ENS reads; the bundle host is optional when a local bundle is supplied.

## Evidence scope: what `MATCH` proves

Rabdi exposes current state, not historical snapshots, and readonly Arkiv entities can still be
deleted, transferred or expire. Lanyard therefore uses **operator-attested capture**: the local
capture runner retains each readonly record it observes (raw values, creator, owner, flags,
creation/expiry blocks, observation block) and the results operator signs the bundle built from
those observations.

`pnpm lanyard verify mumbai2026 --bundle <path>` prints
`MATCH — operator-attested captured inputs; completeness not proven` when the bundle is intact, is
signed by the configured results wallet, and its captured inputs reproduce the published
computation using independently checked historical Sepolia ENS reads. It does **not** prove:

- that the operator captured every Rabdi record, or that no earlier candidate was deleted before
  it was captured (a captured record that is later deleted stays in the bundle; one deleted before
  capture cannot be detected and is never advertised as impossible);
- that publisher-attested Arkiv metadata is an independent inclusion proof;
- anything about records first observed after the pinned cutoff, or mutable drafts (both excluded).

"Earliest" submission/score means earliest valid candidate **in the captured set**. Verification
works offline from a local bundle except for historical ENS reads, which need an archive RPC; the
`bundleUri` host is a retrieval hint, never a trust root. A local-only reproduction without the
online ENS check is labelled separately and is not a `MATCH`.

## Issuer and ancestor-name trust

Badge and team actions count only when historical ENS registry ownership (not resolved addresses)
matched the record creator, with valid ancestor expiry, at creation. That authority is only as
trustworthy as the names above it:

- **Ancestors.** `eth` (ENS's own owner) and `lanyard.eth` (the organizer) can still redirect their
  subtrees and must be renewed; sealed edition/team permissions and the winner lock do not remove
  those controls. Details and addresses are under Known limitations.
- **Issuers.** App-issued badges omit transfer-admin, but the organizer keeps raw
  register/unregister/renew/resolver roles on managed books and can bypass the app's badge policy,
  including by issuing transferable tokens. Nontransferability against an issuer is not guaranteed.
  Head-judge and partner delegates issue only through policy-enforcing registrar entrypoints.
- **Lifetimes.** Judge badges expire at `freezeDeadline`; structural names and their ancestors must
  cover `namespaceExpiry = max(eventEnd, freezeDeadline) + 30 days`; staff badges end with the
  event. A child name stops resolving if its parent expires, so a winner name depends on its team
  name, the edition and `lanyard.eth` staying renewed.
- **Authority wallets** (organizer, results, head judge, partners, desk) come from frozen config,
  committed by `configHash`; bundles never supply their own trusted signer.

## Service and host profile

There is **no server signer**. Every actor write is signed by that actor's wallet (Reown AppKit);
deploy, seed, capture and freeze run as local CLIs on the operator's machine.

| Service                    | Used for                                 | Credential shipped in the app                                                            |
| -------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Sepolia RPC                | ENS reads (archive), wallet chain config | `EXPO_PUBLIC_SEPOLIA_RPC_URL` (public, read-only, app-restricted key if any)             |
| Rabdi RPC                  | Arkiv reads; wallet chain config         | `EXPO_PUBLIC_RABDI_RPC_URL`, optional `EXPO_PUBLIC_RABDI_ACCESS_KEY` (public, read-only) |
| Reown relay                | Wallet connection/login                  | `EXPO_PUBLIC_REOWN_PROJECT_ID` (public project ID)                                       |
| Static host (Vercel)       | Web consoles and public team pages       | none (`https://lanyard-eth.vercel.app`, from `deployments/sepolia.json`)                 |
| Evidence bundle HTTPS host | Downloadable signed bundle (`bundleUri`) | none; operator uploads the exact bundle. TODO: name the host used for the live freeze    |

- P0.6-S8 measured keyless Rabdi reads with no throttling at demo rates, so **no read-only proxy**
  is deployed. If one is ever added it holds no signing or decryption key.
- Every `EXPO_PUBLIC_*` value is treated as public and rotated if abused. No organizer, results,
  desk or score-decryption key ever appears in an app bundle, an EAS secret, app storage or a
  wallet chain URL; those live only in the operator's local `.env`.
- The `SepoliaResultsPublisher` and its file journal are Node-only and imported by no `app/` or
  `src/` module (`src/ens/sepolia-results-publisher.boundary.test.ts`).
- TODO (I4 bug hunt): scan the built APK and `dist/` web export for organizer, results and
  decryption keys and record the result here.

## Demo script

Preconditions (I4): app ENS = `sepolia`, router = `grid`, CLI ENS and results = `sepolia`, live
deployment validation passes, and ancestor/judge-badge expiries cover the freeze window. I4 cannot
sign off with any mock or stub provider.

> TODO before the live run: deploy the live `WinnerRegistrar` (not deployed yet; no address in
> `deployments/sepolia.json`), replace the placeholder authority wallets in
> `src/shared/event.config.ts` (`authorities.results` is still a public test-mnemonic address), and
> switch the CLI default to `LANYARD_RESULTS=sepolia` (I4 step 3). Record addresses and results here.

1. Start the local capture runner (`pnpm lanyard capture --every 15`). At the desk, issue badges and
   fund wallets with the desk-wallet profile. Team `zkpay` is registered to its lead and
   `winner.zkpay…` is reserved. Field wallets discover and select their own roles.
2. The coordinator makes Priya a lead. Priya clocks Ravi in from her phone (one approval); his
   duty-pass countdown shows.
3. Person B raises a ticket from their seat; Ravi claims it, walks the path, resolves it and gets
   the next ticket.
4. The coordinator removes Priya's lead note; her next clock-in shows greyed out, with a reason.
5. The lead submits immutable content before the deadline; a late submission is excluded. Editing
   the draft afterwards cannot change the submitted contents or track.
6. An assigned partner judge walks located stops, scores and seals. One judge is revoked before
   cutoff: completion/eligibility updates without exposing scores or rankings.
7. After an allowed confirmed cutoff in `[results, freezeDeadline)` on both chains, run
   `pnpm lanyard freeze`: reconcile capture, freeze config/prizes, reject ineligible scores before
   decrypting, retain/sign/download-check the bundle, then publish compact results → event
   commitment → winners → atomic lock. The leaderboard excludes the revoked registration's scores.
8. `winner.zkpay.mumbai2026.lanyard.eth` resolves with its prizes and the team screen shows the
   winner badge; `setText` on it reverts for everyone.
9. On a second laptop, `pnpm lanyard verify mumbai2026 --bundle <path>` prints
   `MATCH — operator-attested captured inputs; completeness not proven`.

TODO: record the live run (edition, block numbers, transaction hashes, bundle hash) once it passes.

## Known limitations

Recorded here as phases find them (see `plans/00-README.md` › Evidence and product guarantees).

- ENS ancestor authority remains a trust boundary. At Sepolia block **12077035**, both the Root
  and ETH registries report emancipated roots, but the `eth` name inside RootRegistry is owned by
  `0x84D3a426D4E12E955d1DF95db0B24fe26afE39D3`, its sole subregistry/resolver setter and corresponding
  admin. That account can redirect the `.eth` subtree. The `lanyard.eth` owner
  `0x36b7C556c584d65bd44Ae57656B64b68Bb88E2cF` likewise holds its name's subregistry/resolver controls
  and admins, plus transfer-admin. The base registry intentionally leaves organizer register/renew
  authority. Sealed edition/team permissions and winner publication locks do not remove these
  ancestor controls or the need to renew names. **Accepted for the demo:** the head organizer
  (`0x36b7…E2cF`) holds these roles on `lanyard.eth` and its base registry, so trust in the
  namespace ends at the organizer's key and at ENS's own `eth` owner above it.
- The organizer retains raw register/unregister/renew/resolver roles on managed badge books and
  partner sub-books. That trusted path can bypass the application's fixed badge policy, including
  by issuing transferable tokens. Head-judge and partner delegates have no raw registration role;
  their registrar entrypoints enforce policy. Raw organizer issuance must explicitly initialize
  its fixed resolver's address record too.
- The immutable registrar must be deployed with its A1/A2 contract boundary already present.
  Version `lanyard.registrar/2` requires fixed resolver and head-judge configuration before
  bootstrap. The A2 historical reader, permission-note and team-URL workflows remain separate
  implementation work; local/fork verification does not constitute live phase acceptance.
- A1 shipped without the planned independent bug hunt (organizer's decision, 2026-11-07). Its
  coverage is the 129 Foundry tests, fork modes A and B against the live Sepolia edition, and the
  earlier reviewer findings A1-D1–D9.
- `SepoliaResultsPublisher` passes both publisher conformance suites (ordinary and prepared, the
  latter over the durable file journal) on an anvil Sepolia fork only. It is not yet wired into
  `cli/providers.ts`, and no live Sepolia publication has run.
- The publisher's file journal cannot fsync its directory on Windows (Node returns EPERM); there
  the atomic rename relies on NTFS metadata journaling. Run live freezes on Linux/macOS/WSL.
- Physical Android tests and the remaining phase bug hunt were skipped at the user’s request. Browser flows and a separate Node verifier process were exercised; live host CORS, Sepolia publication and a second physical laptop were not tested in B4.
