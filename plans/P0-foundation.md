# P0 · Foundation (joint)

**Track:** both · **Branch:** `phase/P0-foundation` · **Depends on:** nothing

## Goal

Everything the two tracks must agree on, built once and together, so that afterwards neither person ever waits for the other. This is the **only** phase where both people commit to the same branch. Split the specs as marked, and pair on P0.3 and P0.6.

**Repair 2026-11-06:** Person A was unavailable, so Person B builds the slice of P0 that B1 needs first, in a single Expo-root repo (see Track B slice below). Implement the authoritative [evidence and shared contracts](01-evidence-and-interfaces.md). This approved plan repair precedes implementation; no phase is marked implemented by this document change.

**Run P0.6 (the spike) first.** It decides how P0.5 wires up wallets, and whether any fallback is needed.

### Track B slice (merge to `main` before B1)

| Build now | Why B1 needs it |
| --- | --- |
| P0.1 repo, hooks, CI | Somewhere to build, with a safety net |
| P0.2 shared config, labels, canonical JSON, deployments, venue and team-page types | Record writers need config, labels and deployment shapes |
| P0.4a `personas.json` + `by_label` test | Writers and seeds need real persona labels |
| P0.5a Expo web shell (routes, flags, providers, web-only guard, `/teams/[team]`) | A home for B screens; web-export CI |
| P0.6a Node-side Arkiv checks S6, S9, S10, S12 | Decide Faucet vs fallback, SDK API, capture and shift-write profile |

| Deferred until | Item |
| --- | --- |
| Before B2 | P0.3 `EnsReader`/`IdentityDirectory` interfaces, mocks, conformance; `ens-history.json`, `timeline.json` |
| Before B3 | `StubRouter` + conformance; `venue.small.json`; stub `<VenueMap>` |
| Before B4 | `MockResultsPublisher` + conformance; S11 cipher; evidence edge-case scenarios |
| Person A / phone available | AppKit, `useWallet`, Android APK (S1–S5, S7, S8); ENSv2 contracts (A1) |

B1 writers code against a viem `WalletClient`, so Node tests use a local key until AppKit lands. The full P0 phase-done checklist still applies before I1.

## Out of scope

Any real ENS, Arkiv or routing logic. Only the spike's throwaway code, shapes, stubs and fixtures.

---

### P0.6 · Wallet and chain spike · *pair, first*

Prove the stack works before anyone builds on it. Throwaway code goes in `spike/` and is deleted at the end of P0. The results are recorded in `TRACKER.md › Spike`.

**Checks**
- **S1** A dev-client APK built on EAS cloud (`eas build --platform android --profile development`) with Reown AppKit installs on a real Android phone and connects MetaMask mobile over WalletConnect. Record the EAS build ID and confirm the build received no non-public env values.
- **S2** The connected wallet adds Rabdi (chain `7794095`) with `wallet_addEthereumChain` and switches to it.
- **S3** The Arkiv SDK runs on Hermes, using AppKit's EIP-1193 provider as the signer: create one entity, read it back, and check `$owner` == the connected address. Record the exact polyfills needed.
- **S4** One `executeBatch` with two creates needs exactly one wallet approval.
- **S5** S2–S4 pass on Expo web too, through AppKit's wagmi adapter.
- **S6** A trivial contract deploys to Rabdi and can be called (this is what decides whether the faucet is feasible).
- **S7** From the phone, `getEnsText` works at a past Sepolia block through the archive RPC, using a read-only app-restricted key shipped as `EXPO_PUBLIC_SEPOLIA_RPC_URL` (treated as public). Record which restrictions the provider actually enforces.
- **S8** Load test from one device: 10 parallel `watchEntityEvents` subscriptions and 200 reads/min on the public Rabdi RPC, keyless first and then with a dedicated read-only public app key if keyless is too limited. Also count the ENS reads `prepare` would need for 500 fixture records, with an on-device cache. Record any rate-limit errors and the ceiling found.
- **S9** Inspect and pin the installed SDK 1.0.x declarations, indexed schema/query API, native flags, expiry and gas behavior. Measure access with explicit `rabdi({ accessKey: "" })`; never infer that a key is unavailable because the app has no backend. If a proxy is needed it holds only an RPC access key, never wallet or decryption keys.
- **S10** Capture recent creation timestamps and page observation blocks/hashes on Rabdi, persist a readonly entity, delete it and show that ordinary reads cannot reconstruct it. Demonstrate an operator-attested bundle that survives deletion, and a scan gap that fails closed. Record network/reset identity, concrete confirmation depths and a bounded scan/watch reconciliation policy. Do not claim historical reads or complete capture of unseen entities.
- **S11** Prove the chosen score cipher and canonical hashing on Node, web and Hermes, including authenticated decryption failure and a fixed test vector. Pin a maintained X25519 + HKDF-SHA256 + AES-256-GCM sealed-envelope implementation and its exact envelope encoding; stop before judging work if no audited compatible implementation is available. The spike may not invent a cipher.
- **S12** On Android and web, test a replacement-shift create followed by clock/pass creates referencing its predicted key in one batch. Inspect the installed key-prediction API, distinguish entity-minting from transaction nonces, reuse the exact predicted salts, and match all ordered receipt keys and readback references. Demonstrate exclusive creator custody and an intervening-create failure; a per-device queue alone does not pass. If prediction or custody cannot be proven, select and test `confirmed-sequential` from the shared contract, including cancellation/restart between the confirmed shift and clock/pass batch. Record `shiftWriteProfile` and the evidence; two independent creates in S4 do not satisfy S12.

