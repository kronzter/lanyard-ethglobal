# Team registration (A1.3)

The organizer creates a team through `LanyardRegistrar.registerTeam(label, lead)`.
The lead receives the team name with resolver and renewal permissions. Its child
registry lets the lead register member names; `winner` is already reserved when
the transaction returns. The child is emancipated, with only the lead's registrar
role and LanyardRegistrar's reserved-registration and renewal roles on its root.
No setup admins or upgrade authority survive. The constructor-created
`LanyardRegistrySetup` companion performs bounded setup so the registrar fits the
EVM size limit; the companion holds no roles on returned registries.

Use the existing ENS operator process environment and a fresh registrar version
`lanyard.registrar/2`. Older A1 draft bytecode is rejected during deployment recovery.
The deployment
script records the registrar address in `.lanyard/edition-fork.json` or
`.lanyard/edition-sepolia.json`. These scripts read process environment variables;
they do not open an env file.

Before namespace bootstrap, deploy the three separate permissioned resolvers and
configure issuance. The scripts read/save public resolver metadata at
`.lanyard/resolvers-<fork|sepolia>.json`. Resolver deployment is deterministic and
resumable. `--plan` reads state without deploying or modifying the journal.

```sh
pnpm exec tsx scripts/ens/deploy-resolvers.ts --fork --plan
pnpm exec tsx scripts/ens/deploy-resolvers.ts --fork
pnpm exec tsx scripts/ens/deploy-edition.ts --fork --plan
pnpm exec tsx scripts/ens/deploy-edition.ts --fork
```

`deploy-edition` grants the registrar only the coin-type-60 address setter on the
hackers/staff resolvers, then freezes their pointers, the head judge and DNS base
name through `configureIssuance` before calling bootstrap. The head judge receives
UNREGISTER on the judges root at creation; no root admin is retained for later
grants. For live Sepolia, set the public `LANYARD_HEAD_JUDGE` address explicitly;
only a loopback fork can default to the public fixture's head judge. The scripts
also require the existing RPC/signing environment, and a live run still needs
confirmed authority/date settings. Do not use the public fixture signing keys for
a live deployment.

```sh
pnpm exec tsx scripts/ens/register-team.ts --label zkpay --lead <address> --fork --dry-run
pnpm exec tsx scripts/ens/register-team.ts --label zkpay --lead <address> --fork
pnpm exec tsx scripts/ens/register-team.ts --demo --fork --dry-run
pnpm exec tsx scripts/ens/register-team.ts --demo --fork
```

`--demo` reads the public fixture roster: zkpay, chainchat and seatsense, each with
Person A–D. It registers each team to Person A and issues all twelve hackers badges,
including the leads' badges. Fixture wallets have publicly known test keys, so demo
seeding requires `--fork` and the existing connection helper enforces a loopback RPC.
For real Sepolia holders, omit `--fork` and register individual teams to their actual
wallets after configuring the organizer and deployment.

Labels must already be normalized under [ENSIP-15](https://docs.ens.domains/ensip/15/#validate), be 3–32 lowercase ASCII letters,
digits or internal hyphens, and avoid the four book names plus admin, staff, lanyard,
ethglobal and winner. The ASCII ENSIP-15 rule also rejects hyphens in both the third
and fourth positions. Validation is enforced in both Solidity and TypeScript.

The CLI observes the whole requested seed before sending its first transaction.
An intact matching team or badge is skipped. Conflicting holders, broken child
pointers and expired registrations block the run. Team and badge transactions are
sequential; rerunning reconciles any completed work. Seeding all teams and badges
is not one atomic transaction. Individual team creation, including reservation and
setup-role removal, is atomic.

The fixed contract-facing A2 paths are already present: `registerJudge` is
head-judge-only, and `onboardPartner` installs the partner's structural namespace
and two managed sub-books. Partner wallets get only UNREGISTER there and issue
through `registerPartnerBadge(partnerHash, subBookHash, label, owner)`. Judge badges
expire at freezeDeadline; staff badges at eventEnd; structural names at
namespaceExpiry. `renewPartnerBadge` is organizer-only and cannot revive a removed
or replaced partner hierarchy. `BadgeIssued.book` hashes the full relative book
suffix, such as `staff.arkiv.partners`, so partner events retain their scope.

The organizer's trusted raw path must use the corresponding fixed resolver and
initialize its address record explicitly. `initializeBadgeAddress` and
`initializePartnerBadgeAddress` verify the current holder and resolver before
writing the address; badge holders receive no shared-resolver setter permission.

In A4, the organizer configures the actual WinnerRegistrar contract once through
`setWinnerRegistrar(address)`. Only that contract can call `promoteWinner` or
`renewWinningTeam`; both reject unknown or replaced team registrations. Promotion
uses the one-shot publication resolver, no subregistry, and no authorizing name
roles. ENSv2 adds its non-authorizing `ROLE_WAS_RESERVED` marker automatically.
Teams created before this handoff need no later role grant. Parent renewal can
revive the original expired registration without changing its lead or child.

Local contract and CLI verification does not constitute Sepolia deployment or A1
phase acceptance. A2's reader, permission-note and team-URL workflows, and the real
WinnerRegistrar in A4, remain separate work.
Winner availability continues to depend on ancestor authority and renewal: the
organizer retains registrar/renewal authority in the base registry, and the base
name remains subject to its parent registry and expiry.
