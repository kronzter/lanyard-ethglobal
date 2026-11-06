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

## Known limitations

Recorded here as phases find them (see `plans/00-README.md` › Evidence and product guarantees).
