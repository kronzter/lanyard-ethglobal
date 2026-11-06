// ENSv2 infrastructure on Sepolia, from ensdomains/contracts-v2 at tag
// sepolia-deployment-2026-09-15 (f2f0a05): contracts/deployments/sepolia/addresses.md.
//
// These live here, not in deployments/sepolia.json, because that file's live mode also needs the
// chain reset identity (P0.6-S7) and the edition's public https origin, neither chosen yet. A1's
// live deploy moves them across (plans/A1-namespace.md › A1.1 tasks).
import type { Address } from "../shared/types/primitives";

export const ENSV2_SEPOLIA_TAG = "sepolia-deployment-2026-09-15";
export const ENSV2_SEPOLIA_COMMIT = "f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab";

export const ensv2Sepolia = {
  rootRegistry: "0x9703dbd26dab89504490994138cf2c575251a9ce",
  ethRegistry: "0x657ea849311d3d5823348dded7c2aaafb3ede09e",
  ethRegistrar: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
  labelStore: "0x375c082021e677a40ea2ae094d050602dba90992",
  verifiableFactory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c",
  userRegistryImpl: "0xa80338aaa8d23831cea25e858d1774534abb0263",
  permissionedResolverImpl: "0x14f09fd05d4585759e54844dc9b00147131cf243",
  universalResolverV2: "0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3",
} as const satisfies Record<string, Address>;

export type Ensv2SepoliaContract = keyof typeof ensv2Sepolia;
