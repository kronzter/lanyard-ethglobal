# Lanyard · Build plan

Event OS for hackathons on **ENSv2 (Sepolia)** and **Arkiv (Rabdi)**, shipped as an **Expo dApp** for Android and web. Two builders, two tracks, phase- and spec-driven. **Person A = `@kronzter`**, **Person B = `@arnavmahajan630`**.

- **Person A · ENS & venue track.** Contracts, names, permissions, ENS reads, venue grid, routing, winner names, ENS consoles.
- **Person B · Arkiv & flows track.** Arkiv records, faucet, rules engine, verifier CLI, volunteer, ticket and judging flows.

Read `00-CONTEXT.md`, then the authoritative [evidence and shared contracts](01-evidence-and-interfaces.md), then `00-git-workflow.md` before a user-requested commit.

**Plans are a reviewed baseline.** Explicit user-authorized repairs may change them, with all affected interfaces, phases and acceptance checks updated together. Progress lives in **`plans/TRACKER.md`**. Plan corrections do not mark implementation done. Never commit unless asked. Agents may push non-`main` branches and open PRs; they never push `main` or force-push, and the user merges.

## The app

- **One repo, one dApp.** A single Expo project at the repo root: one `package.json`, one lockfile, no workspace packages and no git submodules. Domain code lives in plain folders (`src/shared`, `src/arkiv`, `src/rules`, `src/ens`, `src/venue`, `src/shell`), the Node CLI in `cli/` (run with `tsx`, importing `src/`), and one Foundry project in `contracts/` whose dependencies come from Soldeer. Track boundaries are ESLint import rules plus `CODEOWNERS`.
- **Expo + Expo Router**, TypeScript, at the repo root. Targets **Android and web**. The code stays iOS-compatible, but iOS is never built, tested or demoed.
- **Dev builds only.** Reown AppKit's native modules don't run in Expo Go.
- **Every APK build runs locally**: `eas build --platform android --profile <development|preview> --local`. Never queue a cloud EAS build.
- **Wallets: Reown AppKit.** The native SDK on Android, the wagmi adapter on web. Users connect their own wallet (MetaMask, Rainbow, …). If the P0.6 spike shows external wallets can't write to Arkiv, the fallback is AppKit's email/social-login wallet.
- **No server signer.** Users sign their own actions. Deploy, seed, capture and freeze are local CLIs. Retained signed evidence bundles are downloadable and usable from local files. Read-only, app-restricted RPC keys ship in the app as public values (rotated if abused). A declared read-only RPC proxy is only a fallback if P0 shows those limits can't be lived with; it may hold RPC credentials, but no signing/decryption keys. Final network acceptance uses the actual P0-selected profile, including wallet relay/login services.
- **Screen split.** Field roles (hacker, volunteer, lead, judge, team) use phones. Organizer screens, ENS consoles and the venue editor are web-only screens.

## Who pays gas

| Chain | Who sends transactions | How they get gas |
| --- | --- | --- |
| Sepolia | Organizer (badges, teams, revoke, revive), volunteer coordinator, head judge, partners, results key (freeze CLI) | Staff wallets are funded with Sepolia ETH by hand |
| Rabdi | Everyone who writes an Arkiv record | The desk calls the `Faucet` contract if P0.6-S6 proves it; otherwise a dedicated desk wallet sends tGLM and writes a readonly `drip` record, refusing repeats (B1.1) |

Field-role app flows only read ENS. Team leads' optional direct name-management capabilities exist on Sepolia, but are not required by those flows.

## Evidence and product guarantees

Rabdi offers current observations, not arbitrary historical snapshots. The MVP retains readonly inputs in an operator-attested bundle. `MATCH` verifies published bundle integrity and reproducible rules with independently checked ENS history; it does not prove that every Rabdi input was captured. Readonly does not prevent owner deletion/transfer. Earliest submission/final means earliest valid captured candidate. Submitted contents are immutable snapshots, logical leases are independent of physical retention, rankings appear only after freeze, and post-cutoff revocations do not rewrite published results. These limits must appear in the demo/README, not only developer notes.

Freeze cutoffs must be in `[results, freezeDeadline)` and namespace lifetimes cover that window. Permission notes bind a specific badge registration and holder. Invalid score candidates are rejected before selection without blocking unrelated valid results. Editable judge drafts recover on the same device/browser profile only. P0-S12 selects proven linked creates or a two-approval shift-replacement fallback with a visible inactive interval; the demo must describe the selected behavior.

