# A4 · Winner names and ENS consoles

**Track:** A · **Branch:** `phase/A4-winners-consoles` · **Depends on:** A1–A3 · **Integration:** I4

## Goal

Whenever a winner is declared, the team gets a permanent name:

```
winner.<team>.<edition>.<base>
e.g. winner.zkpay.mumbai2026.lanyard.eth
```

After publication lock, nobody can change its records on the fixed publication resolver, including organizer and team. Resolution/availability still depends on ancestor registry authority and base-name renewal; this is not a promise against a parent owner redirecting the namespace. This phase also ships staff-signed web ENS consoles.

## Out of scope

Computing who won, and the prize rules (B4 and `00-CONTEXT.md` §14: TBD). The Arkiv results record (B4). This phase ships the contract and a real `ResultsPublisher` that B4's freeze CLI calls.

Follow [the publication/recovery contract](01-evidence-and-interfaces.md). One publication resolver serves edition and winner records; its sole writer is `WinnerRegistrar`. The results wallet calls that contract and has no direct resolver authority.

---

### A4.1 · `WinnerRegistrar`

**Requirements**
- **A4.1-R1** WHEN `declare(WinnerInput)` is called by the configured results wallet before lock, THE contract SHALL atomically:
  1. verify it matches the stored event publication, then call `LanyardRegistrar.promoteWinner` for the registered team's owner, fixed publication resolver, roles = none and far-future expiry;
  2. call `LanyardRegistrar.renewWinningTeam` for parent renewal; the stable registrar already holds the required edition/child roles from A1;
  3. write `lanyard.prizes` (canonical JSON string array), `lanyard.results`, `lanyard.results-hash`, `lanyard.bundle-hash`, and `lanyard.edition` on the publication resolver, and persist the exact declaration payload hash for reconciliation.
- **A4.1-R2** WHEN `declare` is called twice for the same team, or by any other account, THE `WinnerRegistrar` SHALL revert.
- **A4.1-R3** WHEN anyone other than `WinnerRegistrar` tries to register or promote `winner`, THE team subregistry SHALL revert.
- **A4.1-R4** WHEN a team wins several prizes, THE system SHALL issue one name with every prize listed.
- **A4.1-R5** At deployment, THE organizer SHALL call A1's one-shot `setWinnerRegistrar` and transfer the publication resolver's complete setter/link/upgrade grant/admin inventory to the contract, removing all other holders. Older teams work through the stable registrar with no backfill. Any remaining unexpected root/scoped setter/admin holder blocks handoff.
- **A4.1-R6** THE contract SHALL treat prize strings as opaque input (≤ 128 bytes each). Which teams win, and what the prizes are called, is decided outside it.
- **A4.1-R7** THE contract SHALL allow at most 16 prizes/team and 2,048 UTF-8 bytes of encoded prize list, rejecting empty/duplicate strings. The frozen manual prize input is included in the bundle; prize selection is not derived from rankings until prize rules are specified.

**Commit:** `feat(contracts): A4.1 WinnerRegistrar declaring permanent winner names`

---

### A4.2 · Results lock and `SepoliaResultsPublisher`

**Requirements**
- **A4.2-R1** `setEventResults(PublicationInput)` SHALL use the results-wallet-only contract entrypoint, store the full commitment, and write results key/hash, bundle hash, bundle URI (`lanyard.bundle-uri`) and edition on the edition name through the publication resolver. It is set once; conflicting/repeated direct calls fail. A resumed CLI adopts matching state without calling again. Bound URI bytes to 2,048 and reject unsupported URI schemes before writing.
- **A4.2-R2** `lockResults(expected)` SHALL atomically compare complete event/winner state, require a sealed grant inventory, revoke the contract's text/link/upgrade roles and all their admins (including scoped text grants), then set persistent `locked`. Partial failure reverts everything. Event-pointer writes, winner writes, declarations and publication SHALL all fail after lock, even from a new client instance.
- **A4.2-R3** THE `SepoliaResultsPublisher` SHALL implement `ResultsPublisher` and pass `runResultsPublisherConformance` on a Sepolia fork.
- **A4.2-R4** THE `SepoliaResultsPublisher` SHALL be used only by the local freeze CLI, with the results key from that machine's `.env`. It SHALL never be imported by `apps/app`.
- **A4.2-R5** THE publisher SHALL implement shared `state`, confirmed receipts and `reconcile`. Save exact signed transaction/hash/nonce before local broadcast. Compare complete commitment/payload hashes; missing receipts never authorize resending. Simulate role removal and gas limits on a fork before irreversible handoff.

