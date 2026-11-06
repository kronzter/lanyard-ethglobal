# Lanyard · Master context

This page loads the project context. Read `01-evidence-and-interfaces.md` for the authoritative cross-phase evidence, trust and interface contract; phase files fill in feature details without overriding it. Plans are a reviewed baseline: user-authorized corrections update affected files together; implementation progress lives in `plans/TRACKER.md`. Never commit unless the user asks and never run `git push`.

**Linked into the repo root as `AGENTS.md` and `CLAUDE.md`** (symlinks to `plans/00-CONTEXT.md`, set up in P0.1), so every agent session loads it automatically.

## 1 · What we're building

**Lanyard** is an event operating system for hackathons, built first for the `mumbai2026` edition. It's an **Expo dApp** (Android and web) with actor-signed writes and local privileged CLIs, joining two chains. An optional read-only proxy and downloadable evidence-bundle host are declared infrastructure, not hidden exceptions to a no-host claim:

- **ENSv2 on Sepolia** gives everyone a role that expires: badges, permissions, team names, permanent winner names.
- **Arkiv on Rabdi** holds everything people do: shifts, clock-ins, help tickets, submissions, scores, results. Records are owned, timestamped and expire on their own.

**Trust model.** Arkiv ownership controls mutation; historical ENS registry ownership authorizes badge actions. A local operator attests retained readonly observations and publishes a signed evidence bundle. Anyone can reproduce that bundle with `lanyard verify`; this does not prove complete historical capture or the absence of unseen/deleted earlier records.

## 2 · Features

| # | Feature | In short | Phases |
| --- | --- | --- | --- |
| 1 | Volunteer management | Event badge plus a bounded, clocked-in shift session. A lead writes shifts/clocks; duty display ends at shift end independently of retention | A1, A2, B3 |
| 2 | Help tickets + venue | A grid over the floor-plan image. A hacker raises a ticket from their assigned seat; the nearest on-duty helper claims it, walks the drawn path, and gets the best next ticket. Partner-help tickets go to that partner's staff | A3, B3 |
| 3 | Judging | Partners judge their own tracks. Teams own their submissions. Scores stay sealed until freeze, and results can be recomputed by anyone. Winners get `winner.<team>.<edition>.<base>` | A4, B4 |

## 3 · App, wallets, chains

- Expo + Expo Router at `apps/app`. **Android** (locally built dev or preview APKs: `eas build --platform android --profile <p> --local`, never in the cloud) and **web**. The code stays iOS-compatible but is never built.
- Dev builds only. Expo Go can't load Reown AppKit's native modules.
- **Reown AppKit**: the native SDK on Android, the wagmi adapter on web, both behind one `useWallet()` hook. Chains: Sepolia and Rabdi. The fallback, if P0.6 fails for external wallets, is AppKit's email/social-login wallet.
- **No server signer.** Actions use the actor's wallet. Deploy, seed, capture and freeze are local CLIs. Optional read-only RPC proxy holds no signing/decryption keys; evidence bundles are downloadable and also verifiable from a local file. Declare each service/profile in P0 and I4.
- Field screens (hacker, volunteer, lead, judge, team) are for phones. Organizer screens, ENS consoles and the venue editor are **web-only**: on Android they show "Open on web".
- Venue map: `react-native-svg` + `react-native-gesture-handler` + `react-native-reanimated`, the same component on native and web.
- `packages/rules` is pure TypeScript that runs unchanged on Hermes (in the app) and Node (in the CLI).
- **Gas.** Staff send Sepolia writes; field actors only read ENS through app flows. Arkiv writers get initial tGLM at the desk through P0's proven faucet-contract or direct-transfer profile.

## 4 · Names

```
lanyard.eth                                   base (organizer)
└── mumbai2026.lanyard.eth                    edition registry, EMANCIPATED
    ├── hackers | judges | volunteers | partners
    │                                         books: organizer-owned, MANAGED registries
    │   └── <partner>.partners
    │       ├── judges.<partner>.partners     that partner's judges
    │       └── staff.<partner>.partners      that partner's booth staff (answer partner tickets)
    └── <team>.mumbai2026.lanyard.eth         team names, owned by team leads
        └── winner.<team>…                    reserved at team registration,
                                              promoted only by WinnerRegistrar
```

