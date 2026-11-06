// The mumbai2026 edition (plans/P0-foundation.md › P0.2-R1).
//
// PLACEHOLDERS, flagged until confirmed:
//   - times: December 2026 dates (IST), until the organizer confirms the schedule
//   - authorities: mock wallets from the public `test … junk` mnemonic (HD indices 0, 1, 5, 6,
//     matching fixtures/personas.json); real wallets replace them before any live deploy
// Spike-measured values stay `unmeasured` until P0.6 records evidence in plans/TRACKER.md.
import { unmeasured } from "./config/unmeasured";
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
    sepolia: { chainId: 11155111, confirmations: unmeasured("P0.6-S7"), resetId: unmeasured("P0.6-S7") },
    rabdi: { chainId: 7794095, confirmations: unmeasured("P0.6-S10"), resetId: unmeasured("P0.6-S10") },
  },
  venue: { cellSizeMm: 1000 },
  scoreCipher: unmeasured("P0.6-S11"),
  shiftWriteProfile: unmeasured("P0.6-S12"),
  fundingProfile: unmeasured("P0.6-S6"),
  evidenceSchemaVersion: 1,
} satisfies EventConfigInput;

/** Validated at import: a broken config fails fast everywhere it is used. */
export const eventConfig = validateEventConfig(eventConfigInput);
