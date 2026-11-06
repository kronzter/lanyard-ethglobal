// The mumbai2026 edition (plans/P0-foundation.md › P0.2-R1).
//
// PLACEHOLDERS, flagged until confirmed:
//   - times: December 2026 dates (IST), until the organizer confirms the schedule
//   - authorities: mock wallets from the public `test … junk` mnemonic (HD indices 0, 1, 5, 6,
//     matching fixtures/personas.json); real wallets replace them before any live deploy
// Spike-measured values came from P0.6 with evidence in plans/TRACKER.md; none is guessed.
// All five gates are measured (2026-11-06): chain identities (S7, S10), funding (S6), the score
// cipher (S11, Node + browser; Hermes run deferred) and the shift-write profile (S12).
import { measured } from "./config/unmeasured";
import type { EventConfigInput } from "./config/schema";
import { validateEventConfig } from "./config/validate";

export const eventConfigInput = {
  schemaVersion: 1,
  edition: "mumbai2026",
  baseName: "lanyard.eth",
  partners: [
    { id: "arkiv", name: "Arkiv" },
    { id: "ens", name: "ENS" },
  ],
  tracks: [
    { id: "main", name: "Main", partner: null },
    { id: "arkiv", name: "Arkiv", partner: "arkiv" },
    { id: "ens", name: "ENS", partner: "ens" },
  ],
  times: {
    eventStart: 1796358600n, // 2026-12-04 10:00 IST (placeholder)
    submissionDeadline: 1796527800n, // 2026-12-06 09:00 IST
    judgingEnd: 1796542200n, // 2026-12-06 13:00 IST
    results: 1796545800n, // 2026-12-06 14:00 IST
    eventEnd: 1796560200n, // 2026-12-06 18:00 IST
    freezeDeadline: 1796567400n, // 2026-12-06 20:00 IST
  },
  authorities: {
    organizer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    results: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    partners: {
      arkiv: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
      ens: "0x976ea74026e726554db657fa54763abd0c3a0aa9",
    },
  },
  chains: {
    sepolia: {
      chainId: 11155111,
      // `latest − finalized` lag 71–83 blocks (6 samples over 2.5 min, 2026-11-06) and finality
      // advances in 32-block epochs; rounded up to the next epoch boundary.
      confirmations: measured(96, "P0.6-S7 2026-11-06: max finalized lag 83 blocks, rounded up to 3 × 32"),
      resetId: measured(
        "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9",
        "P0.6-S7 2026-11-06: Sepolia genesis block hash, read via the archive RPC",
      ),
    },
    rabdi: {
      chainId: 7794095,
      // `latest − finalized` lag 66–95 blocks (24 samples over 4 min, 2026-11-06; 65–93 earlier)
      // with `finalized` stepping exactly 32 blocks; rounded up to the next epoch boundary.
      confirmations: measured(96, "P0.6-S10 2026-11-06: max finalized lag 95 blocks, rounded up to 3 × 32"),
      resetId: measured(
        "0xa65a2b9e25129f0e8ccdf494dfd66ec744bdf400c806b832b1da86b0b939cbce",
        "P0.6-S10 2026-11-06: Rabdi genesis block hash, re-read and unchanged",
      ),
    },
  },
  venue: { cellSizeMm: 1000 },
  // Event score key from `pnpm lanyard score-keygen`; the secret lives only in the freeze
  // operator's .env (SCORE_DECRYPTION_KEY). Envelope v1 in src/shared/crypto/score-cipher.ts.
  scoreCipher: measured(
    {
      suite: "x25519-hkdf-sha256-aes-256-gcm",
      keyId: "x25519:1ae432e7452008b0",
      publicKey: "0x68a0e5f9d81351cda9c0ccb4f0ac3c60c9c12bfe089c4967eaee77458cd1860b",
      implementation:
        "@noble/curves@1.9.1 x25519 + @noble/hashes@2.4.0 hkdf-sha256 + @noble/ciphers@1.3.0 aes-256-gcm; envelope v1",
    },
    "P0.6-S11 2026-11-06: pinned vectors match on Node, headless Chromium and OpenSSL; Hermes run deferred",
  ),
  // External wallets cannot prove exclusive signer custody, so replacement shifts are confirmed
  // first and their clock-in + duty pass batched second (two approvals, visible pending gap).
  shiftWriteProfile: measured(
    "confirmed-sequential",
    "P0.6-S12 2026-11-06: chosen by the user; Node rehearsal confirm → journal → crash → resume passed",
  ),
  // Rabdi refuses contract creation ("contract creation is disabled (no-EVM Arkiv executor)"), so
  // no Faucet contract: a desk wallet sends tGLM and writes a readonly `drip` record (B1.1-R7–R9).
  fundingProfile: measured("desk-wallet", "P0.6-S6 2026-11-06: Rabdi has no EVM; native tGLM transfer works"),
  // 0.5 tGLM per new wallet: about 3,000 writes at the measured ~0.00016 tGLM per create.
  funding: { dripWei: 500_000_000_000_000_000n },
  evidenceSchemaVersion: 1,
} satisfies EventConfigInput;

/** Validated at import: a broken config fails fast everywhere it is used. */
export const eventConfig = validateEventConfig(eventConfigInput);
