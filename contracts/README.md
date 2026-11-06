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
| ENSv2 (`ensdomains/contracts-v2`) | tag `sepolia-deployment-2026-09-15` = `f2f0a05` | Soldeer **git** dependency pinned by commit (`ens-contracts-v2`); its sources sit under `contracts/src`, imported as `ens-v2/…` |
| `openzeppelin-contracts` | 5.3.0 (`e4f7021`) | Soldeer git, the commit ENSv2 pins |
| `openzeppelin-contracts-upgradeable` | 5.2.0 (`5fc3fee`) | Soldeer git, the commit ENSv2 pins |
| `verifiable-factory` | `5ef7b1a` | Soldeer git, the commit ENSv2 pins |
| `ens-contracts-v1` (`ensdomains/ens-contracts`) | `121dc23` | Soldeer git, the commit ENSv2 pins (only `NameCoder` is compiled) |

ENSv2 pulls its own libraries in as git submodules, which Soldeer does not fetch
(`recursive_deps = false`), so each library ENSv2 imports is pinned here at the commit
ENSv2 itself pins (read from its `contracts/lib` tree at `f2f0a05`) and wired with a
hand-written remapping.

**Compiler.** ENSv2 declares an exact `pragma solidity 0.8.25`. Anything importing it
(`src/ens`, `test/ens`) therefore also declares `0.8.25`; Track B files keep `0.8.28`.
Foundry auto-detects the right solc per file. Settings match ENSv2 (optimizer 200 runs, no
via_ir, cancun).

No upgrades during the build. Remappings live in `remappings.txt` and are edited by hand
(`remappings_regenerate = false`).

## Chains

- **Sepolia** supports `cancun`, the default `evm_version`.
- **Rabdi** (chain `7794095`): EVM version and contract deployability are unmeasured until
  P0.6-S6. If Rabdi needs a different target, add a `[profile.rabdi]`.

## LanyardRegistrar notes (A1)

- **Predeployment issuance setup.** The immutable registrar requires
  `configureIssuance(hackersResolver, staffResolver, headJudge, baseName)` once, before bootstrap.
  Resolvers are distinct permissioned resolvers with registrar coin-type-60 address authority.
  The judges book installs the head judge's UNREGISTER permission at initialization; there is
  no late book-root admin grant. Fixed issue entrypoints initialize resolver and holder address
  atomically, including delegated global-judge and partner judge/staff badges.
- **Bounded setup companion.** The registrar constructor creates `LanyardRegistrySetup` to keep
  runtime bytecode below EIP-170. Only the registrar can invoke its registry-creation methods.
  Its temporary permissions are removed before returning; the registrar remains the stable final
  register/renew or reserved-winner authority. Neither contract has a general call or upgrade path.

- **Revival.** `renew(book, label, newExpiry)` extends a badge or revives an expired one with its
  previous owner (A2.3). The new expiry must be in the future, later than the current one and at
  most `namespaceExpiry`, deliberately the tree's lifetime and not the issue policy. A label that
  was unregistered or is only reserved has no owner and reverts. Issuing still uses the fixed
  per-book policy expiry.
- **Badge owners must be able to receive ERC-1155.** The registry mints with an acceptance check,
  so `registerBadge` reverts for a contract owner without `onERC1155Received`. Use an EOA or a
  contract that implements the receiver.
- **Raw organizer roles.** The organizer holds REGISTRAR, UNREGISTER, RENEW and SET_RESOLVER on
  each book root, so direct issuance and removal bypass the registrar's policy (issuer trust).
- **Edition name receiver.** The registrar accepts ERC-1155 tokens only as mints from the base
  registry; a holder cannot push a base name into it.
