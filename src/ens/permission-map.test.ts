/* eslint-disable @typescript-eslint/no-explicit-any -- fake client mirrors viem call shapes */
import type { Address, PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { ROLE } from "./ensv2-abi";
import {
  decodeRoles,
  foldRoleChanges,
  readPermissionMap,
  type PermissionMapDeployment,
} from "./permission-map";

const A = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const REGISTRAR = A(1);
const BASE = A(2);
const EDITION = A(3);
const TEAM_REG = A(4);
const HACKERS_RES = A(5);
const D: PermissionMapDeployment = {
  deployedAtBlock: 10n,
  registrar: REGISTRAR,
  baseRegistry: BASE,
  editionRegistry: EDITION,
  resolvers: { hackersResolver: HACKERS_RES, staffResolver: A(6), publicationResolver: A(7) },
};

type Ev = { address: Address; resource: bigint; account: Address; old: bigint; next: bigint; block: bigint };

function fake(events: Ev[], opts: { onchain?: Map<string, bigint>; failLogs?: boolean } = {}) {
  const onchain = new Map<string, bigint>();
  for (const e of events) onchain.set(`${e.address}|${e.resource}|${e.account}`, e.next);
  for (const [k, v] of opts.onchain ?? []) onchain.set(k, v);
  const count = (addr: Address, resource: bigint) => {
    let c = 0n;
    for (const [k, v] of onchain) {
      const [a, r] = k.split("|");
      if (a !== addr || r !== resource.toString()) continue;
      for (let n = 0n; n < 64n; n++) if ((v >> (4n * n)) & 1n) c += 1n << (4n * n);
    }
    return c;
  };
  return {
    getBlockNumber: async () => 100n,
    getLogs: async (a: any) => {
      if (opts.failLogs) throw new Error("rpc down");
      const inRange = (b: bigint) => b >= a.fromBlock && b <= a.toBlock;
      if (a.event.name === "EACRolesChanged")
        return events
          .filter((e) => inRange(e.block) && (a.address as Address[]).includes(e.address))
          .map((e, i) => ({
            address: e.address,
            blockNumber: e.block,
            logIndex: i,
            args: { resource: e.resource, account: e.account, oldRoleBitmap: e.old, newRoleBitmap: e.next },
          }));
      if (a.event.name === "TeamRegistered")
        return inRange(20n) ? [{ args: { label: "zkpay", lead: A(9), registry: TEAM_REG, expiry: 1n } }] : [];
      return [];
    },
    readContract: async () => A(0),
    multicall: async ({ contracts }: { contracts: any[] }) =>
      contracts.map((c) => {
        if (c.functionName === "roles") return onchain.get(`${c.address}|${c.args[0]}|${c.args[1]}`) ?? 0n;
        if (c.functionName === "roleCount") return count(c.address, c.args[0]);
        const have = onchain.get(`${c.address}|${c.args[0]}|${c.args[2]}`) ?? 0n;
        return (have & c.args[1]) === c.args[1];
      }),
  } as unknown as PublicClient;
}

const grant = (address: Address, account: Address, old: bigint, next: bigint, block = 30n): Ev => ({
  address,
  resource: 7n,
  account,
  old,
  next,
  block,
});

describe("foldRoleChanges", () => {
  it("takes the last event per key in chain order, whatever order they arrive in", () => {
    const e = (block: bigint, index: number, o: bigint, n: bigint) => ({
      block,
      index,
      address: BASE,
      resource: 1n,
      account: A(8),
      oldRoles: o,
      newRoles: n,
    });
    const { current, history } = foldRoleChanges([e(5n, 0, 1n, 0n), e(3n, 0, 0n, 1n), e(9n, 2, 0n, 16n)]);
    expect([...current.values()].map((x) => x.roles)).toEqual([16n]);
    expect(history).toEqual([]);
  });

  it("reports an event whose old bitmap does not match the fold (a missing event)", () => {
    const { history } = foldRoleChanges([
      { block: 1n, index: 0, address: BASE, resource: 1n, account: A(8), oldRoles: 4n, newRoles: 5n },
    ]);
    expect(history).toHaveLength(1);
  });
});

describe("decodeRoles", () => {
  it("names registry, admin and unknown bits", () => {
    expect(decodeRoles(ROLE.RENEW | (ROLE.SET_RESOLVER << 128n), "registry")).toEqual([
      "RENEW",
      "admin:SET_RESOLVER",
    ]);
    expect(decodeRoles((1n << 4n) | (1n << 28n), "resolver")).toEqual(["SET_TEXT", "LINK"]);
    expect(decodeRoles(1n << 2n, "resolver")).toEqual(["bit:2"]);
  });
});

describe("readPermissionMap", () => {
  it("folds grants and revokes across discovered registries and resolvers", async () => {
    const client = fake([
      grant(BASE, A(10), 0n, ROLE.RENEW),
      grant(BASE, A(10), ROLE.RENEW, ROLE.RENEW | ROLE.SET_RESOLVER, 31n),
      grant(BASE, A(11), 0n, ROLE.RENEW),
      grant(BASE, A(11), ROLE.RENEW, 0n, 32n),
      grant(TEAM_REG, A(12), 0n, ROLE.REGISTRAR),
      grant(HACKERS_RES, A(13), 0n, 1n << 4n),
    ]);
    const map = await readPermissionMap(client, D);
    expect(map.mismatches).toEqual([]);
    expect(map.contracts.map((c) => c.name)).toContain("team:zkpay");
    expect(map.grants.map((g) => [g.contract, g.account, g.roleNames])).toEqual([
      ["baseRegistry", A(10), ["RENEW", "SET_RESOLVER"]],
      ["hackersResolver", A(13), ["SET_TEXT"]],
      ["team:zkpay", A(12), ["REGISTRAR"]],
    ]);
  });

  it("exposes a mismatch when the chain disagrees with the events (R3)", async () => {
    const onchain = new Map([[`${BASE}|7|${A(10)}`, ROLE.RENEW | ROLE.UPGRADE]]);
    const map = await readPermissionMap(fake([grant(BASE, A(10), 0n, ROLE.RENEW)], { onchain }), D);
    const kinds = map.mismatches.map((m) => m.kind);
    expect(kinds).toContain("roles");
    expect(kinds).toContain("roleCount");
  });

  it("exposes a revoked-in-events but still-held grant", async () => {
    const onchain = new Map([[`${BASE}|7|${A(10)}`, ROLE.RENEW]]);
    const map = await readPermissionMap(
      fake([grant(BASE, A(10), 0n, ROLE.RENEW), grant(BASE, A(10), ROLE.RENEW, 0n, 31n)], { onchain }),
      D,
    );
    expect(map.mismatches.some((m) => m.kind === "roles")).toBe(true);
    expect(map.grants).toEqual([]);
  });

  it("throws, rather than returning a partial map, when a log scan fails", async () => {
    await expect(
      readPermissionMap(fake([], { failLogs: true }), D, { logs: { maxSpan: 10n, minSpan: 10n } }),
    ).rejects.toThrow(/log scan failed/);
  });
});
