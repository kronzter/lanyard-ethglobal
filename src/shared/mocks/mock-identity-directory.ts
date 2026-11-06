// MockIdentityDirectory: discovers candidate labels from the fixture's registration events, then
// keeps only those the reader confirms the address owns at the block. Address records and
// personas play no part, so an owner/address disagreement can never grant a role.
import { roleOfLabel } from "../ens/roles";
import type { EnsHistory } from "../fixtures/ens-history";
import type { AtBlock, EnsReader } from "../interfaces/ens-reader";
import type { DiscoveredRole, IdentityDirectory } from "../interfaces/identity-directory";
import type { Address } from "../types/primitives";

export class MockIdentityDirectory implements IdentityDirectory {
  constructor(
    private readonly reader: EnsReader,
    private readonly history: EnsHistory,
  ) {}

  async labelsFor(address: Address, at: AtBlock): Promise<DiscoveredRole[]> {
    const who = address.toLowerCase();
    const candidates = new Set<string>();
    for (const e of this.history.events) {
      if (e.block > at.sepoliaBlock) break;
      if (e.type === "register" && e.owner === who) candidates.add(e.label);
    }
    const owned: DiscoveredRole[] = [];
    for (const label of candidates) {
      if ((await this.reader.owner(label, at)) === who) owned.push({ label, role: roleOfLabel(label) });
    }
    return owned.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  }
}
