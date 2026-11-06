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
- B4’s real Sepolia prepared-publication adapter is an I4 gate and must pass both publisher conformance suites; B4 exercises persisted mocks.
- Physical Android tests and the remaining phase bug hunt were skipped at the user’s request. Browser flows and a separate Node verifier process were exercised; live host CORS, Sepolia publication and a second physical laptop were not tested in B4.