**Fallbacks**

| If | Then |
| --- | --- |
| S1–S5 fail with external wallets | Use AppKit's email/social-login wallet (stays on Reown) |
| S3 fails on Hermes even with polyfills | Stop and decide jointly before going further |
| S6 fails | A dedicated desk wallet (funded by the organizer) sends tGLM and writes a readonly Arkiv `drip` record; the desk refuses a second send to an address with a desk-wallet `drip`. The `Faucet` contract is dropped from B1.1 |
| S7 or S8 hit limits | First use a dedicated read-only app key shipped as a public value. If limits still bite, record a read-only cache/proxy profile and host allowlist; it may hold an operator RPC access key, holds no signing/decryption keys and signs no user actions. Bundle verification bypasses its cached ENS answers |
| S9–S11 lack required evidence | Leave the affected capability blocked; no guessed API, fabricated archive, confirmation value or cipher is allowed |
| S12 cannot prove linked creates under actual signer custody | Use `confirmed-sequential`: confirmed replacement shift, then clock/pass batch; two approvals and a visible inactive interval. Validate this fallback before B1/B3 work |

**Done when** every check has pass/fail and notes in `TRACKER.md`, and any fallback is chosen and noted there.

**Commit:** `docs(tracker): P0.6 spike results`

---

### P0.1 · Repo skeleton and CI · *Person A*

**Requirements**
- **P0.1-R1** THE repo SHALL be one Expo project at the root (one `package.json`, no workspace packages, no git submodules) with `app/`, `src/{shared,arkiv,rules,ens,venue,shell}`, `cli/`, `contracts/`, `fixtures`, `deployments`, `arkiv`, `e2e`, `plans`.
- **P0.1-R2** WHEN staged files contain a private key or mnemonic pattern, THE `pre-commit` hook SHALL reject the commit.
- **P0.1-R3** WHEN a pull request or a push to `main`, `phase/**` or `int/**` happens, THE CI SHALL run the secret scan, lint, typecheck, `vitest`, `forge test` (the one Foundry project) and `expo export --platform web`.
- **P0.1-R4** THE `CODEOWNERS` file SHALL encode the path-ownership table in `00-README.md`.

**Tasks**
- [ ] Expo project at the root, strict TypeScript, ESLint (with track/runtime import boundaries), Prettier
- [ ] One Foundry project in `contracts/` with Soldeer-pinned `forge-std`; ENSv2 is added by A1 as a Soldeer git dependency pinned by commit
- [ ] Husky `pre-commit`: secret scan + lint-staged
- [ ] GitHub Actions workflow; `pnpm ci:local` runs the same steps
- [ ] `CODEOWNERS`, `.env.example`, `.gitignore` (`.env`, `android/`, `*.apk`, `spike/`)
- [ ] Link project context from agent instructions without replacing existing user rules; create the planned context symlinks only where no instruction file already exists
- [ ] Document the Foundry dependency setup (Soldeer, `dependencies/` git-ignored, no submodules); A1 records exact ENS ABI/implementation commit compatibility

**Done when** a fake key is rejected locally and CI is green on an empty test.

