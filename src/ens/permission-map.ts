// ENS permission map (plans/A4-winners-consoles.md A4.3): every EnhancedAccessControl grant on
// Lanyard's contracts, folded from `EACRolesChanged` events and cross-checked against direct
// `roles`, `hasRoles` and `roleCount` reads at the same block (A4.3-R3). A failed log scan throws
// (see ./logs): a partial scan is never presented as a complete map. Runtime-neutral (viem only).
/* eslint-disable @typescript-eslint/no-explicit-any -- viem getLogs/multicall are typed per ABI; this module handles several ABIs generically */
import {
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ROLE } from "./ensv2-abi";
import { scanLogs, type ChunkOptions } from "./logs";

const eacRolesChanged = parseAbiItem(
  "event EACRolesChanged(uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap)",
);
const bookCreated = parseAbiItem("event BookCreated(bytes32 indexed book, string label, address registry)");
const teamRegistered = parseAbiItem(
  "event TeamRegistered(string label, address indexed lead, address registry, uint64 expiry)",
);
const partnerOnboarded = parseAbiItem(
  "event PartnerOnboarded(bytes32 indexed partner, string label, address indexed wallet, address registry)",
);
const registrarAbi = parseAbi([
  "function partnerBookRegistry(bytes32 partner, bytes32 sub) view returns (address)",
]);
const eacAbi = parseAbi([
  "function roles(uint256 resource, address account) view returns (uint256)",
  "function roleCount(uint256 resource) view returns (uint256)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
]);

/** Registry role bits (ensv2-abi `ROLE`, plus the transfer bit whose admin half the registry uses). */
export const REGISTRY_ROLE_BITS: Readonly<Record<string, bigint>> = {
  ...ROLE,
  CAN_TRANSFER: 1n << 28n,
};

/** PermissionedResolverLib role bits (pinned ens-contracts-v2-sepolia-2026-09-15). */
export const RESOLVER_ROLE_BITS: Readonly<Record<string, bigint>> = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_ABI: 1n << 12n,
  SET_INTERFACE: 1n << 16n,
  SET_NAME: 1n << 20n,
  SET_DATA: 1n << 24n,
  LINK: 1n << 28n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
};

export type ContractKind = "registry" | "resolver";

/** Names for every set bit; an admin bit (bit + 128) reads `admin:NAME`; unknown bits `bit:N`. */
export function decodeRoles(bitmap: bigint, kind: ContractKind): string[] {
  const table = kind === "registry" ? REGISTRY_ROLE_BITS : RESOLVER_ROLE_BITS;
  const out: string[] = [];
  for (let i = 0n; i < 256n; i++) {
    if (((bitmap >> i) & 1n) === 0n) continue;
    const bit = 1n << (i % 128n);
    const name = Object.entries(table).find(([, b]) => b === bit)?.[0];
    const label = name ?? `bit:${i % 128n}`;
    out.push(i >= 128n ? `admin:${label}` : label);
  }
  return out;
}

export type MapContract = { name: string; address: Address; kind: ContractKind };

export type Grant = {
  contract: string;
  address: Address;
  kind: ContractKind;
  resource: Hex;
  account: Address;
  roles: bigint;
  roleNames: string[];
};

export type Mismatch =
  | { kind: "roles"; contract: string; resource: Hex; account: Address; folded: bigint; onchain: bigint }
  | { kind: "hasRoles"; contract: string; resource: Hex; account: Address; folded: bigint }
  | { kind: "roleCount"; contract: string; resource: Hex; folded: bigint; onchain: bigint }
  | {
      kind: "history";
      contract: string;
      resource: Hex;
      account: Address;
      expectedOld: bigint;
      eventOld: bigint;
    };

export type PermissionMap = {
  /** Block of every read and the end of the scan. */
  block: bigint;
  contracts: MapContract[];
  grants: Grant[];
  mismatches: Mismatch[];
};

export type PermissionMapDeployment = {
  deployedAtBlock: bigint;
  registrar: Address;
  baseRegistry: Address;
  editionRegistry: Address;
  resolvers: { hackersResolver: Address; staffResolver: Address; publicationResolver: Address };
};