## How the work is cut

```
                 P0 Foundation (joint)
   spike · shared types · interfaces · mocks · fixtures · app shell
                 /                                  \
   Track A (Person A)                          Track B (Person B)
   A1 Namespace                                B1 Arkiv data + faucet
        │            ──► I1 Names meet records ◄──    │
   A2 Permissions + EnsReader                  B2 Rules + verifier
        │            ──► I2 Real ENS history ◄──      │
   A3 Venue + routing                          B3 Volunteers + tickets
        │            ──► I3 Real venue + router ◄──   │
   A4 Winners + ENS consoles                   B4 Judging + freeze
                     ──► I4 Full demo ◄──
```

**The only hard dependency between people is P0.** After that:

- Every phase depends only on **P0** and on **the same track's earlier phases**. A never waits for B, and B never waits for A.
- Each track codes against **interfaces in `src/shared`**, with **mocks** standing in for the other track's work, behind **feature flags**.
- **Integration checkpoints (I1–I4)** are a separate, third kind of dependency. One starts when **both** matching phases are merged. It flips one flag from mock to real, runs a smoke test, and runs a **cross bug hunt**.
- **Integrations never gate the next phase.** When your phase is merged, start your next phase straight away. The checkpoint happens whenever both of you are ready. One ordering rule between integrations: **I3 requires I2 complete**, because its on-duty and partner-staff checks run on real ENS.
- **Final acceptance is different:** I4 requires I1–I3 completed plus A4/B4, and explicitly checks ENS/router/results are all live. Lagging integrations do not block phase development, but cannot be skipped at sign-off.

## Phases and specs

| Phase | File | Specs |
| --- | --- | --- |
| P0 · joint | `P0-foundation.md` | P0.6 wallet + chain spike (first) · P0.1 repo + CI · P0.2 shared types + config · P0.3 interfaces, mocks, conformance · P0.4 fixtures · P0.5 app shell |
| A1 | `A1-namespace.md` | A1.1 base + edition · A1.2 books + badge registrar · A1.3 teams + reserved `winner` |
| B1 | `B1-arkiv-data.md` | B1.1 chain + faucet · B1.2 record kinds + writers · B1.3 queue, batch, readers, watcher |
| I1 | `I1-names-meet-records.md` | Real badges, real `by` labels on Arkiv |
| A2 | `A2-permissions-ens-reader.md` | A2.1 resolvers · A2.2 scoped grants · A2.3 revoke + revive · A2.4 real `EnsReader` |
| B2 | `B2-rules-verifier.md` | B2.1 time mapping · B2.2 rules core · B2.3 determinism + `lanyard verify` |
| I2 | `I2-real-ens-history.md` | ENS flag → `sepolia`; rules on real history |
| A3 | `A3-venue-routing.md` | A3.1 venue editor + export · A3.2 grid router · A3.3 real `VenueMap` |
| B3 | `B3-volunteers-tickets.md` | B3.1 on-duty + shifts · B3.2 tickets · B3.3 partner tickets + seats |
| I3 | `I3-real-venue.md` | Router flag → `grid`; real venue on Arkiv |
| A4 | `A4-winners-consoles.md` | A4.1 `WinnerRegistrar` · A4.2 results lock + publisher · A4.3 ENS consoles |
| B4 | `B4-judging.md` | B4.1 projects + submissions · B4.2 judge flow · B4.3 aggregation · B4.4 freeze pipeline |
| I4 | `I4-full-demo.md` | Results flag → `sepolia`; full demo; final cross bug hunt |

Within a track, phases run in this order. A phase is done when its bug hunt is clean (see the lifecycle below).

## Ownership of paths

Disjoint paths mean merges don't conflict.

