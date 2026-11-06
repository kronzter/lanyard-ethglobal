// Role discovery for a connected wallet (plans/01-evidence-and-interfaces.md §3).
import type { Address, Label } from "../types/primitives";
import type { AtBlock } from "./ens-reader";

export type DiscoveredRole = { label: Label; role: string };

export interface IdentityDirectory {
  /**
   * Every label `address` owns at the block, discovered from registration events and verified
   * with `EnsReader.owner` (never reverse ENS, forward addresses or fixture personas alone).
   * Sorted by label. The shell asks the user to pick one when there are several.
   */
  labelsFor(address: Address, at: AtBlock): Promise<DiscoveredRole[]>;
}
