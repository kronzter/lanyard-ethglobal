# A1 · ENS namespace

**Track:** A · **Branch:** `phase/A1-namespace` · **Depends on:** P0 · **Integration:** I1

## Goal

Create the name tree every other feature relies on.

```
lanyard.eth                                  base (organizer)
└── mumbai2026.lanyard.eth                   edition registry, EMANCIPATED
    ├── hackers | judges | volunteers | partners
    │                                        book names owned by organizer,
    │                                        each pointing to a MANAGED registry
    │   (partner names and their judges/staff sub-books are created in A2.2)
    └── <team>.mumbai2026.lanyard.eth        team names owned by team leads
        └── winner.<team>…                   reserved now, promoted in A4
```

**Why the edition registry is emancipated:** team names live directly in it. If the organizer held registry-wide unregister, set-resolver or set-subregistry roles there, it could take or redirect any team's name. Emancipated means the only registry-wide roles are register and renew, held by `LanyardRegistrar`. The organizer controls its book names through name-level roles on names it owns.

**Who sends these transactions:** only the organizer, from local scripts for now and from the A4.3 onboarding desk later. No desk flow requires holders or team leads to pay Sepolia gas; a lead's direct name management (resolver, renewal, member names) is optional and at their own cost.

## Out of scope

The full A2 permission-note tooling and reader, plus the desk UI (A4.3) and Arkiv code (Track B). **Predeployment repair approved 2026-11-06:** the immutable registrar must already contain A2's fixed-resolver and delegated-issuance entrypoints before A1 deploys. Separate hackers/staff resolvers and the final head-judge address are configured once before bootstrap; partner onboarding can run later through the fixed policy. `WinnerRegistrar` itself remains A4.1: A1.3 reserves the slot and installs fixed forwarding authority per [the shared publication contract](01-evidence-and-interfaces.md).

---

### A1.1 · Base name and edition registry

**Requirements**
- **A1.1-R1** THE deploy script SHALL explicitly create both hierarchy levels: attach a base `UserRegistry` to `lanyard.eth`, register `mumbai2026` inside that base registry, and attach the separate edition registry to that edition label. Set canonical parent pointers during setup and lock their setter/admin roles. Registering books directly in the base registry does not create the edition hierarchy.
- **A1.1-R2** WHEN edition setup completes, THE edition registry SHALL report `isEmancipated() == true`, with only `ROLE_REGISTRAR` and `ROLE_RENEW` held on its root, both by `LanyardRegistrar`.
- **A1.1-R3** WHEN the edition is created, THE deploy script SHALL reserve the protected labels `admin`, `staff`, `lanyard`, `ethglobal`, `winner` in the edition registry.
- **A1.1-R4** Register the edition name to `LanyardRegistrar` with far-future expiry, its final subregistry, name-scoped renewal and temporary set-resolver/admin roles assigned at registration. Its organizer-only one-shot `setPublicationResolver(address)` sets the publication resolver in A2, stores the fixed winner-forwarding resolver, and atomically revokes its own edition set-resolver/admin. No edition set-subregistry or transfer authority is granted. Before A2 that bounded path is pending, not reported sealed. Base-owner ancestor authority/expiry remains disclosed.
- **A1.1-R5** Namespace bootstrap SHALL run through a one-shot registrar setup path that creates the protected reservations and book names before enabling team registration, then seals itself. The deploy script cannot assume its organizer EOA holds the final edition root registrar role. Bootstrap/regrant authority SHALL not survive sealing.
- **A1.1-R6** Before bootstrap, `configureIssuance(hackersResolver, staffResolver, headJudge, baseName)` SHALL freeze distinct fixed resolvers, their registrar address-write authority and the final head judge. Missing or conflicting configuration SHALL block bootstrap and deployment recovery. Recovery SHALL require the expected registrar version; matching constructor getters alone cannot establish implementation compatibility.

**Tasks**
- [ ] Find the ENSv2 Sepolia addresses (verifiable factory, `UserRegistry` implementation, Permissioned Resolver implementation, Universal Resolver) and record them in `deployments/sepolia.json`
- [ ] Register/renew `lanyard.eth` on Sepolia to cover the derived `namespaceExpiry`; verify the actual ancestor expiries
- [ ] `deploy-edition.ts` (viem, organizer key from local `.env`), tested on a local fork first
- [ ] Foundry test: root role holders are exactly as in R2, with no `ROLE_UPGRADE`