| Path | Owner |
| --- | --- |
| `src/shared/**` | **Both.** Additive changes only, each in its own commit (see below) |
| `fixtures/**` | Shared baseline in P0; additive phase-owned fixtures allowed (A: ENS history/Mumbai venue; B: flow/prize/capture fixtures). Coordinate modifications to existing shared files; real deployment-address fixture changes use integration branches |
| `app/_layout.tsx`, `app/index.tsx`, `src/shell/**`, `src/flags.ts`, `src/providers.ts`, `app.json`, `eas.json`, `package.json`, `tsconfig.json`, `eslint.config.mjs`, `contracts/foundry.toml`, `scripts/**`, `.github/**`, `README.md` | Shared: P0/integration by default; a phase may make a necessary coordinated dependency/config or Known limitations update in a separate reviewable change |
| `contracts/{src,test,script}/ens/**`, `src/ens/**`, `src/venue/**` | A |
| `app/admin/ens/**`, `app/venue/**`, `src/components/venue/**` | A |
| `src/arkiv/**`, `contracts/{src,test,script}/faucet/**`, `src/rules/**`, `cli/**`, `arkiv/**` | B |
| `app/{volunteer,lead,tickets,judge,team,teams,organizer}/**` | B |
| `deployments/sepolia.json` | A writes; B only reads |
| `deployments/rabdi.json` | B writes; A only reads |
| `plans/TRACKER.md` | Each person edits only their own track's section; integration sections are edited on integration branches |
| `plans/*.md` (everything else) | Reviewed baseline; explicit user-authorized corrections update cross-phase dependencies together |
| `e2e/**` | Integration branches only |

Import boundaries are enforced by `eslint.config.mjs`: Track A folders and Track B folders never import each other (except the two composition roots), `src/shared` and `src/rules` import nothing Node-, React Native- or Expo-specific, and nothing under `app/` or `src/` imports `cli/`.

If both people add app dependencies, `pnpm-lock.yaml` will conflict. Resolve it by re-running `pnpm i` after merging `main`.

`CODEOWNERS` encodes this table (P0.1).

## Interfaces are the contract

Defined in P0.3, in `src/shared/interfaces/`:

Concrete implementations are imported only by `src/providers.ts` and Node `cli/providers.ts`. The Node root gets the real reader at I2 and real publisher at I4; feature/rules modules consume shared interfaces. The app never imports `SepoliaResultsPublisher`.

| Interface | Real version by | Used by | Mock until |
| --- | --- | --- | --- |
| `EnsReader` (owner distinct from address, text, expiry, registration ID, unregister intervals) + `IdentityDirectory` | A2.4 | Shell, B2–B4 | I2 |
| `Router` (path, distances, nextTicket, judgeRoute) | A3.2 | B3, B4 | I3 |
| `ResultsPublisher` (state, confirmed publication/declare/lock, reconcile) | A4.2 | B4 resumable freeze CLI | I4 |
| `Venue` types + `venue.json` format | P0.2, filled by A3.1 | B3 (publish, seats) | I3 |

Rules for changing them:

1. **Additive mid-phase** (a new optional field or a new method): allowed. Put it in its **own commit** that touches only `src/shared`, update the mock in the same commit, and add a row to the interface change log in `TRACKER.md`. The other person picks it up the next time they merge `main`.
2. **Breaking** (rename, remove, changed meaning): coordinate a shared repair, update all consumers/mocks/conformance in the same reviewable change, and record it in `TRACKER.md`. Explicit user-approved plan repairs can define the initial corrected baseline before implementation.
3. Each real implementation must pass the **conformance suite** for its interface, and so must the mock. That's what makes the swap at integration boring.

## Feature flags

