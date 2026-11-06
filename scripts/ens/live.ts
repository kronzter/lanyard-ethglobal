// The committed live Sepolia deployment (deployments/sepolia.json), checked against the event config.
// A fork run forks live Sepolia, so it uses the same addresses.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, type Address } from "viem";
import { parseSepoliaDeployment, requireLive } from "../../src/shared/deployments/load";
import { eventConfig } from "../../src/shared/event.config";
import { ROOT } from "./connect";

export type LiveSepolia = {
  registrar: Address;
  edition: Address;
  baseRegistry: Address;
  ethRegistry: Address;
  hackersResolver: Address;
  staffResolver: Address;
  publicationResolver: Address;
  universalResolver: Address;
  deployedAtBlock: bigint;
  publicAppOrigin: string;
};

export function loadLiveSepolia(): LiveSepolia {
  const raw: unknown = JSON.parse(readFileSync(resolve(ROOT, "deployments/sepolia.json"), "utf8"));
  const d = requireLive(parseSepoliaDeployment(raw), eventConfig);
  const need = (key: string): Address => {
    const a = d.contracts[key];
    if (!a) throw new Error(`deployments/sepolia.json has no contracts.${key}`);
    return getAddress(a);
  };
  return {
    registrar: need("lanyardRegistrar"),
    edition: need("editionRegistry"),
    baseRegistry: need("baseRegistry"),
    ethRegistry: need("ensEthRegistry"),
    hackersResolver: need("hackersResolver"),
    staffResolver: need("staffResolver"),
    publicationResolver: need("publicationResolver"),
    universalResolver: need("ensUniversalResolverV2"),
    deployedAtBlock: BigInt(d.deployedAtBlock),
    publicAppOrigin: d.publicAppOrigin,
  };
}