**Done when** `deploy-edition.ts` runs on a Sepolia fork and on Sepolia, and the emancipation test passes on both.

**Commit:** `feat(ens): A1.1 base name and emancipated edition registry`

---

### A1.2 · Badge books and `LanyardRegistrar`

**Requirements**
- **A1.2-R1** WHEN the edition is created, THE deploy script SHALL register the four book labels (`hackers`, `judges`, `volunteers`, `partners`) to the organizer **before** any team can register.
- **A1.2-R2** WHEN a book name is registered, THE deploy script SHALL attach a managed `UserRegistry` in which the organizer holds register, unregister, renew and set-resolver on its root, and `LanyardRegistrar` holds register and renew. The judges root SHALL additionally grant the configured head judge UNREGISTER at initialization. No book-root admin survives, so A2 verifies this grant instead of trying to add it later.
- **A1.2-R3** WHEN any badge is issued through `LanyardRegistrar`, THE contract SHALL hard-code its role/expiry policy, excluding transfer-admin, set-resolver and set-subregistry roles and their admins. A caller-supplied role bitmap or expiry cannot bypass this policy. The same policy applies to `registerJudge` and `registerPartnerBadge`, whose contract entrypoints must exist before deployment even when their onboarding tools land in A2. All registrar issue paths atomically initialize the fixed resolver and explicit holder address. Direct issuance through the organizer's remaining raw book role is issuer trust, explicitly tested and disclosed in A2.
- **A1.2-R4** THE registrar SHALL set expiries per book:

  | Book | Expiry |
  | --- | --- |
  | hackers | event end + 7 days |
  | judge badges (global and partner) | `freezeDeadline` |
  | volunteer and partner staff badges | event end |
  | structural book names, `<partner>.partners` and partner `judges`/`staff` sub-book names | at least `namespaceExpiry` |

  `namespaceExpiry = max(eventEnd, freezeDeadline) + 30 days` per the shared contract. Structural partner names are parents, not event-end staff badges. A1 deploys the four books to this bound; A2 does the same for partner parents/sub-books. Verify every ancestor, including base and edition, covers it before issuance. Judge eligibility remains checked at the actual cutoff; publication after `freezeDeadline` requires an already-saved valid job, not a new freeze.

- **A1.2-R5** WHEN anyone other than the organizer calls `registerBadge`, THE registrar SHALL revert.
- **A1.2-R6** WHEN a badge is issued, THE registrar SHALL emit `BadgeIssued(book, label, owner, expiry)`.

**Design**
- `registerBadge(bytes32 book, string label, address owner)`: organizer only; expiry, roles, fixed resolver and address initialization come from frozen policy. The contract-facing A2 hooks are included before A1 deployment; configuring a publication resolver and completing A2's URL/permission tooling remain separate.
- The `hackers` badge is issued to every team member, including the team lead (the lead also owns the team name from A1.3).
- `renew(bytes32 book, string label, uint64 newExpiry)`: used by A2.3 for revival.
- App reads always use the label hash, never token IDs (token IDs change whenever roles change).

**Tasks**
- [ ] `deploy-books.ts`
- [ ] `LanyardRegistrar.sol`: books, expiry table, organizer-only issue
- [ ] Foundry: every requirement has a passing and a failing test
- [ ] `issue-badge.ts` CLI for seeding

**Commit:** `feat(contracts): A1.2 badge books and LanyardRegistrar`

---

### A1.3 · Team names and the reserved `winner` slot