| Flag | Read by | Values | Flipped at |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_LANYARD_ENS` / `LANYARD_ENS` | App (`src/flags.ts`) / CLI | `mock` · `sepolia` | I2 |
| `EXPO_PUBLIC_LANYARD_ROUTER` | App | `stub` · `grid` | I3 |
| `LANYARD_RESULTS` | Freeze CLI | `mock` · `sepolia` | I4 |

Defaults stay `mock`/`stub` on phase branches, so nobody's work depends on the other track being finished.

Expo inlines every `EXPO_PUBLIC_*` variable into the app bundle, so every value is public. Use them for flags and read-only, app-restricted RPC URLs/keys only (treated as public, rotated if abused), **never** for signing, operator or decryption keys.

## Phase lifecycle

Every phase, every time:

1. **Branch** from an up-to-date `main`: `phase/<ID>-<slug>`. Optionally one branch per spec, `<id>/<spec>-<slug>`, with a stacked PR into the phase branch.
2. **Specs in order, several small commits per spec** (format in `00-git-workflow.md`). The spec's final commit marks it done in `TRACKER.md`, after `pnpm ci:local` passes.
3. **Phase bug hunt** on the phase branch (see below). Log the findings in `TRACKER.md`.
4. **Fix** every High: one fix commit per finding, with its regression test in the same commit.
5. Fix each Medium, or write it up in `README.md › Known limitations`.
6. **When the user requests integration**, merge into `main` after checks and mark it merged. The user pushes manually. Never infer permission to commit, merge or push from a phase checklist.

## Bug hunts

**Phase bug hunt (after every phase).** Run by someone who didn't write the code. So nobody has to wait for the other person, the default bug hunter is a **fresh AI agent session** with no memory of building it. Paste this prompt:

> You are the bug hunter for phase `<ID>` of Lanyard. You did not write this code. Read `plans/<ID>-*.md`, `plans/00-README.md` and `plans/01-evidence-and-interfaces.md`. Then read the diff `git diff main...phase/<ID>-<slug>`. Work through the phase bug-hunt checklist item by item, actually running each check (tests, scripts, local chain, testnet calls, the app on an Android device or Expo web) rather than reasoning about it. Then try to break the phase's requirements in ways the checklist doesn't list. For every finding, add a row to this phase's findings table in `plans/TRACKER.md`: what you tried, what you expected, what happened, severity. Do not fix anything. Report the checklist items you could not run, and why.

The other person reads the findings when they get to them and can add rows. They re-run the riskiest items at the next integration checkpoint.

**Cross bug hunt (every integration checkpoint).** Both people, each attacking the **other** track's code through the newly integrated path. Findings go in that integration's section of `TRACKER.md`.

**Final cross bug hunt (I4).** Both people run the demo script end to end on two Android phones plus the web consoles, and try to break every pitch claim.

**Severity:**

- **High:** breaks a guarantee the pitch claims (e.g. the organizer can backdate, a revoked judge's score counts, verify prints MATCH on wrong data). Must be fixed before merge.
- **Medium:** breaks a feature. Fix it, or write it up in `README.md › Known limitations`, before merge.
- **Low:** cosmetic or rare. Fix if cheap, otherwise log it.

## Shared conventions

- **Networks.** ENS on Sepolia. Arkiv on Rabdi: chain ID `7794095`, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, 2 s blocks, tGLM gas.
- **RPCs.** P0 measures explicit keyless Rabdi access. If it's too limited, the app ships a dedicated read-only Arkiv access key as a public value; a declared read-only proxy with server-held credentials is the fallback only if that also fails. Sepolia uses an archive endpoint with a read-only key restricted to the app (Android package and web origin), shipped as `EXPO_PUBLIC_SEPOLIA_RPC_URL`; a public mobile bundle cannot keep it secret, so it's treated as public and rotated if abused. Scripts and the CLI use their own keys from the local `.env`. Operator signing/decryption credentials never ship in the app, and no raw keyed transport diagnostics are logged.
- **Names.** Base `lanyard.eth`. Edition `mumbai2026.lanyard.eth`. Team `<team>.mumbai2026.lanyard.eth`. Winner `winner.<team>.mumbai2026.lanyard.eth`, created whenever a winner is declared.
- **Labels in code** are relative to the edition: `priya.volunteers`, `zkpay`, `ana.judges.arkiv.partners`.
- **Partners** are listed in `event.config.ts`: `arkiv` and `ens` for now. Adding one is a config and seed change, never a code change.
- **Tracks.** One per partner plus the non-partner `main` track, listed in `event.config.ts`. Global judges (`judges` book) score `main` only; partner judges score their own partner's track only.
- **Pinned versions.** Exact versions in `package.json` for `@arkiv-network/sdk`, the Expo SDK, Reown AppKit and viem. ENSv2 contracts are pinned by commit as a Soldeer git dependency in `contracts/foundry.toml` (no submodules). No upgrades during the build.
- **Addresses** live in `deployments/sepolia.json` and `deployments/rabdi.json`. Nothing is hard-coded.
- **Secrets.** The organizer key, results key and score-decryption key live only in the local `.env` of whoever runs the deploy, seed or freeze scripts. They never ship in the app. Users' keys never leave their wallets. `.env` is git-ignored; `.env.example` is committed.
- **APK builds** always use `--local`.
- **Requirements style.** EARS: `WHEN <trigger>, THE <component> SHALL <response>`. IDs are per spec, e.g. `A1.2-R3`.
- **Teams** have at most 4 people, written Person A, Person B, Person C, Person D in fixtures and the demo. (Not to be confused with the two builders.)
- **Seats.** Everyone has an assigned seat. No QR stickers.

## Decisions

All decisions taken, and the ones still open, are listed in `00-CONTEXT.md` §13–14.

The approved evidence/publication repair is specified in `01-evidence-and-interfaces.md`. Version pins, confirmation depths, cipher package/encoding and local build host are measured P0 deliverables; until recorded, the dependent capability remains blocked rather than being silently assumed.