**Commits:** several small `build`/`ci`/`chore` commits tagged `P0.1`, ending with `docs(tracker): P0.1 repo skeleton and ci done`.

---

### P0.2 · Shared types, event config, deployments schema · *Person B*

**Requirements**
- **P0.2-R1** THE `event.config.ts` SHALL hold the base name, edition, partners, tracks (one per partner plus the non-partner `main` track), event start/end, submission deadline, judging end, earliest publication `results` and exclusive `freezeDeadline` as Unix seconds; independent organizer/results/partner authority addresses; concrete chain confirmation policies and reset identities; integer venue scale; public score key/key ID/cipher suite from S11; `shiftWriteProfile` from S12; and evidence schema version. Hash the frozen config as defined in `01-evidence-and-interfaces.md`. Enforce its exact time ordering, cutoff window and derived `namespaceExpiry`; reject a config whose required ancestor lifetimes cannot be deployed.
- **P0.2-R2** THE shared `Venue` types SHALL describe the image size, cell size, walkable cells (run-length encoded), seats, points of interest (with a `kind`, including `help-desk` and `partner-table`, and an optional `partner` ID that `partner-table` POIs require) and zones, matching the `venue.json` format A3.1 exports.
- **P0.2-R3** THE deployment schema SHALL distinguish `mode: "mock"` placeholders from `mode: "live"` addresses. Live providers SHALL reject missing/zero addresses, wrong chain/reset IDs and a faucet address when the selected funding profile is the desk-wallet fallback (which requires a desk wallet address instead). Mock mode requires no secrets or real deployments.
- **P0.2-R4** THE shared `labels.ts` SHALL convert between relative labels (`priya.volunteers`) and full names (`priya.volunteers.mumbai2026.lanyard.eth`), normalizing with ENSIP-15.
- **P0.2-R5** THE shared module (`src/shared`) SHALL import nothing Node-only, so it runs on Hermes, in the browser, and on Node.
- **P0.2-R6** THE shared module (`src/shared`) SHALL define `TeamPageContent`, its bounds/link validation and `teamPageUrl(teamLabel, publicAppOrigin)` from the shared contract. Live deployment config SHALL require an edition-specific HTTPS `publicAppOrigin`; mock mode may use localhost. The ENS `url` target is the Lanyard page; the ETHGlobal showcase is a separate content link. P0 provides fixtures for a populated page, a registered team awaiting submission, an unknown team and failed reads.

**Tasks**
- [ ] `src/shared/event.config.ts`
- [ ] `types/venue.ts`: `Venue`, `Cell`, `CellRef`, `Seat`, `Poi`, `Zone`, `RoutingTicket`, `LocatedStop` (as named in `01-evidence-and-interfaces.md`)
- [ ] `src/shared/deployments/schema.ts` (zod), plus explicitly mock-mode `deployments/sepolia.json` and `deployments/rabdi.json`; fixtures never masquerade as live deployments
- [ ] `labels.ts` with tests (mixed case, trailing space and emoji rejected)
- [ ] `types/team-page.ts`, URL helper/validation, public origin in deployment schema and shared page-state fixtures

**Done when** both people can import every type and the loader rejects a broken deployments file.

**Commit:** `feat(shared): P0.2 shared types, event config and deployments schema`

---

### P0.3 · Interfaces, mocks, conformance suites · *pair*

Implement the exact `EnsReader`, `EvaluationContext`, `Router`/located-stop and `ResultsPublisher` signatures in [the shared contract](01-evidence-and-interfaces.md), rather than maintaining a second signature copy here. Export `Address` and `Hex` types explicitly. Add the pure registration-ID hash helper and permission-envelope schema, `IdentityDirectory.labelsFor(address, at)` and mock role discovery, canonical bundle encoding, config/evidence schemas and `RULES_VERSION` manifest format. The identity directory returns `{ label: Label; role: string }[]` at `{ sepoliaBlock: bigint }`; results are sorted by label and ownership-checked.