**Commit:** `feat(ens): A4.2 results lock and SepoliaResultsPublisher`

---

### A4.3 · ENS consoles

**Screens.** All of these are web-only, under `/admin/ens/*`, except `<WinnerBadge>`. Every transaction is signed by the connected staff wallet through AppKit; no key lives in the app.
- **Onboarding desk** (organizer): scan the holder's address QR (camera) or paste it, pick a book, and send `registerBadge`; register teams to the lead's address, then set/read back their canonical Lanyard page `url` through A2's writer. Show separate registration and URL-linking status; if linking fails, resume it without registering the team again. Offer copy/open page actions. (Dripping tGLM is B's `/organizer/faucet` screen, linked from the desk.)
- **Coordinator:** make or unmake a lead (writes `lanyard.perms`, A2.2).
- **Partner console:** issue and revoke that partner's judges and staff (A2.2, A2.3).
- **Permission map:** every grant, read live from `EACRolesChanged` events.
- **Winner badge:** `<WinnerBadge label>`, on the team screen and hacker profile, read through the Universal Resolver. Works on Android and web. Exported for B's team screen.

**Requirements**
- **A4.3-R1** WHEN a console action succeeds, THE screen SHALL show the transaction hash and the Sepolia block.
- **A4.3-R2** WHEN the connected wallet lacks the role, THE screen SHALL say so before sending, by reading roles on-chain.
- **A4.3-R3** THE permission map SHALL match `roleCount`/`hasRoles` reads for every listed resource.
- **A4.3-R4** WHEN the connected wallet is on the wrong chain, THE console SHALL ask the wallet to switch to Sepolia before sending.
- **A4.3-R5** Team onboarding SHALL not report the website link ready until the expected `url` is confirmed and read back. Reconcile uncertain URL writes before resending. The ETHGlobal URL and project buttons are edited by the team through B4's Arkiv-backed form; the organizer publishes the deterministic Lanyard page address, not arbitrary team content.

**Commit:** `feat(app): A4.3 onboarding desk, coordinator, partner and permission consoles`

---

## Phase bug hunt

- [ ] A team lead calls `register('winner', …)` in their own subregistry before freeze: reverts
- [ ] A team lead tries to unregister the reservation: reverts
- [ ] A random account calls `declare`: reverts
- [ ] `declare` twice for one team: reverts
- [ ] After lock, organizer/results/contract paths cannot alter winner text or the edition results pointer, relink records or upgrade the publication resolver
- [ ] Let a test team's name expire without the renew step: `winner.<team>…` stops resolving; with the real flow it keeps resolving
- [ ] The winner name can't be transferred and has no set-resolver role
- [ ] A team predating `WinnerRegistrar` works through stable forwarders without backfill or surviving registry admins
- [ ] Mixed-case or look-alike team labels are normalized before `declare`
- [ ] Search the web export and the APK for the results key and the organizer key: absent; `apps/app` doesn't import `SepoliaResultsPublisher`
- [ ] Coordinator console with a non-coordinator wallet connected: blocked before sending
- [ ] Desk with a wallet on Rabdi instead of Sepolia: asks to switch, sends nothing on the wrong chain
- [ ] Permission map vs direct `hasRoles` reads: identical
- [ ] Missing setter/admin grants, unexpected scoped grants or missing parent renewal authority block deployment handoff
- [ ] Crash after successful broadcast but before journal confirmation: a new CLI adopts matching state/receipt without another write
- [ ] Wrong event/bundle/results hash, duplicate publication, partial lock failure and comma-containing prize strings are tested
- [ ] Team registration succeeds but URL linking fails: show partial completion, recover only the URL step, and open the correct public page without a viewer wallet

## Phase done when

- [ ] A4.1–A4.3 marked done in `TRACKER.md`
- [ ] `SepoliaResultsPublisher` passes conformance
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] README/demo distinguish locked publication bytes from namespace availability: base-name renewal and surviving ancestor authority remain trusted. On a fork, demonstrate any ancestor redirection still permitted by actual grants rather than claiming it is impossible
- [ ] Merged into `main`
