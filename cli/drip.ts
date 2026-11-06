// `lanyard drip <address> [--forget-uncertain]`: send first-time tGLM from the desk wallet and
// record it (B1.1-R7/R8), for seeding and integration runs. The desk key comes only from this
// machine's .env (DESK_WALLET_PRIVATE_KEY); the journal lives in .lanyard/drip-journal.json so an
// interrupted run is reconciled by its transaction hash, never resent.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatEther } from "viem";
import { createArkivReader, createKeyWriter } from "../src/arkiv/client";
import { drip, forgetDripIntent } from "../src/arkiv/drip";
import type { KeyValueStore } from "../src/arkiv/store";
import { parseRabdiDeployment } from "../src/shared/deployments/load";
import { eventConfig } from "../src/shared/event.config";
import { isAddress, type Address, type Hex } from "../src/shared/types/primitives";
import rabdiJson from "../deployments/rabdi.json";

/** A JSON-object file store written atomically (temp file, then rename). */
export function jsonFileStore(file: string): KeyValueStore {
  const load = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  };
  const save = async (data: Record<string, string>) => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tmp, file);
  };
  return {
    get: async (k) => (await load())[k] ?? null,
    set: async (k, v) => save({ ...(await load()), [k]: v }),
    delete: async (k) => {
      const data = await load();
      delete data[k];
      await save(data);
    },
  };
}

export async function runDrip(root: string, args: string[]): Promise<number> {
  const target = args.find((a) => !a.startsWith("--"));
  if (!target || !isAddress(target)) {
    console.error("usage: lanyard drip <address> [--forget-uncertain]");
    return 2;
  }
  const journal = jsonFileStore(path.join(root, ".lanyard", "drip-journal.json"));
  if (args.includes("--forget-uncertain")) {
    await forgetDripIntent(journal, eventConfig.edition, target as Address);
    console.log(`forgot the journaled intent for ${target.toLowerCase()} (check the explorer first)`);
    return 0;
  }
  const deployment = parseRabdiDeployment(rabdiJson);
  if (deployment.mode !== "live" || deployment.funding.profile !== "desk-wallet") {
    console.error("lanyard drip: deployments/rabdi.json has no live desk wallet");
    return 1;
  }
  const raw = process.env.DESK_WALLET_PRIVATE_KEY ?? "";
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("lanyard drip: set DESK_WALLET_PRIVATE_KEY in .env (run `pnpm lanyard desk-keygen` once)");
    return 1;
  }
  const dripWei = eventConfig.funding?.dripWei;
  if (!dripWei) {
    console.error("lanyard drip: the event config has no funding.dripWei");
    return 1;
  }
  const access = { rpcUrl: process.env.RABDI_RPC_URL, accessKey: process.env.RABDI_ACCESS_KEY };
  const reader = createArkivReader(access);
  const out = await drip(
    {
      reader,
      desk: createKeyWriter(key, access),
      deskWallet: deployment.funding.deskWallet,
      dripWei,
      edition: eventConfig.edition,
      times: eventConfig.times,
      journal,
    },
    target,
  );
  console.log(JSON.stringify(out, null, 2));
  if (out.status === "sent")
    console.log(`recipient balance ${formatEther(await reader.balance(out.recipient))} tGLM`);
  return out.status === "sent" ? 0 : 1;
}
