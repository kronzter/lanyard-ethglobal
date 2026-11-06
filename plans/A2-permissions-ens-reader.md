# A2 · Permissions and the real `EnsReader`

**Track:** A · **Branch:** `phase/A2-permissions-ens-reader` · **Depends on:** A1 · **Integration:** I2

## Goal

Hand out narrow, checkable permissions with ENS Enhanced Access Control, so Lanyard never needs its own admin table. Then ship the real `EnsReader`, which lets Track B ask "who held this badge, with what note, at that block?". It runs both in the app (Hermes and browser) and in the CLI (Node).

Implement [the identity and publication contracts](01-evidence-and-interfaces.md). Registry ownership authorizes roles; forward-resolved address records only supply display addresses.

## Who holds what

| Account | Where | Permission |
| --- | --- | --- |
| Organizer | Every managed book's root | Register, unregister, renew, set resolver |
| Head judge | `judges` book root | Register and unregister judges only |
| Each partner | Its own sub-books `judges.<partner>.partners…` and `staff.<partner>.partners…` | Register and unregister in those two sub-books only |
| Volunteer coordinator | Staff resolver | `setText` on key `lanyard.perms` only |
| Results key | `WinnerRegistrar` (A4) | Authorized publication caller; no direct resolver setter/admin grants |
| `WinnerRegistrar` | Publication resolver (edition + winners) | Sole text writer and setter/link/upgrade admin until atomic lock; assigned at A4 deployment |

Partners come from `event.config.ts` (`arkiv`, `ens` for now). A third partner is just one more run of the onboarding script.

## Out of scope

The consoles that call these grants (A4.3). Any rule about what a note *means* (Track B).

---

### A2.1 · Resolvers

**Requirements**
- **A2.1-R1** THE deploy script SHALL create three Permissioned Resolvers: **staff**, **hackers**, and dedicated **publication** (edition + winner names). The publication resolver is sealed to the A4 contract before live freeze, not split into separately lockable event/results resolvers.
- **A2.1-R2** THE staff resolver SHALL serve only staff names (judges, volunteers, partner names and both partner sub-books), because a key-scoped role reaches every name on a resolver.
- **A2.1-R3** WHEN a badge is issued through the registrar, THE transaction SHALL set the book's fixed resolver and explicitly set its address record to the holder via authorized resolver setters (hackers → hackers; staff books/sub-books → staff). Badge registrar address-write grants are separate from coordinator text grants. Direct issuer paths must initialize address records too. Neither setting a resolver nor owning a token automatically creates an address record.
- **A2.1-R4** THE team registration SHALL point each team name at the hackers resolver by default; the team lead can repoint it (A1.3 gave them `ROLE_SET_RESOLVER`).
- **A2.1-R5** THE edition and winners SHALL use the same publication resolver. A1's one-shot edition setup path sets this pointer then removes its setter/admin; `LanyardRegistrar` stores the same fixed address for winner promotions. Deployment records include a complete resolver grant/resource inventory for the A4 handoff.
- **A2.1-R6** THE organizer SHALL receive the `url`-scoped text setter on the hackers resolver and publish each team's deterministic Lanyard page URL from P0's shared helper/deployment origin. `set-team-url.ts` SHALL validate the registered team and expected resolver, write `url`, and verify it through the Universal Resolver. Apply it to existing A1 teams and every later team onboarding. Team leads receive no shared-resolver text grant. Report a changed resolver or mismatching URL for explicit repair; no arbitrary redirect is inferred from the ENS name.

**Commit:** `feat(ens): A2.1 staff, hackers and publication resolvers`

---

### A2.2 · Scoped grants

**Requirements**
- **A2.2-R1** WHEN the coordinator is appointed, THE organizer SHALL call `grantSetterRoles(encode(setText(0x,'lanyard.perms','')), coordinator)` on the staff resolver.
- **A2.2-R2** WHEN a volunteer is made a lead, THE coordinator SHALL read its current `registrationId` and owner, then set `lanyard.perms` to the shared canonical JSON envelope binding those values to `permissions: ["shift-manager"]`. Unmaking a lead writes an empty permissions list for the current binding. Re-read the binding after receipt; a concurrent reissue makes the note ineffective and requires a fresh grant, never permission inheritance. Legacy comma lists are invalid.
- **A2.2-R3** WHEN a partner is onboarded, THE organizer SHALL create `<partner>.partners`, and under it the `judges` and `staff` sub-books, and SHALL grant the partner `ROLE_REGISTRAR` and `ROLE_UNREGISTER` on those two sub-book roots only. These structural names and every ancestor SHALL cover `namespaceExpiry`; child judge badges expire at `freezeDeadline`, while staff badges expire at event end. Validate actual expiries on-chain, not only seed parameters.
- **A2.2-R4** THE head judge SHALL hold register and unregister on the `judges` book root only.
- **A2.2-R5** THE system SHALL never call `setApprovalForAll` on badge tokens.
- **A2.2-R6** THE plan SHALL disclose that raw `ROLE_REGISTRAR` holders (organizer/head judge/partners) can choose registration bitmaps, including transferable badges. App-issued badges use the fixed policy; issuer honesty is a trust assumption, not a registry-enforced universal guarantee. Verify demo issuance bitmaps directly in deployment checks. A stricter guarantee against issuers requires restricted issuance contracts in a separate design.

