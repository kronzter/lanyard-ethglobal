// Public, independently configured ENS authorities from the deployed registrar. Kept separate
// from event.config's fixture wallets so mock mode and deterministic vectors remain reproducible.
// Read back on Sepolia at I2 (2026-11-07); the I2 fork test checks these against the contract.
// results: the WinnerRegistrar's results wallet (deployed 2026-11-07, deployments/sepolia.json).
// partners.arkiv: the wallet onboarded as arkiv.partners by grant-roles; the ENS partner is still a
// placeholder until it is onboarded.
import { validateEventConfig } from "./config/validate";
import { eventConfigInput } from "./event.config";

export const sepoliaEventConfig = validateEventConfig({
  ...eventConfigInput,
  authorities: {
    ...eventConfigInput.authorities,
    organizer: "0x36b7c556c584d65bd44ae57656b64b68bb88e2cf",
    headJudge: "0x141c4d64a4eecb1a1780b24b184eff748ac36d6d",
    results: "0x5ea0793c0c83d5473d63fc9dd43cb4529603a14c",
    partners: {
      ...eventConfigInput.authorities.partners,
      arkiv: "0x3a24292e7cc6ac4297550002d774a3e6d80084a0",
    },
  },
});