**Requirements**
- **P0.3-R1** THE `MockEnsReader` SHALL answer from `fixtures/ens-history.json` by replaying events up to the requested block.
- **P0.3-R2** THE `StubRouter` SHALL use integer Manhattan distance in millimetres and straight-line display paths, ignoring walls; it SHALL accept explicit evaluation time and located judge stops.
- **P0.3-R3** THE `MockResultsPublisher` SHALL persist its state through an injected store shared across CLI restarts, expose reconciliation, refuse duplicate declarations and every mutation after lock, and model successful/reverted/pending receipts. In-memory stores are allowed only in isolated unit tests.
- **P0.3-R4** THE `runEnsReaderConformance`, `runRouterConformance` and `runResultsPublisherConformance` suites SHALL be exported from `src/shared/testing`, and each mock SHALL pass its suite.
- **P0.3-R5** A deliberately broken mock (e.g. `owner` ignores the requested block) SHALL fail its conformance suite; the outer self-test asserts that failure.

**Conformance suites must check at least**
- `EnsReader`: historical owner differs from its address record; registration/unregister and ancestor expiry are honored; `text` reflects the requested block; exact expiry is invalid; unregister/re-registration intervals and equal/between-block timestamps work; `registrationId` changes on reissue, stays stable on renewal/role changes and is null for an invalid owner; RPC failures throw.
- `Router`: requested endpoints, integer units, explicit time/age, empty/unreachable tickets, key ties, and each unique located judge stop once. Conflicting duplicate locations fail. Grid-only wall checks live in A3.2.
- `ResultsPublisher`: persisted matching/conflicting state, duplicate declarations, restart after broadcast, receipt confirmation, and event-pointer and winner-record writes all rejected after lock.

**Tasks**
- [ ] Shared interfaces/types, identity directory mock and canonical evidence/config schemas
- [ ] Three mocks
- [ ] Three conformance suites, each with a broken-mock self-test

**Done when** `pnpm test src/shared` runs all conformance suites, each broken-mock self-test asserts the expected failure without making the overall run fail, and Node/web/Hermes canonical test vectors match.

**Commit:** `feat(shared): P0.3 interfaces, mocks and conformance suites`

---

### P0.4 · Shared fixtures · *Person B*

**Requirements**
- **P0.4-R1** THE `fixtures/personas.json` SHALL list every demo actor with their label, book, address, and the env var holding their key for local seed and e2e scripts: organizer, results key, desk wallet, volunteer coordinator, head judge, two partners (`arkiv`, `ens`) with two staff each, four leads, ten volunteers, six partner judges (three per partner), three global judges (`judges` book, `main` track), and three teams of up to four (Person A–D). Every team member, including the lead, has a `hackers` badge label.
- **P0.4-R2** THE `fixtures/venue.small.json` SHALL be a hand-made 20×12 grid with 12 seats, 2 zones, 3 points of interest (one `help-desk` per zone, plus a stage) and one walled-in seat.
- **P0.4-R3** THE `fixtures/ens-history.json` SHALL script a day of ENS events at Sepolia blocks, including: badges issued; Priya made lead; Priya's lead note removed at a known block; one judge unregistered mid-judging; one badge reaching expiry; one expired badge revived.
- **P0.4-R4** THE `fixtures/timeline.json` SHALL map the event's key times to mock Sepolia blocks (12 s per block from a fixed genesis).
- **P0.4-R5** Fixtures SHALL cover owner/address disagreement, deleted captured and uncaptured finals, expired logical leases with retained claims, post-cutoff revocation, publication restart, stale registration-bound lead notes, out-of-window cutoffs and partner ancestors surviving event end. All persona keys are env-var names only; authority wallets may have descriptive `by_label` values without badge ownership.

**Tasks**
- [ ] Four strict JSON fixture files; explain their stories in `fixtures/README.md` (JSON contains no comments)
- [ ] A test that every `by_label` value used in fixtures exists in `personas.json`

**Commit:** `chore(fixtures): P0.4 personas, small venue, ens history and timeline`

---

### P0.5 · App shell · *Person A*

Uses the wallet setup proven in P0.6, or its fallback.

