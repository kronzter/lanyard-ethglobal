// SepoliaEnsReader (plans/A2-permissions-ens-reader.md › A2.4): the real EnsReader over Sepolia.
//
// Ownership walks Lanyard's pinned registries at the requested block. The registry holding each
// name comes from LanyardRegistrar's write-once mappings (books, partners, partner sub-books,
// teams), not from the live tree: ENSv2 hides a subregistry pointer once its name expires, and a
// descendant under an expired or unregistered ancestor must still report its own expiry. A name has
// an owner only when every hop, from `lanyard` in the eth registry down, is REGISTERED at that
// block and still points at the pinned registry below it. Address and text come from the
// Universal Resolver and are never used for ownership. Every failure throws EnsReadError.
//
// Runtime-neutral: viem only, no Node built-ins, so the same module runs in the app and the CLI.
import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { registrationIdOf } from "../shared/ens/registration-id";
import { EnsReadError, type AtBlock, type EnsReader } from "../shared/interfaces/ens-reader";
import { BOOKS, normalizeLabel, toFullName, type Names } from "../shared/labels";
import type { Label } from "../shared/types/primitives";
import type { EnsCache } from "./ens-cache";
import { scanLogs, type ChunkOptions } from "./logs";
import { labelId, registryReadAbi } from "./registry-read";

export type SepoliaEnsReaderOptions = {
  client: PublicClient;
  chainId: number;
  /** Chain reset identity (genesis hash); part of every cache key. */
  resetId: Hex;
  names: Names;
  registrar: Address;
  ethRegistry: Address;
  baseRegistry: Address;
  edition: Address;
  universalResolver: Address;
  /** First block of the Lanyard deployment: reads before it throw, and log scans start there. */
  deployedAtBlock: bigint;
  cache?: EnsCache;
  logs?: ChunkOptions;
};

/** Live deployment addresses as they appear in deployments/sepolia.json. */
export type SepoliaReaderDeployment = {
  resetId: Hex;
  deployedAtBlock: string | bigint;
  contracts: Record<string, string>;
};

/** Build a reader from an RPC URL (EXPO_PUBLIC_SEPOLIA_RPC_URL in the app, an env var in the CLI). */
export function createSepoliaEnsReader(opts: {
  rpcUrl: string;
  deployment: SepoliaReaderDeployment;
  names: Names;
  cache?: EnsCache;
  logs?: ChunkOptions;
}): SepoliaEnsReader {
  const c = opts.deployment.contracts;
  const need = (key: string): Address => {
    const a = c[key];
    if (!a) throw new Error(`deployment has no contracts.${key}`);
    return a as Address;
  };
  return new SepoliaEnsReader({
    client: createPublicClient({ chain: sepolia, transport: http(opts.rpcUrl) }) as PublicClient,
    chainId: sepolia.id,
    resetId: opts.deployment.resetId,
    names: opts.names,
    registrar: need("lanyardRegistrar"),
    ethRegistry: need("ensEthRegistry"),
    baseRegistry: need("baseRegistry"),
    edition: need("editionRegistry"),
    universalResolver: need("ensUniversalResolverV2"),
    deployedAtBlock: BigInt(opts.deployment.deployedAtBlock),
    cache: opts.cache,
    logs: opts.logs,
  });
}

const registrarAbi = parseAbi([
  "function bookRegistry(bytes32 book) view returns (address)",
  "function teamRegistry(bytes32 labelHash) view returns (address)",
  "function partnerRegistry(bytes32 partner) view returns (address)",
  "function partnerBookRegistry(bytes32 partner, bytes32 sub) view returns (address)",
]);
const labelRegistered = parseAbiItem(
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
);
const labelUnregistered = parseAbiItem(
  "event LabelUnregistered(uint256 indexed tokenId, address indexed sender)",
);

const REGISTERED = 2;
const h = (s: string): Hex => keccak256(toHex(s));
const SUB_BOOKS = ["judges", "staff"];

/** One step of a name's ancestry: `segment` in `registry`, whose subregistry must be `child`. */
type Hop = { label: Label; registry: Address; segment: string };