const key = (a: string) => a.toLowerCase();
const hex32 = (n: bigint): Hex => toHex(n, { size: 32 });
const hash = (s: string): Hex => keccak256(toHex(s));

/** Registries and resolvers named by the registrar's events (books, partners, sub-books, teams). */
export async function discoverContracts(
  client: PublicClient,
  d: PermissionMapDeployment,
  to: bigint,
  logs?: ChunkOptions,
): Promise<MapContract[]> {
  const scan = (event: unknown) =>
    scanLogs(
      d.deployedAtBlock,
      to,
      (r) => client.getLogs({ address: d.registrar, event, strict: true, ...r } as never) as Promise<any[]>,
      logs,
    );
  const [books, teams, partners] = await Promise.all([
    scan(bookCreated),
    scan(teamRegistered),
    scan(partnerOnboarded),
  ]);
  const out: MapContract[] = [
    { name: "baseRegistry", address: d.baseRegistry, kind: "registry" },
    { name: "editionRegistry", address: d.editionRegistry, kind: "registry" },
  ];
  for (const e of books)
    out.push({ name: `book:${e.args.label}`, address: e.args.registry, kind: "registry" });
  for (const e of teams)
    out.push({ name: `team:${e.args.label}`, address: e.args.registry, kind: "registry" });
  for (const e of partners) {
    out.push({ name: `partner:${e.args.label}`, address: e.args.registry, kind: "registry" });
    for (const sub of ["judges", "staff"]) {
      const a = (await client.readContract({
        address: d.registrar,
        abi: registrarAbi,
        functionName: "partnerBookRegistry",
        args: [e.args.partner, hash(sub)],
        blockNumber: to,
      })) as Address;
      if (key(a) !== zeroAddress)
        out.push({ name: `partner:${e.args.label}/${sub}`, address: a, kind: "registry" });
    }
  }
  for (const [name, address] of Object.entries(d.resolvers)) out.push({ name, address, kind: "resolver" });
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(key(c.address))) return false;
    seen.add(key(c.address));
    return true;
  });
}

type Change = {
  block: bigint;
  index: number;
  address: Address;
  resource: bigint;
  account: Address;
  oldRoles: bigint;
  newRoles: bigint;
};
type Entry = { address: Address; resource: bigint; account: Address; roles: bigint };
type HistoryBreak = {
  address: Address;
  resource: bigint;
  account: Address;
  expectedOld: bigint;
  eventOld: bigint;
};

/**
 * Fold change events (in chain order) into the current bitmap per (contract, resource, account).
 * Each event's `oldRoleBitmap` must equal the folded value before it; otherwise an event is missing.
 */
export function foldRoleChanges(changes: Change[]): { current: Map<string, Entry>; history: HistoryBreak[] } {
  const sorted = [...changes].sort((a, b) =>
    a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1,
  );
  const current = new Map<string, Entry>();
  const history: HistoryBreak[] = [];
  for (const c of sorted) {
    const k = `${key(c.address)}|${c.resource}|${key(c.account)}`;
    const before = current.get(k)?.roles ?? 0n;
    if (before !== c.oldRoles)
      history.push({
        address: c.address,
        resource: c.resource,
        account: c.account,
        expectedOld: before,
        eventOld: c.oldRoles,
      });
    current.set(k, { address: c.address, resource: c.resource, account: c.account, roles: c.newRoles });
  }
  return { current, history };
}

const MULTICALL_BATCH = 100;

async function batched<T>(
  client: PublicClient,
  calls: { address: Address; abi: unknown; functionName: string; args: readonly unknown[] }[],
  blockNumber: bigint,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < calls.length; i += MULTICALL_BATCH) {
    const res = await client.multicall({
      allowFailure: false,
      blockNumber,
      contracts: calls.slice(i, i + MULTICALL_BATCH) as never,
    });
    out.push(...(res as unknown as T[]));
  }
  return out;
}

