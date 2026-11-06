# deployments

Contract addresses per chain. Nothing is hard-coded elsewhere.

| File           | Writer  | Reader  |
| -------------- | ------- | ------- |
| `sepolia.json` | Track A | Track B |
| `rabdi.json`   | Track B | Track A |

The zod schema lives in `src/shared/deployments/` (P0.2). Files are explicitly `mode: "mock"` until a real deploy writes `mode: "live"`.

`rabdi.json` is live since B1.1: Rabdi has no EVM (P0.6-S6), so nothing is deployed there; it records
the chain's reset identity and the dedicated desk wallet that sends first-time tGLM and writes
readonly `drip` records. `deployedAtBlock` is the block that funded the desk wallet.

`sepolia.json` is live since A1 (deployed 2026-11-06): Lanyard's registrar, `lanyard.eth`'s base
registry, the `mumbai2026` edition registry and the three fixed resolvers, plus the ENSv2
infrastructure they use (tag `sepolia-deployment-2026-09-15`). `deployedAtBlock` is the block of the
first contract (the hackers resolver).
