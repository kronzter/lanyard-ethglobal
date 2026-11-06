// Sepolia IdentityDirectory (A2.4-R7): which Lanyard names does a wallet own at a block?
// Candidates come from bounded LabelRegistered scans over every Lanyard registry (found from the
// registrar's BookCreated / PartnerOnboarded / TeamRegistered events up to the block); each is then
// verified with EnsReader.owner. A scan that cannot complete throws: incomplete discovery is never
// reported as "no badge". Runtime-neutral (viem only).
import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import type { SepoliaReaderDeployment } from "./sepolia-ens-reader";
import { roleOfLabel } from "../shared/ens/roles";
import { EnsReadError, type AtBlock, type EnsReader } from "../shared/interfaces/ens-reader";
import type { DiscoveredRole, IdentityDirectory } from "../shared/interfaces/identity-directory";
import { isCanonicalLabel } from "../shared/labels";
import { scanLogs, type ChunkOptions } from "./logs";

const registrarAbi = parseAbi([
  "function partnerBookRegistry(bytes32 partner, bytes32 sub) view returns (address)",
]);
const bookCreated = parseAbiItem("event BookCreated(bytes32 indexed book, string label, address registry)");
const partnerOnboarded = parseAbiItem(
  "event PartnerOnboarded(bytes32 indexed partner, string label, address indexed wallet, address registry)",
);
const teamRegistered = parseAbiItem(
  "event TeamRegistered(string label, address indexed lead, address registry, uint64 expiry)",
);
const labelRegistered = parseAbiItem(
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
);

export type SepoliaIdentityDirectoryOptions = {
  client: PublicClient;
  reader: EnsReader;
  registrar: Address;
  baseRegistry: Address;
  edition: Address;
  editionLabel: string;
  deployedAtBlock: bigint;
  logs?: ChunkOptions;
};

export class SepoliaIdentityDirectory implements IdentityDirectory {
  constructor(private readonly o: SepoliaIdentityDirectoryOptions) {}

  async labelsFor(address: Address, at: AtBlock): Promise<DiscoveredRole[]> {
    try {
      return await this.discover(address.toLowerCase() as Address, at);
    } catch (err) {
      if (err instanceof EnsReadError) throw err;
      const text =
        err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
      throw new EnsReadError("labelsFor", text.replace(/(?:https?|wss?):\/\/\S+/gi, "<rpc-url>"));
    }
  }

  /** Registry → suffix appended to a label registered in it ("" for the edition itself). */
  private async registries(to: bigint): Promise<Map<string, (segment: string) => string | null>> {
    const { client: pc, registrar, deployedAtBlock: from } = this.o;
    const scan = <T>(f: (r: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>) =>
      scanLogs(from, to, f, this.o.logs);
    const [books, partners, teams] = await Promise.all([
      scan((r) => pc.getLogs({ address: registrar, event: bookCreated, strict: true, ...r })),
      scan((r) => pc.getLogs({ address: registrar, event: partnerOnboarded, strict: true, ...r })),
      scan((r) => pc.getLogs({ address: registrar, event: teamRegistered, strict: true, ...r })),
    ]);
    const map = new Map<string, (segment: string) => string | null>();
    const add = (registry: Address, f: (segment: string) => string | null) =>
      map.set(registry.toLowerCase(), f);
    add(this.o.baseRegistry, (s) => (s === this.o.editionLabel ? "" : null));
    add(this.o.edition, (s) => s);
    for (const b of books) add(b.args.registry, (s) => `${s}.${b.args.label}`);
    for (const t of teams) add(t.args.registry, (s) => `${s}.${t.args.label}`);
    for (const p of partners) {
      const label = p.args.label;
      add(p.args.registry, (s) => `${s}.${label}.partners`);
      for (const sub of ["judges", "staff"]) {
        const registry = await pc.readContract({
          address: registrar,
          abi: registrarAbi,
          functionName: "partnerBookRegistry",
          args: [keccak256(toHex(label)), keccak256(toHex(sub))],
          blockNumber: to,
        });
        if (registry.toLowerCase() !== zeroAddress) add(registry, (s) => `${s}.${sub}.${label}.partners`);
      }
    }
    return map;
  }

  private async discover(who: Address, at: AtBlock): Promise<DiscoveredRole[]> {
    const to = at.sepoliaBlock;
    const registries = await this.registries(to);
    const logs = await scanLogs(
      this.o.deployedAtBlock,
      to,
      (r) =>
        this.o.client.getLogs({
          address: [...registries.keys()] as Address[],
          event: labelRegistered,
          strict: true,
          ...r,
        }),
      this.o.logs,
    );
    const candidates = new Set<string>();
    for (const log of logs) {
      if (log.args.owner.toLowerCase() !== who) continue;
      const label = registries.get(log.address.toLowerCase())?.(log.args.label);
      if (label !== null && label !== undefined && (label === "" || isCanonicalLabel(label)))
        candidates.add(label);
    }
    const owned: DiscoveredRole[] = [];
    for (const label of candidates)
      if ((await this.o.reader.owner(label, at))?.toLowerCase() === who)
        owned.push({ label, role: roleOfLabel(label) });
    return owned.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  }
}

/** Same deployment and RPC as the historical reader; discovery verifies every candidate with it. */
export function createSepoliaIdentityDirectory(opts: {
  rpcUrl: string;
  deployment: SepoliaReaderDeployment;
  editionLabel: string;
  reader: EnsReader;
}): IdentityDirectory {
  const c = opts.deployment.contracts;
  for (const key of ["lanyardRegistrar", "baseRegistry", "editionRegistry"])
    if (!c[key]) throw new Error(`deployment has no contracts.${key}`);
  return new SepoliaIdentityDirectory({
    client: createPublicClient({ chain: sepolia, transport: http(opts.rpcUrl) }) as PublicClient,
    reader: opts.reader,
    registrar: c.lanyardRegistrar as Address,
    baseRegistry: c.baseRegistry as Address,
    edition: c.editionRegistry as Address,
    editionLabel: opts.editionLabel,
    deployedAtBlock: BigInt(opts.deployment.deployedAtBlock),
  });
}