/** Scan, fold and verify. Throws if any log range or read cannot be completed. */
export async function readPermissionMap(
  client: PublicClient,
  d: PermissionMapDeployment,
  opts: { logs?: ChunkOptions; block?: bigint } = {},
): Promise<PermissionMap> {
  const block = opts.block ?? (await client.getBlockNumber());
  const contracts = await discoverContracts(client, d, block, opts.logs);
  const byAddr = new Map(contracts.map((c) => [key(c.address), c]));
  const raw = await scanLogs(
    d.deployedAtBlock,
    block,
    (r) =>
      client.getLogs({
        address: contracts.map((c) => c.address),
        event: eacRolesChanged,
        strict: true,
        ...r,
      }) as Promise<any[]>,
    opts.logs,
  );
  const { current, history } = foldRoleChanges(
    raw.map((e) => ({
      block: e.blockNumber,
      index: e.logIndex,
      address: e.address,
      resource: e.args.resource,
      account: e.args.account,
      oldRoles: e.args.oldRoleBitmap,
      newRoles: e.args.newRoleBitmap,
    })),
  );
  const entries = [...current.values()];
  const name = (a: Address) => byAddr.get(key(a))!.name;
  const mismatches: Mismatch[] = history.map((h) => ({
    kind: "history" as const,
    contract: name(h.address),
    resource: hex32(h.resource),
    account: h.account,
    expectedOld: h.expectedOld,
    eventOld: h.eventOld,
  }));

  // roles(resource, account) for every pair ever seen, including fully revoked ones.
  const onchainRoles = await batched<bigint>(
    client,
    entries.map((e) => ({
      address: e.address,
      abi: eacAbi,
      functionName: "roles",
      args: [e.resource, e.account],
    })),
    block,
  );
  entries.forEach((e, i) => {
    if (onchainRoles[i] !== e.roles)
      mismatches.push({
        kind: "roles",
        contract: name(e.address),
        resource: hex32(e.resource),
        account: e.account,
        folded: e.roles,
        onchain: onchainRoles[i]!,
      });
  });

  // hasRoles must hold for every live entry (it also counts ROOT_RESOURCE grants, so it is only wider).
  const live = entries.filter((e) => e.roles !== 0n);
  const has = await batched<boolean>(
    client,
    live.map((e) => ({
      address: e.address,
      abi: eacAbi,
      functionName: "hasRoles",
      args: [e.resource, e.roles, e.account],
    })),
    block,
  );
  live.forEach((e, i) => {
    if (!has[i])
      mismatches.push({
        kind: "hasRoles",
        contract: name(e.address),
        resource: hex32(e.resource),
        account: e.account,
        folded: e.roles,
      });
  });

  // roleCount(resource): one nybble per role = number of accounts holding that role bit.
  const resources = new Map<string, { address: Address; resource: bigint }>();
  for (const e of entries)
    resources.set(`${key(e.address)}|${e.resource}`, { address: e.address, resource: e.resource });
  const rs = [...resources.values()];
  const counts = await batched<bigint>(
    client,
    rs.map((r) => ({ address: r.address, abi: eacAbi, functionName: "roleCount", args: [r.resource] })),
    block,
  );
  rs.forEach((r, i) => {
    let folded = 0n;
    for (const e of entries) {
      if (e.resource !== r.resource || key(e.address) !== key(r.address)) continue;
      for (let n = 0n; n < 64n; n++) if ((e.roles >> (4n * n)) & 1n) folded += 1n << (4n * n);
    }
    if (folded !== counts[i])
      mismatches.push({
        kind: "roleCount",
        contract: name(r.address),
        resource: hex32(r.resource),
        folded,
        onchain: counts[i]!,
      });
  });

  const grants: Grant[] = live
    .map((e) => {
      const c = byAddr.get(key(e.address))!;
      return {
        contract: c.name,
        address: e.address,
        kind: c.kind,
        resource: hex32(e.resource),
        account: e.account,
        roles: e.roles,
        roleNames: decodeRoles(e.roles, c.kind),
      };
    })
    .sort(
      (a, b) =>
        a.contract.localeCompare(b.contract) ||
        a.resource.localeCompare(b.resource) ||
        a.account.localeCompare(b.account),
    );
  return { block, contracts, grants, mismatches };
}
