# Git workflow

Two people build side by side. Each phase has a branch and suggested review/commit boundaries. **Agents commit only when the user asks, may push non-`main` branches and open PRs, never push `main` or force-push, and never read/print/edit `.env` or other secret files.** `.env.example` documents required variable names; the human configures secrets. Merges also require the user's requested integration scope.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Always builds and passes `pnpm ci:local`. Receives merges only |
| `phase/<ID>-<slug>` | One phase, e.g. `phase/A1-namespace`, `phase/B3-volunteers-tickets` |
| `<id>/<spec>-<slug>` | Optional per-spec branch with a stacked PR into its phase branch, e.g. `p0/P0.2-shared-types` → `phase/P0-foundation`. The next spec branches from the previous one; GitHub retargets when the base merges |
| `int/<ID>-<slug>` | One integration checkpoint, e.g. `int/I2-real-ens-history` |
| `fix/<slug>` | A High found at an integration in code that's already merged. The track owner makes it off `main` |

No direct commits to `main`.

## Commits

**When commits are requested, several small commits per spec**, each one logical change that builds on its own and names its spec only in a `Refs:` footer. The spec's final commit is a `docs(tracker)` commit that flips its `TRACKER.md` row, made only after `pnpm ci:local` passes. Otherwise leave the working diff reviewable and report the checks.

```
<type>(<scope>): <what the change does>

<what changed and why, in terms of the code's behaviour>

Refs: <spec ID>
```

```
feat(arkiv): sign record writes through a viem wallet client
fix(rules): reject clock-ins that start after the shift ends
build(contracts): pin forge-std through soldeer instead of submodules
```

- Titles and bodies describe the change itself: what the code now does and why. Don't narrate the plan, phase progress or spec bookkeeping there. The spec ID goes only in the `Refs:` footer, which keeps each commit traceable from `TRACKER.md`. (Commits before this rule keep the older `<type>(<scope>): <spec ID> …` titles.)
- Conventional Commit style: `feat`, `fix`, `test`, `refactor`, `build`, `ci`, `chore`, `docs`. Pick the scope by what the change mostly touches. This isn't enforced by a hook.
- PR titles and descriptions follow the same rule: say what changes, how it was verified and anything a reviewer must decide.
- No AI attribution: no `Co-Authored-By` assistant trailers in commits and no "generated with" lines in PRs.
- **Bug-hunt fixes:** one commit per finding, with the regression test in the same commit: `fix(contracts): reject team labels with a trailing hyphen` and `Refs: A1 bug hunt #3`.
- **Interface additions** are a separate reviewable change in `src/shared` plus mocks and tracker. Commit only when requested. Coordinated breaking repairs also update consumers/conformance together.
- **Tracker-only updates** (e.g. logging bug-hunt findings): `docs(tracker): log namespace bug-hunt findings`.
- Every commit on a phase branch builds.
- Never commit `.env`, private keys or mnemonics. The `pre-commit` secret-scan hook (P0.1) rejects them.
- Plan files are a reviewed baseline. User-authorized corrections may update them together; record the correction separately from implementation progress.

## Finishing a phase

```bash
# Only after the user requests this integration; never push main.
# Bug hunt done, Highs fixed, findings + status recorded in plans/TRACKER.md.
git fetch origin
git merge origin/main      # paths are disjoint, so this is clean (re-run pnpm i if the lockfile conflicts)
pnpm ci:local              # lint, typecheck, unit tests, forge test, web export
git switch main && git pull
git merge phase/A1-namespace
# The user publishes manually. Keep the phase branch unless asked to remove it.
```

## Integration branches

```bash
git switch -c int/I2-real-ens-history origin/main   # both phases already merged
```

Integration branches wire shared interfaces, fixtures, shell/providers/config, deployments, e2e and documentation. Owner folders may receive the specific CLI/provider wiring named by an integration, with that owner's review; this includes I4's CLI results flag. Additive phase fixtures and necessary dependency/config/Known limitations changes are allowed as described in `00-README.md`. Suggested commit boundaries never override the user's commit rule.

If an integration finds a track bug, its owner prepares a narrow fix and regression check on `fix/<slug>`. Commit/merge only when requested, then update the integration's base. For documentation-only repairs, verify links, requirement/interface consistency and audit coverage rather than inventing application tests.

## APK builds

On EAS cloud by default:

```bash
eas build --platform android --profile development   # dev client  (pnpm app:dev-apk)
eas build --platform android --profile preview       # installable APK for demos  (pnpm app:apk)
```

Add `--local` on a Linux/macOS/WSL host (`pnpm app:dev-apk:local`, `pnpm app:apk:local`). Cloud builds receive only public `EXPO_PUBLIC_*` values; never add a signing, operator or decryption key as an EAS secret or env var. The upload follows `.gitignore`, so `.env` never leaves the machine.

## Never

- Force-push `main`.
- Merge a phase that has an open High.
- Commit to another person's paths on your phase branch.
- Commit messages like "wip", "fix stuff", "final", "final2", "phase completed".
- Git submodules or workspace packages (one repo, one dApp; Foundry deps come from Soldeer).
