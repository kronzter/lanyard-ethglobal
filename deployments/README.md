# deployments

Contract addresses per chain. Nothing is hard-coded elsewhere.

| File           | Writer  | Reader  |
| -------------- | ------- | ------- |
| `sepolia.json` | Track A | Track B |
| `rabdi.json`   | Track B | Track A |

The zod schema lives in `src/shared/deployments/` (P0.2). Files are explicitly `mode: "mock"` until a real deploy writes `mode: "live"`.

`rabdi.json` is live since B1.1: Rabdi has no EVM (P0.6-S6), so nothing is deployed there; it records
the chain's reset identity and the dedicated desk wallet that sends first-time tGLM and writes
readonly `drip` records. `deployedAtBlock` is the block that funded the desk wallet. `sepolia.json`
stays a mock until A1 deploys.