**Requirements**
- **A1.3-R1** WHEN the organizer registers a team, THE registrar SHALL deploy a team `UserRegistry` and register `<team>` in the edition registry to the team lead's address, with that subregistry and only the roles `ROLE_SET_RESOLVER` and `ROLE_RENEW`.
- **A1.3-R2** WHEN a team label is submitted, THE registrar SHALL accept it only if it's normalized (ENSIP-15), matches `[a-z0-9-]{3,32}`, doesn't start or end with `-`, and isn't a book or reserved label.
- **A1.3-R3** WHEN a team registers, THE registrar SHALL reserve `winner` in the team subregistry in the same transaction (owner `0`, bitmap `0`, far-future expiry).
- **A1.3-R4** THE team subregistry SHALL be emancipated: the team lead holds `ROLE_REGISTRAR`; the already-deployed `LanyardRegistrar` holds `ROLE_REGISTER_RESERVED` and `ROLE_RENEW`. No root admins survive setup. This stable forwarding address is installed for every team at creation, even before `WinnerRegistrar` exists.
- **A1.3-R5** THE registrar SHALL expose organizer-only one-shot `setWinnerRegistrar(address)` and one-shot publication-resolver configuration. Only that configured contract can call `promoteWinner(team, lead, expiry)` or `renewWinningTeam(team, expiry)`. Forwarders validate a registered team and its owner, use the fixed publication resolver, and expose no arbitrary calls or role grants. No late root-role backfill is needed or allowed.
- **A1.3-R6** THE initial team name expiry SHALL be `namespaceExpiry`, covering the supported freeze window; A4 renews a winning team's parent further for winner-name availability.
- **A1.3-R7** WHEN anyone other than the organizer calls `registerTeam`, THE registrar SHALL revert.
- **A1.3-R8** Child bootstrap SHALL temporarily authorize the fixed `LanyardRegistrySetup` companion to reserve `winner` and grant the lead's registrar role, then remove every companion setup role before returning. The companion is created in the registrar constructor and has no upgrade/arbitrary-call path; its registry-creation functions are callable only by the registrar. It can initialize fresh registries, never backfill roles on an existing registry. This keeps the registrar within EIP-170 without changing the stable final grants in R4. Holding `ROLE_REGISTER_RESERVED` alone is not authority to create the initial reservation. Prove the complete ordering and both runtime size limits in Foundry tests.

**Tasks**
- [ ] `registerTeam(string label, address lead)` in `LanyardRegistrar`
- [ ] Label validator with a fuzz test
- [ ] One-shot winner/resolver configuration and narrowly scoped promotion/parent-renewal forwarders
- [ ] `register-team.ts` CLI; seed three demo teams (Person A–D each), each member also issued a `hackers` badge

**Commit:** `feat(contracts): A1.3 team names with reserved winner slot`

---

## Phase bug hunt

- [ ] Transfer a badge with `safeTransferFrom` and `unsafeTransfer`: both revert
- [ ] As the organizer, `unregister` a team name in the edition registry: reverts
- [ ] `isEmancipated()` is true on the edition and team registries; `roleCount(ROOT_RESOURCE)` shows no unexpected holders, including `ROLE_UPGRADE`
- [ ] Register teams named `judges`, `admin`, `winner`, `Judges`, `judges `, `-zk`, an emoji: all rejected
- [ ] Register the same team twice: the second fails
- [ ] A non-organizer calls `registerBadge` or `registerTeam`: reverts
- [ ] A team lead calls `setSubregistry` on their own name: reverts
- [ ] A team lead registers `winner` in their own subregistry: reverts
- [ ] A badge at exactly its expiry timestamp is treated as expired (`block.timestamp >= expiry`)
- [ ] Partner namespace expiry is independent of event-end staff expiry; a judge remains eligible after event end within the freeze window, and a short-lived ancestor blocks deployment validation
- [ ] Grant then revoke a role; the name is still found by label hash
- [ ] Call `setWinnerRegistrar` twice: the second reverts
- [ ] A team created before winner-contract deployment works afterward without any new child-registry role grant
- [ ] Forwarders reject organizer, team lead and arbitrary callers; only the configured winner contract may promote/renew
- [ ] Base → edition → book/team lookups traverse distinct registries; ancestor and edition pointer authority is inventoried
- [x] Who holds dangerous roles on `lanyard.eth`'s parent registry, and is that acceptable for the demo? Write the answer in `README.md › Known limitations`
- [x] `deployments/sepolia.json` passes the P0.2 schema

## Phase done when

- [x] A1.1, A1.2, A1.3 marked done in `TRACKER.md`
- [ ] Bug hunt run by someone who didn't write the code; Highs fixed with regression tests (skipped by decision, 2026-11-07)
- [ ] Mediums fixed or in Known limitations
- [ ] Merged into `main`