function describe(err: unknown): string {
  const text =
    err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  return text.replace(/(?:https?|wss?):\/\/\S+/gi, "<rpc-url>");
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
const encode = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) => (typeof x === "bigint" ? { $big: x.toString() } : (x as Json)));
const decode = <T>(s: string): T =>
  JSON.parse(s, (_, x: unknown) =>
    x && typeof x === "object" && "$big" in x ? BigInt((x as { $big: string }).$big) : x,
  ) as T;

export class SepoliaEnsReader implements EnsReader {
  private readonly pc: PublicClient;
  private finalized: { number: bigint; at: number } | null = null;
  private readonly timestamps = new Map<bigint, bigint>();
  private readonly hashes = new Map<bigint, Hex>();

  constructor(private readonly o: SepoliaEnsReaderOptions) {
    this.pc = o.client;
  }

  // ----- plumbing -----

  private async run<T>(method: keyof EnsReader, f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (err) {
      if (err instanceof EnsReadError) throw err;
      throw new EnsReadError(method, describe(err));
    }
  }

  private async finalizedBlock(): Promise<bigint> {
    const now = Date.now();
    if (!this.finalized || now - this.finalized.at > 60_000) {
      const b = await this.pc.getBlock({ blockTag: "finalized" });
      this.finalized = { number: b.number, at: now };
    }
    return this.finalized.number;
  }

  /** Timestamp and hash of a block; remembered only once the block is final. */
  private async blockInfo(n: bigint): Promise<{ timestamp: bigint; hash: Hex }> {
    const ts = this.timestamps.get(n);
    const hash = this.hashes.get(n);
    if (ts !== undefined && hash !== undefined) return { timestamp: ts, hash };
    const b = await this.pc.getBlock({ blockNumber: n });
    if (n <= (await this.finalizedBlock())) {
      this.timestamps.set(n, b.timestamp);
      this.hashes.set(n, b.hash);
    }
    return { timestamp: b.timestamp, hash: b.hash };
  }

  /** Cache a per-block read, keyed by the block hash, only at or below the finalized block. */
  private async cached<T>(parts: string[], block: bigint, compute: () => Promise<T>): Promise<T> {
    const cache = this.o.cache;
    if (!cache || block > (await this.finalizedBlock())) return compute();
    const { hash } = await this.blockInfo(block);
    const key = [this.o.chainId, this.o.resetId, ...parts, hash].join("|");
    const hit = await cache.get(key);
    if (hit !== undefined) return decode<T>(hit);
    const value = await compute();
    await cache.set(key, encode(value));
    return value;
  }

  private checkBlock(block: bigint): void {
    if (block < this.o.deployedAtBlock)
      throw new Error(`block ${block} is before the Lanyard deployment (${this.o.deployedAtBlock})`);
  }

  // ----- pinned registries -----

  /** The registry that holds `label`, from the registrar's write-once mappings; null if none. */
  private async holdingRegistry(label: Label, blockNumber: bigint): Promise<Address | null> {
    const s = label.split(".");
    const read = (functionName: "bookRegistry" | "teamRegistry" | "partnerRegistry", arg: string) =>
      this.pc.readContract({
        address: this.o.registrar,
        abi: registrarAbi,
        functionName,
        args: [h(arg)],
        blockNumber,
      });
    let r: Address;
    if (label === "") r = this.o.baseRegistry;
    else if (s.length === 1) r = this.o.edition;
    else if (s.length === 2)
      r = await read((BOOKS as readonly string[]).includes(s[1]!) ? "bookRegistry" : "teamRegistry", s[1]!);
    else if (s.length === 3 && s[2] === "partners" && SUB_BOOKS.includes(s[0]!))
      r = await read("partnerRegistry", s[1]!);
    else if (s.length === 4 && s[3] === "partners" && SUB_BOOKS.includes(s[1]!))
      r = await this.pc.readContract({
        address: this.o.registrar,
        abi: registrarAbi,
        functionName: "partnerBookRegistry",
        args: [h(s[2]!), h(s[1]!)],
        blockNumber,
      });
    else return null;
    return r.toLowerCase() === zeroAddress ? null : r;
  }

