# deployments

Contract addresses per chain. Nothing is hard-coded elsewhere.

| File | Writer | Reader |
| --- | --- | --- |
| `sepolia.json` | Track A | Track B |
| `rabdi.json` | Track B | Track A |

The zod schema lives in `src/shared/deployments/` (P0.2). Files are explicitly `mode: "mock"` until a real deploy writes `mode: "live"`.