**Tasks**
- [ ] `grant-roles.ts`: coordinator, head judge, partners (loops over `event.config.ts` partners)
- [ ] `set-perms.ts` (make/unmake lead), used by seeds now and by the coordinator console in A4.3; compute the binding using P0's shared hash helper and direct pinned-registry reads, so this script does not depend on the later A2.4 reader
- [ ] Foundry and script tests: each grant works, and each forbidden neighbour reverts

**Commit:** `feat(ens): A2.2 scoped grants for coordinator, head judge and partners`

---

### A2.3 · Revoke and revive

**Requirements**
- **A2.3-R1** WHEN a badge must be revoked, THE holder of `ROLE_UNREGISTER` on that book or sub-book SHALL call `unregister(labelhash)`; the name stops resolving from that block on.
- **A2.3-R2** WHEN an expired badge must be restored with its previous owner and roles, THE organizer SHALL call the registrar's `renew` (the registrar holds `ROLE_RENEW` on the book root).
- **A2.3-R3** THE scripts SHALL print the Sepolia block of each revoke, revive and note change, and append it to `fixtures/sepolia-history.json` so I2 can replay it.
- **A2.3-R4** Badge reissue SHALL never inherit effective `lanyard.perms`: resolver text may survive, but its registration/holder binding must match the new badge before it authorizes an action. Renewal of the same registration preserves its binding. Test reissue to both the same and a different wallet, with historical old-note reads intact.

**Commit:** `feat(ens): A2.3 revoke and revive with recorded blocks`

---

### A2.4 · `SepoliaEnsReader`

**Requirements**
- **A2.4-R1** THE reader SHALL implement the shared `EnsReader`: traverse pinned registries at the requested block for `owner` and ancestor expiry, use Universal Resolver `getEnsAddress` for `address` only and `getEnsText` for notes, and inspect historical unregister/re-registration events for continuity. Every historical call/log range failure throws; do not conflate address and owner.
- **A2.4-R2** THE `SepoliaEnsReader` SHALL pass `runEnsReaderConformance` against a scenario replayed on a Sepolia fork.
- **A2.4-R3** WHEN `sepoliaBlockAt(t)` is called, THE reader SHALL binary-search block timestamps and return the latest block with timestamp ≤ t, caching the results.
- **A2.4-R4** THE disposable cache SHALL key by chain/reset identity, query/label/key and block hash, with bounded storage and reorg invalidation (AsyncStorage + memory in app, memory on Node).
- **A2.4-R5** WHEN the archive RPC fails, THE reader SHALL throw, never return `null` as if the name didn't exist.
- **A2.4-R6** THE reader SHALL take its RPC URL as a constructor argument (`EXPO_PUBLIC_SEPOLIA_RPC_URL` in the app, a local env var in the CLI) and SHALL import nothing Node-only.
- **A2.4-R7** THE `IdentityDirectory` SHALL discover all candidate connected-wallet roles through bounded registration-event queries and verify each with `owner` at the chosen block. Respect measured log-range limits; incomplete discovery is an error/status, never proof of no badge. Keep fixtures as a mock/seed source only.
- **A2.4-R8** THE reader SHALL implement `registrationId` exactly as the shared contract, using the historical holding registry's EAC resource and the pinned ABI. Verify resource/version behavior on unregister/reissue, renewal and ordinary role changes; token IDs are not registration IDs. Expose the same prepared binding to Node, app and coordinator tooling.

**Commit:** `feat(ens): A2.4 SepoliaEnsReader with block lookup and cache`

---

## Phase bug hunt

- [ ] The coordinator sets `avatar` or any key other than `lanyard.perms`: reverts
- [ ] The coordinator sets `lanyard.perms` on a name served by a different resolver: fails
- [ ] A partner registers in another partner's sub-book, or in `volunteers`: reverts
- [ ] A partner registers in its own `staff` and `judges` sub-books: works
- [ ] The head judge unregisters a volunteer: reverts
- [ ] After `unregister`, `owner` returns null later and the old owner earlier; a deliberately different address record grants no ownership
- [ ] After revival with `renew`, the owner and roles come back; a name-scoped renew grant fails on an expired name
- [ ] Unregister, then re-register the same label to someone else: the reader at the old block still returns the old owner
- [ ] Reissue a lead badge with stale `lanyard.perms`: the new registration gets no lead permission, even for the same wallet; a fresh bound grant restores it
- [ ] Renewal and ordinary role changes preserve the registration binding; malformed/legacy notes and holder mismatch grant nothing
- [ ] Partner parents/sub-books cover `namespaceExpiry`; a short-lived ancestor fails setup checks before any judging
- [ ] Two team names resolve distinct `url` records matching their canonical Lanyard pages; team A cannot alter team B's URL, and changing a resolver surfaces a mismatch
- [ ] Grant one role to a 16th account on one resource: the 15-holder limit bites; confirm the demo never needs more
- [ ] `sepoliaBlockAt` for a timestamp exactly equal to a block's, and for one between two blocks
- [ ] Kill the RPC mid-read: the error surfaces
- [ ] The reader returns identical results on Node and inside the Android app for 10 (label, block) pairs
- [ ] No demo badge holder has `setApprovalForAll` set for any account
- [ ] A raw authorized issuer can violate the app's transfer policy: disclose that boundary and verify every demo badge's actual bitmap
- [ ] Unknown/multi-role wallet discovery, bounded log errors, unregister/re-register continuity and ancestor expiry all match the shared mock contract

## Phase done when

- [ ] A2.1–A2.4 marked done in `TRACKER.md`
- [ ] `SepoliaEnsReader` passes conformance
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] Merged into `main`