  private segmentOf(label: Label): string {
    return label === "" ? this.o.names.edition : label.split(".")[0]!;
  }

  /** `label` and each ancestor up to the edition, outermost first, with their holding registries. */
  private async hops(label: Label, blockNumber: bigint): Promise<Hop[] | null> {
    const chain: Label[] = [];
    for (let l = label; ; l = l.includes(".") ? l.slice(l.indexOf(".") + 1) : "") {
      chain.unshift(l);
      if (l === "") break;
    }
    const registries = await Promise.all(chain.map((l) => this.holdingRegistry(l, blockNumber)));
    if (registries.some((r) => r === null)) return null;
    return chain.map((l, i) => ({ label: l, registry: registries[i]!, segment: this.segmentOf(l) }));
  }

  /** Owner at the block: every hop registered, every pointer to the pinned child intact. */
  private async ownerAt(
    label: Label,
    blockNumber: bigint,
  ): Promise<{ owner: Address; hop: Hop; resource: Hex } | null> {
    const hops = await this.hops(label, blockNumber);
    if (!hops) return null;
    const all: Hop[] = [{ label: "", registry: this.o.ethRegistry, segment: "lanyard" }, ...hops];
    // the base name `lanyard.eth` → base registry; each hop's subregistry must be the next hop's registry
    const children: Address[] = [this.o.baseRegistry, ...hops.slice(1).map((x) => x.registry)];
    const states = await this.pc.multicall({
      allowFailure: false,
      blockNumber,
      contracts: all.map((x) => ({
        address: x.registry,
        abi: registryReadAbi,
        functionName: "getState" as const,
        args: [labelId(x.segment)],
      })),
    });
    const pointers = await this.pc.multicall({
      allowFailure: false,
      blockNumber,
      contracts: children.map((_, i) => ({
        address: all[i]!.registry,
        abi: registryReadAbi,
        functionName: "getSubregistry" as const,
        args: [all[i]!.segment],
      })),
    });
    if (states.some((st) => st.status !== REGISTERED)) return null;
    if (pointers.some((p, i) => p.toLowerCase() !== children[i]!.toLowerCase())) return null;
    const last = states[states.length - 1]!;
    return {
      owner: last.latestOwner.toLowerCase() as Address,
      hop: hops[hops.length - 1]!,
      resource: toHex(last.resource, { size: 32 }),
    };
  }

  // ----- EnsReader -----

  async owner(label: Label, at: AtBlock): Promise<Address | null> {
    return this.run("owner", async () => {
      const l = normalizeLabel(label);
      this.checkBlock(at.sepoliaBlock);
      return this.cached(
        ["owner", l],
        at.sepoliaBlock,
        async () => (await this.ownerAt(l, at.sepoliaBlock))?.owner ?? null,
      );
    });
  }

  async registrationId(label: Label, at: AtBlock): Promise<Hex | null> {
    return this.run("registrationId", async () => {
      const l = normalizeLabel(label);
      this.checkBlock(at.sepoliaBlock);
      return this.cached(["registrationId", l], at.sepoliaBlock, async () => {
        const o = await this.ownerAt(l, at.sepoliaBlock);
        return o
          ? registrationIdOf({ chainId: this.o.chainId, registry: o.hop.registry, resource: o.resource })
          : null;
      });
    });
  }

  async expiry(label: Label, at: AtBlock): Promise<bigint | null> {
    return this.run("expiry", async () => {
      const l = normalizeLabel(label);
      this.checkBlock(at.sepoliaBlock);
      return this.cached(["expiry", l], at.sepoliaBlock, async () => {
        const registry = await this.holdingRegistry(l, at.sepoliaBlock);
        if (!registry) return null;
        const st = await this.pc.readContract({
          address: registry,
          abi: registryReadAbi,
          functionName: "getState",
          args: [labelId(this.segmentOf(l))],
          blockNumber: at.sepoliaBlock,
        });
        // No current registration (never registered, reserved, or burned by unregister).
        return st.latestOwner.toLowerCase() === zeroAddress ? null : st.expiry;
      });
    });
  }

