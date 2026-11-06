# Git workflow

Two people build side by side. Each phase has a branch and suggested review/commit boundaries. **Agents commit only when the user asks, never run `git push`, and never read/print/edit `.env` or other secret files.** `.env.example` documents required variable names; the human configures secrets. Merges also require the user's requested integration scope.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Always builds and passes `pnpm ci:local`. Receives merges only |
| `phase/<ID>-<slug>` | One phase, e.g. `phase/A1-namespace`, `phase/B3-volunteers-tickets` |
| `int/<ID>-<slug>` | One integration checkpoint, e.g. `int/I2-real-ens-history` |
| `fix/<slug>` | A High found at an integration in code that's already merged. The track owner makes it off `main` |

No direct commits to `main`.

## Commits

**When commits are requested, one per spec.** Include its verified `TRACKER.md` status row. Otherwise leave the working diff reviewable and report the checks.

```
<type>(<scope>): <spec ID> <what it does>

feat(ens): A1.2 badge books and LanyardRegistrar
feat(app): P0.5 expo app shell with appkit and flags
feat(rules): B3.1 on-duty rules, shifts and clocks
```

- Conventional Commit style: `feat`, `fix`, `test`, `refactor`, `build`, `ci`, `chore`, `docs`. Pick the scope by what the spec mostly touches. This isn't enforced by a hook.
- **Bug-hunt fixes:** one commit per finding, with the regression test in the same commit: `fix(contracts): A1 reject team label with trailing hyphen`.
- **Interface additions** are a separate reviewable change in `packages/shared` plus mocks and tracker. Commit only when requested. Coordinated breaking repairs also update consumers/conformance together.
- **Tracker-only updates** (e.g. logging bug-hunt findings): `docs(tracker): A1 bug hunt findings`.
- Every commit on a phase branch builds.
- Never commit `.env`, private keys or mnemonics. The `pre-commit` secret-scan hook (P0.1) rejects them.
- Plan files are a reviewed baseline. User-authorized corrections may update them together; record the correction separately from implementation progress.

## Finishing a phase

```bash
# Only after the user requests this integration; never run a push command.
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

Integration branches wire shared interfaces, fixtures, shell/providers/config, deployments, e2e and documentation. Owner packages may receive the specific CLI/provider wiring named by an integration, with that owner's review; this includes I4's CLI results flag. Additive phase fixtures and necessary dependency/config/Known limitations changes are allowed as described in `00-README.md`. Suggested commit boundaries never override the user's commit rule.

If an integration finds a track bug, its owner prepares a narrow fix and regression check on `fix/<slug>`. Commit/merge only when requested, then update the integration's base. For documentation-only repairs, verify links, requirement/interface consistency and audit coverage rather than inventing application tests.

## APK builds

Always local:

```bash
eas build --platform android --profile development --local   # dev client
eas build --platform android --profile preview --local       # installable APK for demos
```

Never run `eas build` without `--local`.

## Never

- Force-push `main`.
- Merge a phase that has an open High.
- Commit to another person's paths on your phase branch.
- Commit messages like "wip", "fix stuff", "final", "final2".
