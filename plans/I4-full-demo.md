# I4 · Full demo and final cross bug hunt

**Joint integration** · **Branch:** `int/I4-full-demo` · **Starts when:** A4 and B4 are merged and I1–I3 are complete · **Driver:** both

## Goal

The event runs on real Sepolia/Rabdi with no interface mocks: local capture/freeze publishes a retained signed bundle, winner names appear, and a second machine verifies scoped `MATCH`. It runs on two Android phones plus web consoles. Follow `01-evidence-and-interfaces.md`; operator-attested input completeness and ancestor-name/issuer trust limits are visible demo claims.

## What gets swapped

| Before | After |
| --- | --- |
| `LANYARD_RESULTS=mock` (freeze CLI env) | `LANYARD_RESULTS=sepolia` (`SepoliaResultsPublisher`, results key from the local `.env`) |
| `providers.winnerBadge` no-op | A4.3 `<WinnerBadge>` |
| Seeds per track | One `seed-demo.ts` run on a clean edition |

## Steps (one commit each)

1. `chore(deploy): I4 fresh demo edition with verified publication grants, locked setup pointers and selected funding profile`
2. `chore(fixtures): I4 run full demo seed on sepolia and rabdi`
3. `feat(cli): I4 default results flag to sepolia`
4. `feat(app): I4 wire WinnerBadge into providers`
5. `test(e2e): I4 full demo script from badge to verify match`
6. `docs: I4 add evidence scope, issuer/ancestor trust, service profile and demo script to readme`

Build the demo APK with `eas build --platform android --profile preview --local` and install it on both phones.

Before running the final demo, assert effective app ENS = `sepolia`, router = `grid`, CLI ENS/results = `sepolia`, live deployment validation passes, and the selected funding/infrastructure/shift-write profiles match P0. Check actual structural ancestor expiries cover `namespaceExpiry` and judge badges cover the supported freeze window. A4/B4 can finish against mocks while earlier integrations lag, but I4 cannot sign off with any mock/stub provider.

## Demo script (also the e2e test)

1. Start the local evidence capture runner. At the desk, issue badges and fund wallets using the selected profile. Team `zkpay` is registered to its lead; `winner.zkpay…` is reserved. Field wallets discover/select their owned roles without relying on seeded fixture addresses.
2. The coordinator makes Priya a lead. Priya clocks Ravi in from her phone (one approval); his duty-pass countdown shows.
3. Person B raises a ticket from their seat; Ravi claims it, walks the path, resolves it, and gets the next ticket.
4. The coordinator removes Priya's lead note; her next clock-in shows greyed out, with a reason.
5. Lead submits immutable content before deadline; a late submission is excluded. Editing the project draft afterward cannot change the submitted contents/track.
6. An assigned partner judge walks located stops, scores, and seals. Revoke one judge before cutoff: completion/eligibility UI updates, without exposing scores or rankings.
7. Wait for an allowed confirmed cutoff in `[results, freezeDeadline)` on both chains. Reconcile capture, freeze context/config/prizes, reject ineligible scores before decrypting, reject invalid eligible ciphertext per record, evaluate and retain/sign/download-check the bundle, then publish compact results → event commitment → winners → atomic lock. The now-public leaderboard excludes that revoked registration's scores.
8. `winner.zkpay.mumbai2026.lanyard.eth` resolves with its prizes, and the team screen shows the badge; `setText` on it reverts for everyone.
9. On a second laptop, `lanyard verify mumbai2026 --bundle <path>` authenticates locked publication plus historical ENS and prints `MATCH — operator-attested captured inputs; completeness not proven`. A local-only offline reproduction is labeled separately.

## Final cross bug hunt: attack every pitch claim

- [ ] "Organizer can't backdate": the organizer edits a team's project or submission → fails
- [ ] Revoked volunteers cannot act afterward; a judge unregistered before cutoff loses that registration's captured scores, while post-cutoff changes cannot rewrite results
- [ ] "Hidden until freeze": read every `final_score` on Rabdi before freeze → ciphertext
- [ ] "Anyone can reproduce the published captured set": a fresh machine with the committed bundle reproduces; tampered bytes/signature/config fail; the CLI explicitly says completeness is unproven
- [ ] "Published winner records are locked": organizer/results paths cannot change the fixed resolver's text or transfer the winner token; ancestor redirection/base renewal are explicitly separate trusted limits
- [ ] "No admin table": every permission shown in the permission map comes from chain reads
- [ ] "No server signer": all actor writes use wallets; capture/freeze run locally. Inventory P0's actual allowed hosts: RPCs, wallet relay/login endpoints, static bundle hosting and optional read-only proxy. No service holds actor signing keys. The only credentials in app bundles are the read-only, app-restricted RPC keys, listed as public; no operator, signing or decryption key appears in a bundle or wallet chain URL
- [ ] Freeze run again: refuses
- [ ] Two phones, one ticket, the same second: one winner
- [ ] Bundle scan of the APK and the web export: no organizer key, results key or decryption key
- [ ] Cold start: a fresh phone installs the local APK, connects a fresh MetaMask, gets dripped at the desk, and raises a ticket
- [ ] Cold start on a fresh browser: the web consoles load from `deployments/*.json`, with nothing hard-coded
- [ ] A captured deleted first candidate remains in the bundle; an unseen prior deletion cannot be detected and is never advertised as impossible
- [ ] Delete/expire live Arkiv dependencies/results in a controlled test: retained bundle plus locked ENS commitment still verify; unavailable bundle/ENS evidence fails closed
- [ ] Crash after a successful publication before journal update: resume adopts state/receipt, without repeating transactions; event pointer and winner text both remain immutable after lock
- [ ] Pre-freeze screens show completion/eligibility only; exact canonical/rational output hashes match on both phones/laptops
- [ ] Demo badge bitmaps are nontransferable; raw issuer registration authority and base-name renewal remain explicitly disclosed limits
- [ ] Early freeze refuses before key export/upload or writes; a signed out-of-window bundle cannot verify as `MATCH`
- [ ] A reissued lead badge cannot reuse old permission text; coordinator regrant explicitly binds the new registration/holder
- [ ] Garbage ciphertext from an unauthorized wallet cannot block freeze; valid results still reproduce with rejected records visible
- [ ] Judge drafts restore after app/browser restart on the same device; another device shows the explicit re-entry limitation
- [ ] On a controlled fork, freeze after event end but before `freezeDeadline`: partner judges remain eligible through their structural ancestors; current time after the deadline does not invalidate saved-window verification

Findings go in `TRACKER.md › I4`.

## Done when

- [ ] One full live demo passes, followed by an independent second-machine verification and completed-job resume/refusal check on the same locked edition. Replaying issuance/freeze requires a distinct configured test edition or a reset local fork, never resetting an existing public edition
- [ ] Every High fixed; every open Medium in `README.md › Known limitations`
- [ ] `arkiv/friction.md` and `README.md` complete
- [ ] I4 marked done in `TRACKER.md`; merged into `main`