- In code, labels are **relative to the edition**: `priya.volunteers`, `zkpay`, `ana.judges.arkiv.partners`, `sam.staff.ens.partners`.
- The organizer issues every book badge and every team name **directly** at the onboarding desk (scan or paste the holder's address). There are no vouchers.
- Winner names are created **every time a winner is declared**: one name per team, listing all its prizes.
- Teams have at most four people, written Person A–D in fixtures and the demo.

## 5 · Who can do what (ENS)

| Account | Can |
| --- | --- |
| Organizer | Register, unregister, renew and set resolver on every managed book; issue badges and register teams through `LanyardRegistrar`; onboard partners |
| `LanyardRegistrar` | Register/renew on edition/books; stable reserved-winner promotion/renewal roles in team registries; fixed forwarders callable only by one-shot `WinnerRegistrar` |
| Head judge | Register and unregister in `judges` only |
| Each partner | Register and unregister in its own `judges.<partner>` and `staff.<partner>` sub-books only |
| Volunteer coordinator | `setText` for key `lanyard.perms` only, on the staff resolver |
| Results key | Calls publication/declare/lock on `WinnerRegistrar` through the local CLI; no direct resolver roles |
| `WinnerRegistrar` | Sole publication-resolver text writer/admin until atomic event + winner lock; uses registrar forwarders for child promotion and parent renewal |
| Team lead | Set resolver and renew on their own team name; register member names in their own team registry. Can't touch `winner` |

App-issued badges omit transfer-admin; raw authorized registrars can choose other bitmaps, so nontransferability against an issuer is not guaranteed. Revoke = `unregister()`. Revival by root renewal restores an expired registration; unregister/re-register is a new registration identity. Registry ownership and forward address records are distinct.

## 6 · Records (Arkiv)

Every record has `app: "lanyard"`, `event: "mumbai2026"`, `kind` and `by` (the writer's relative ENS label). The full table, with owners, flags and expiries, is in `B1-arkiv-data.md`.

Kinds: `venue`, `seat_assignment`, `shift`, `clock`, `duty_pass`, `ticket`, `ticket_claim`, `ticket_resolution`, `ticket_confirmation`, `project`, `submission`, `acceptance`, `rubric`, `judge_assignment`, `score_sheet`, `final_score`, `recusal`, `results`. Draft projects/sheets are mutable; adjudication uses immutable submission snapshots and retained readonly dependencies.

Every app write is signed by the user's wallet through AppKit. Use `executeBatch` wherever records belong together: one batch is one wallet approval.

## 7 · Rules that matter most

- A badge/team action counts only if captured creator/flags match its policy and `EnsReader.owner` matches the creator with valid ancestor expiry/notes at creation. Authority-only kinds use frozen authority addresses, not invented badges or resolved payment addresses.
- Time chain: retained recent Arkiv creation timestamp → latest Sepolia block at/before that timestamp → archive ENS reads. Present-tense decisions separately use explicit evaluation cutoffs; no arbitrary historical Arkiv query is available.
- Rules are **pure**: no clock, randomness or network inside. Integer maths, stable sort, ties broken by earliest block, then lowest record key.
- Records that fail are shown greyed out with a reason, never hidden.
- **On duty at T** = valid badge plus a covering valid shift with an open clock-in for that shift. Sessions end at shift end without requiring clock-out. Self-start is accepted in the preceding 60 min but activates only at shift start; countdown derives from the shift when no lead pass exists. Lead notes bind the current registration ID and holder. Shift replacement uses P0-S12's proven linked batch or its two-step confirmed fallback, which visibly leaves the new shift inactive until clock-in.
- **Tickets:** logical lifetime 4 h, claim lease 15 min; readonly evidence retained to event end + 7 d. Earliest eligible claim starts an attempt, losers never queue into future attempts. Resolutions bind the winning claim and remain valid after lease end. At most 3 open tickets/hacker, earliest first. Partner staff require their own partner badge at both actions, without shifts. Medical/safety redirects to staff phone/help desk. Integer routing discounts waiting by 5 m/min using explicit evaluation time.
- **Judging:** earliest valid captured submission per team before deadline, with exact immutable content. Earliest valid captured final per assigned judge/submission before judging end. Unregistering a judge before cutoff excludes that registration's scores; later reissue does not restore them. Scores remain sealed until freeze; pre-freeze screens show completion/eligibility only. Post-freeze rankings use exact rational raw weighted means and never change after the pinned cutoff. Capture completeness is not proven.
- **Freeze order:** reconcile capture → freeze config/prizes/cutoffs → enforce both cutoff timestamps in `[results, freezeDeadline)` → prepare/authorize → validate operator key → decrypt eligible candidates, rejecting invalid rows → rules → validate/retain/sign/download-check bundle → persist publication job → compact `results` → set event commitment → declare winners → atomic lock. No early key disclosure. Resume only the saved job with receipt/state reconciliation; no blind resend. Verification checks the saved window independently. Manual prize input remains disclosed (§14).
- **Judging lifetimes/recovery:** judge badges last to `freezeDeadline`; structural names and their ancestors cover `namespaceExpiry = max(eventEnd, freezeDeadline) + 30 days`. Staff badges still end with the event. Editable drafts recover only on the same device/browser profile; Arkiv stores encrypted mirrors, not a judge-decryptable backup.

## 8 · How the two tracks stay independent

- **Person A · ENS & venue:** `packages/{contracts,ens,venue}`, `apps/app/app/admin/ens/*`, `apps/app/app/venue/*`, `apps/app/src/components/venue/*`.
- **Person B · Arkiv & flows:** `packages/{arkiv,faucet,rules,cli}`, `arkiv/`, `apps/app/app/{volunteer,lead,tickets,judge,team,organizer}/*`.
- **Shared** contracts/shell: built in P0, coordinated changes afterward. Phase-owned fixture additions are allowed under the ownership table; breaking interface repairs update every consumer/mock together. Suggested commit boundaries apply only if the user requests commits.
- Interfaces: `EnsReader` (real in A2.4), `Router` (real in A3.2), `ResultsPublisher` (real in A4.2). Each has a mock and a conformance suite.
- Flags: ENS mock→sepolia at I2 · router stub→grid at I3 · results mock→sepolia at I4.
- Feature/rules modules never import another track's package directly. Shared interfaces are wired only in app `apps/app/src/providers.ts` and Node `packages/cli/src/providers.ts`; the app never imports the CLI-only results publisher.

## 9 · Phase order

| Step | Track A | Track B |
| --- | --- | --- |
| 0 | P0 Foundation (joint, P0.6 spike first) | P0 Foundation (joint) |
| 1 | A1 Namespace | B1 Arkiv data + faucet |
| ↳ | I1 Names meet records | I1 |
| 2 | A2 Permissions + EnsReader | B2 Rules + verifier |
| ↳ | I2 Real ENS history | I2 |
| 3 | A3 Venue + routing | B3 Volunteers + tickets |
| ↳ | I3 Real venue + router | I3 |
| 4 | A4 Winners + consoles | B4 Judging + freeze |
| ↳ | I4 Full demo + final bug hunt | I4 |

There are no time windows. Integrations do not block the next development phase. Final I4 acceptance requires A4/B4 and completed I1–I3, with every provider live.

## 10 · Working rules (short version)

Full detail is in `00-README.md` and `00-git-workflow.md`.

- One branch per phase, `phase/<ID>-<slug>`, and one per integration, `int/<ID>-<slug>`. Plain merges into `main`.
- **When commits are requested**, use one per spec/finding with regression checks. Never commit automatically; the user pushes manually.
- A bug hunt after **every** phase, by someone who didn't write it (by default a fresh agent session; the prompt is in `00-README.md`). Highs are fixed before merge.
- Plans change through explicit user-authorized repairs with affected consumers updated together. Progress goes in `plans/TRACKER.md`; a repaired plan is not completed implementation.
- APK builds always use `--local`.

## 11 · Pitfalls we already know about

**ENSv2**
- Token IDs change whenever roles change. Always look names up by **label hash**.
- A key-scoped resolver role reaches **every name on that resolver**. That's why staff names have their own resolver.
- A role can have at most 15 holders per resource.
- No `setApprovalForAll` on badges, ever.
- A child name stops resolving when its parent expires, so winners need their team name renewed.
- Emancipation can't be undone. Check `isEmancipated()` and the root role holders, including `ROLE_UPGRADE`.

**Arkiv**
- `readonly` and `permissionlessExtension` are fixed when a record is created.
- Readonly entities can still be deleted/transferred. Retention is not a business lease; captured evidence is an operator attestation, not a complete immutable history.
- Expiry fires **no event**: compare `$expiresAt` with the current block.
- Extensions can only move expiry later, counted from now. The maximum lifetime is 7,884,000 blocks (≈182.5 days).
- Limits: 32 attributes, 128-byte strings, 128 KiB payload, 100 rows per page.
- The node rejects `!=`. Never use `ne()`/`not()`; model status positively.
- `executeBatch` is atomic and runs in order: creates → patches → deletes → extensions → ownership changes.
- The SDK renamed `expires` → `expiration`. The version is pinned; don't upgrade.
- Explicit empty-key access is heavily limited; RPC keys exist and are separate from wallet signing. P0 measures keyless access and any selected read-only proxy; no operator key is embedded in a wallet/app.

**Expo, AppKit, wallets**
- No Expo Go. Use local dev builds.
- Every `EXPO_PUBLIC_*` value is inlined into the bundle. Never put a key there.
- viem and the Arkiv SDK need polyfills on Hermes (at least `crypto.getRandomValues`). P0.6 pins the exact set.
- With an external wallet, every transaction is a switch to the wallet app. Batch writes, and make the write queue survive the app going to the background.
- The wallet must add Rabdi (`wallet_addEthereumChain`) before the first Arkiv write.
- Local APK builds need the Android SDK and JDK on the builder's machine.
- `eas build --local` needs a proven Linux/macOS host; Windows/WSL is not officially supported by Expo. Prove the chosen local build route in P0, without cloud builds.

**General**
- The organizer key, results key and score-decryption key exist only in the local `.env` of whoever runs the scripts or CLI. They never ship in the app.
- ENS reads at a past block need an **archive** RPC. If the RPC fails, throw; never return "no name".

## 12 · Glossary

| Term | Meaning |
| --- | --- |
| Badge | An ENS name in a book, e.g. `priya.volunteers…`. Proves a role until it expires or is unregistered |
| Book | One of the four managed registries under the edition (hackers, judges, volunteers, partners) |
| Sub-book | A partner's `judges.<partner>` or `staff.<partner>` registry, managed by that partner |
| Note | A text record such as `lanyard.perms`, set through a key-scoped role |
| Lead | A volunteer whose `lanyard.perms` envelope grants `shift-manager` for its current registration ID and holder |
| Duty pass | Lead-written display evidence with logical shift-end deadline; self sessions derive countdown directly from the shift |
| Claim | A `ticket_claim`: a 15-minute hold on a ticket |
| Onboarding desk | The web console where the organizer issues badges and teams (A4.3) and drips tGLM (B1.1) |
| Faucet | Contract on Rabdi, funded by the organizer, that sends a fixed amount of tGLM once per address |
| Results key | The wallet the freeze CLI uses to publish results and declare winners |
| Freeze | The one-time local pipeline that publishes results and winner names |
| Verify | `lanyard verify mumbai2026 --bundle <path>` reproduces signed captured inputs with historical ENS checks and prints scoped `MATCH`; completeness is unproven |
| Conformance suite | Tests that every implementation of an interface must pass, mock and real alike |

## 13 · Decisions taken

| Question | Decision |
| --- | --- |
| Edition label | `mumbai2026` |
| App | Expo + Expo Router, Android + web; iOS-compatible but never built |
| APK builds | Always local (`eas build --local`) |
| Wallets | Reown AppKit with external wallets; fallback to AppKit email/social login if P0.6 fails |
| Infrastructure | Actor-signed writes, local capture/freeze, downloadable retained bundles; optional declared read-only proxy may hold RPC credentials but no signing/decryption keys |
| Badge issue | The organizer issues directly at the desk; no vouchers |
| Team registration | The organizer registers teams at the desk, to the lead's address |
| tGLM for users | On-chain `Faucet` contract on Rabdi; the desk calls `drip` |
| Books | Four: hackers, judges, volunteers, partners. Mentors and agents are cut |
| Partners | `arkiv`, `ens`, config-driven; a third partner may be added later |
| Partner ticket helpers | `staff.<partner>.partners` sub-book |
| Submissions | Earliest valid captured candidate/team before deadline; immutable content snapshot; unseen prior deletions cannot be ruled out |
| Scoring | Raw weighted mean per track only |
| Sealed scores | Kept; the decryption key lives only in the freeze CLI's local env and is published in the results record at freeze |
| A revoked judge's scores | That registration's scores excluded at freeze cutoff; reissue does not restore them; post-cutoff changes do not alter published results |
| Seating | Everyone has an assigned seat |
| QR stickers | Not available; the venue is a grid over the floor-plan image |
| Helper start position | Their zone's help-desk POI when they clock in |
| Progress tracking | `plans/TRACKER.md`; authorized plan repairs remain distinct from implementation status |

## 14 · Open (TBD)

| Question | Status |
| --- | --- |
| Prize rules: how many places per track, prize names, how the leaderboard maps to prizes | Not decided. Until it is, the freeze CLI and `declareWinner` take the winning teams and prize strings as an input file (`fixtures/prizes.json`) |
| Third partner | Will be added later as a config and seed change |
