// Public, independently configured ENS authorities from the deployed registrar. Kept separate
// from event.config's fixture wallets so mock mode and deterministic vectors remain reproducible.
// Results and partner authority placeholders still require deployment configuration before live judging.
// Read back on Sepolia at I2 (2026-11-07); the I2 fork test checks these against the contract.
import { validateEventConfig } from "./config/validate";
import { eventConfigInput } from "./event.config";

export const sepoliaEventConfig = validateEventConfig({
  ...eventConfigInput,
  authorities: {
    ...eventConfigInput.authorities,
    organizer: "0x36b7c556c584d65bd44ae57656b64b68bb88e2cf",
    headJudge: "0x141c4d64a4eecb1a1780b24b184eff748ac36d6d",
  },
});
