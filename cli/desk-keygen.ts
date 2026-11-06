// `lanyard desk-keygen`: create the dedicated desk wallet that sends first-time tGLM and writes
// readonly `drip` records (B1.1-R7, desk-wallet funding profile). Prints only the address, for
// deployments/rabdi.json. Move the secret into .env as DESK_WALLET_PRIVATE_KEY, then delete the file.
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { eventConfig } from "../src/shared/event.config";
import { runKeygen, writeSecretOnce } from "./keygen";

export function deskKeygen(root: string, edition = eventConfig.edition) {
  const secret = generatePrivateKey();
  const file = writeSecretOnce(root, "desk-key", edition, secret);
  return { file, address: privateKeyToAddress(secret).toLowerCase() };
}

export const runDeskKeygen = (root: string): number =>
  runKeygen("desk-keygen", () => {
    const { file, address } = deskKeygen(root);
    return [
      `desk wallet key written to ${file} (owner-only; not printed)`,
      `address ${address}`,
      "Move the secret into .env as DESK_WALLET_PRIVATE_KEY, then delete the file.",
    ];
  });
