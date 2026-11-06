# contracts

One Foundry project for every Lanyard contract. No git submodules: dependencies are
pinned in `foundry.toml` + `soldeer.lock` and downloaded by Soldeer into `dependencies/`
(git-ignored).

```bash
forge soldeer install   # fetch pinned dependencies (CI does this too)
forge fmt --check
forge test
```

| Folder | Owner | Chain | Lands in |
| --- | --- | --- | --- |
| `src/faucet/`, `test/faucet/`, `script/faucet/` | Track B (`@arnavmahajan630`) | Rabdi | B1.1 `Faucet` (only if P0.6-S6 proves contracts deploy on Rabdi; otherwise the desk-wallet `drip` fallback, and no contract) |
| `src/ens/`, `test/ens/`, `script/ens/` | Track A (`@kronzter`) | Sepolia | A1+ `LanyardRegistrar`, `WinnerRegistrar` |

## Pinned dependencies

| Dependency | Version | How |
| --- | --- | --- |
| `forge-std` | 1.17.0 | Soldeer registry; checksum in `soldeer.lock` |
| ENSv2 (`ensdomains/contracts-v2`) | not yet added | A1 adds it as a Soldeer **git** dependency pinned by commit. Candidate: tag `sepolia-deployment-2026-09-15` = `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`. A1/A2 must verify ABI and on-chain implementation compatibility before relying on it |

No upgrades during the build. Remappings live in `remappings.txt` and are edited by hand
(`remappings_regenerate = false`).

## Chains

- **Sepolia** supports `cancun`, the default `evm_version`.
- **Rabdi** (chain `7794095`): EVM version and contract deployability are unmeasured until
  P0.6-S6. If Rabdi needs a different target, add a `[profile.rabdi]`.