  async address(label: Label, at: AtBlock): Promise<Address | null> {
    return this.run("address", async () => {
      const l = normalizeLabel(label);
      this.checkBlock(at.sepoliaBlock);
      return this.cached(["address", l], at.sepoliaBlock, async () => {
        if (!(await this.ownerAt(l, at.sepoliaBlock))) return null;
        const a = await this.pc.getEnsAddress({
          name: toFullName(l, this.o.names),
          blockNumber: at.sepoliaBlock,
          universalResolverAddress: this.o.universalResolver,
        });
        return a ? (a.toLowerCase() as Address) : null;
      });
    });
  }

  async text(label: Label, key: string, at: AtBlock): Promise<string | null> {
    return this.run("text", async () => {
      const l = normalizeLabel(label);
      this.checkBlock(at.sepoliaBlock);
      return this.cached(["text", l, key], at.sepoliaBlock, async () => {
        if (!(await this.ownerAt(l, at.sepoliaBlock))) return null;
        const t = await this.pc.getEnsText({
          name: toFullName(l, this.o.names),
          key,
          blockNumber: at.sepoliaBlock,
          universalResolverAddress: this.o.universalResolver,
        });
        return t === "" ? null : t;
      });
    });
  }

  async unregisteredBetween(label: Label, from: bigint, to: bigint): Promise<boolean> {
    return this.run("unregisteredBetween", async () => {
      const l = normalizeLabel(label);
      if (from > to) return false;
      this.checkBlock(to);
      return this.cached(["unregisteredBetween", l, from.toString()], to, async () => {
        const registry = await this.holdingRegistry(l, to);
        if (!registry) return false;
        const id = labelId(this.segmentOf(l));
        const start = this.o.deployedAtBlock;
        const [registered, unregistered] = await Promise.all([
          scanLogs(
            start,
            to,
            (r) =>
              this.pc.getLogs({
                address: registry,
                event: labelRegistered,
                args: { labelHash: toHex(id, { size: 32 }) },
                strict: true,
                ...r,
              }),
            this.o.logs,
          ),
          scanLogs(
            start,
            to,
            (r) => this.pc.getLogs({ address: registry, event: labelUnregistered, strict: true, ...r }),
            this.o.logs,
          ),
        ]);
        // Token IDs carry a version in their low 32 bits; the rest is the label ID.
        const sameLabel = (tokenId: bigint) => tokenId >> 32n === id >> 32n;
        const events = [
          ...registered.map((e) => ({ kind: "register" as const, block: e.blockNumber, index: e.logIndex })),
          ...unregistered
            .filter((e) => sameLabel(e.args.tokenId))
            .map((e) => ({ kind: "unregister" as const, block: e.blockNumber, index: e.logIndex })),
        ].sort((a, b) => (a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1));
        let live = false;
        for (const e of events) {
          const inRange = e.block >= from && e.block <= to;
          if (e.kind === "unregister") {
            if (inRange) return true;
            live = false;
          } else {
            if (inRange && live) return true; // re-registration over a registration is a new identity
            live = true;
          }
        }
        return false;
      });
    });
  }

  async sepoliaBlockAt(unixSeconds: bigint): Promise<bigint> {
    return this.run("sepoliaBlockAt", async () => {
      const head = await this.pc.getBlock({ blockTag: "latest" });
      if (unixSeconds >= head.timestamp) return head.number;
      const ts = async (n: bigint) => (await this.blockInfo(n)).timestamp;
      // Lanyard never asks about time before its own deployment, and many RPCs prune older blocks.
      const first = this.o.deployedAtBlock;
      if (unixSeconds < (await ts(first)))
        throw new Error(`${unixSeconds} is before the Lanyard deployment (block ${first})`);
      // Invariant: ts(lo) <= t < ts(hi).
      let lo = first;
      let hi = head.number;
      while (hi - lo > 1n) {
        const mid = (lo + hi) / 2n;
        if ((await ts(mid)) <= unixSeconds) lo = mid;
        else hi = mid;
      }
      return lo;
    });
  }

  async headBlock(): Promise<bigint> {
    return this.run("headBlock", () => this.pc.getBlockNumber());
  }
}