**Requirements**
- **P0.5-R1** THE app SHALL be Expo (pinned SDK) + Expo Router + TypeScript at the repo root, with route folders created for each owner as in `00-README.md`, each holding a placeholder screen that says which phase fills it.
- **P0.5-R2** THE `eas.json` SHALL define a `development` profile (dev client APK) and a `preview` profile (installable APK). `pnpm app:apk` and `pnpm app:dev-apk` SHALL run `eas build --platform android --profile <p>` on EAS cloud; `pnpm app:apk:local` and `pnpm app:dev-apk:local` SHALL add `--local`. No build profile or EAS env holds a non-public value.
- **P0.5-R3** THE shell SHALL wrap Reown AppKit (native SDK on Android, wagmi adapter on web) behind one `useWallet()` hook that exposes the address, the chain, a viem wallet client, and an EIP-1193 provider for Sepolia and Rabdi.
- **P0.5-R4** THE `flags.ts` SHALL read `EXPO_PUBLIC_LANYARD_ENS` and `EXPO_PUBLIC_LANYARD_ROUTER`, and `providers.ts` SHALL return the mock or real implementation for each.
- **P0.5-R5** THE stub `<VenueMap>` SHALL draw the floor-plan image, seat dots and a straight path with `react-native-svg`, with the props A3.3 will keep: `venue`, `highlight`, `path`, `onSeatTap`.
- **P0.5-R6** THE shell SHALL discover ownership-checked labels through `IdentityDirectory`, add independently configured authority capabilities, show an active-role selector, and use forward resolution only for display. Unknown wallets SHALL have a working onboarding path; organizer access needs no fabricated badge.
- **P0.5-R7** WHEN a web-only screen (organizer, ENS consoles, venue editor) is opened on Android, THE shell SHALL show "Open on web" instead of the screen.
- **P0.5-R8** THE shell SHALL expose public `/teams/[team]` without wallet connection or role-selection gates, using a placeholder/template contract owned by B4. Public read providers SHALL work independently of AppKit signers. Configure Expo web `output: 'single'`, prepare static-host SPA rewrites and prove direct navigation/reload of a fixture team URL using a local static server. Record the intended public host/origin before A2 writes live ENS URL records; no deployment is performed by this phase without user authorization.

**Tasks**
- [ ] App scaffold, Expo Router layout, Hermes polyfills from P0.6
- [ ] AppKit + `useWallet()` on Android and web
- [ ] `eas.json`, the local APK scripts, and a `preview` APK installed on both builders' phones
- [ ] `flags.ts` and `providers.ts`
- [ ] Stub `<VenueMap>` with the fixed props
- [ ] Web-only route guard and placeholder screens
- [ ] Public team-route stub, wallet-independent read providers and local static-export deep-link smoke check

**Commit:** `feat(app): P0.5 expo app shell with appkit, flags and stub map`

---

## Phase bug hunt (the two people swap specs)

- [ ] A staged file containing a 64-hex private key is rejected
- [ ] Each broken mock really does fail its conformance suite
- [ ] `MockEnsReader`: Priya's lead note is present one block before its removal and gone at the removal block
- [ ] `labels.ts` rejects `Judges`, `judges ` and an emoji label
- [ ] `CODEOWNERS` assigns every path in the ownership table, and nothing is unowned
- [ ] Fresh clone: `pnpm i && pnpm ci:local` passes with no `.env`
- [ ] The web export and the preview APK contain no `.env` value other than `EXPO_PUBLIC_*` ones
- [ ] `pnpm app:apk` produces an installable preview APK on EAS cloud; the EAS project holds no secret and no non-public env value
- [ ] A web-only route opened on Android shows "Open on web"
- [ ] The shell connects on Android/web, discovers ownership-checked roles and shows the selected mock role
- [ ] An owner/address disagreement cannot grant a role; a wallet with multiple roles can select one
- [ ] Live providers reject mock deployments; the chosen cache/funding/build/shift-write profiles and S1–S12 evidence are explicit
- [ ] Canonical bundle bytes and cipher test vectors match on Node, browser and Hermes; no historical Arkiv read is assumed
- [ ] S12 proves linked references under actual custody or the sequential fallback; an interrupted second step cannot display an active replacement shift
- [ ] Config rejects unordered times; both cutoff timestamps must be in `[results, freezeDeadline)` and required ancestor expiries cover `namespaceExpiry`
- [ ] Registration ID conformance distinguishes reissue from renewal/role changes; old text remains readable but cannot grant a reissued badge permissions
- [ ] Disconnected browser opens/reloads `/teams/zkpay` from the served export; it never asks for a wallet just to view the page
- [ ] Team-page URL helper and fixtures agree with the configured origin; unsafe links fail and ETHGlobal remains a separate page button

## Phase done when

- [ ] All six specs are marked done in `TRACKER.md`
- [ ] Bug hunt run, Highs fixed with regression tests, Mediums fixed or in Known limitations
- [ ] `spike/` deleted
- [ ] Merged into `main`; both people branch their first phase from it
