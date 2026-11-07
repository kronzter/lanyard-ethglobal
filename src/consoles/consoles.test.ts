import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { ROLE_SET_TEXT } from "../ens/grant-plan";
import { checkAuthority, partnerHash, permsResource, type AuthorityReads } from "./authority";
import { guardChain } from "./chain-guard";
import { planTeamFlow, type TeamFlowInput } from "./team-flow";
import { ConsoleBlocked, formatTxResult, sendGuarded, TxUncertain, type TxDeps } from "./tx";

const A = "0x00000000000000000000000000000000000000a1" as Address;
const B = "0x00000000000000000000000000000000000000b2" as Address;
const Z = "0x0000000000000000000000000000000000000000" as Address;

const reads = (over: Partial<AuthorityReads> = {}): AuthorityReads => ({
  organizer: async () => A,
  headJudge: async () => A,
  partnerWallet: async () => A,
  coordinatorRoles: async () => ROLE_SET_TEXT,
  ...over,
});

describe("checkAuthority (R2)", () => {
  it("accepts the organizer, case-insensitively", async () => {
    expect(
      await checkAuthority({ kind: "organizer" }, A.toUpperCase().replace("0X", "0x") as Address, reads()),
    ).toEqual({
      ok: true,
    });
  });
  it("rejects a wallet that is not the organizer with a clear message", async () => {
    const r = await checkAuthority({ kind: "organizer" }, B, reads());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not the organizer/);
  });
  it("rejects a non-head-judge", async () => {
    expect((await checkAuthority({ kind: "headJudge" }, B, reads())).ok).toBe(false);
  });
  it("reads the partner wallet for that partner's hash only", async () => {
    const partnerWallet = vi.fn(async (h: Hex) => (h === partnerHash("arkiv") ? A : Z));
    expect(
      (await checkAuthority({ kind: "partner", partner: "arkiv" }, A, reads({ partnerWallet }))).ok,
    ).toBe(true);
    expect((await checkAuthority({ kind: "partner", partner: "ens" }, A, reads({ partnerWallet }))).ok).toBe(
      false,
    );
  });
  it("requires ROLE_SET_TEXT on the lanyard.perms resource", async () => {
    const coordinatorRoles = vi.fn(async (_r: bigint, _w: Address) => 0n);
    const r = await checkAuthority({ kind: "coordinator" }, A, reads({ coordinatorRoles }));
    expect(r.ok).toBe(false);
    expect(coordinatorRoles).toHaveBeenCalledWith(permsResource(), A);
    expect(
      (await checkAuthority({ kind: "coordinator" }, A, reads({ coordinatorRoles: async () => 1n << 3n })))
        .ok,
    ).toBe(false);
  });
  it("blocks when disconnected or when the read fails", async () => {
    expect((await checkAuthority({ kind: "organizer" }, null, reads())).ok).toBe(false);
    const r = await checkAuthority(
      { kind: "organizer" },
      A,
      reads({
        organizer: async () => {
          throw new Error("rpc down");
        },
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("guardChain (R4)", () => {
  it("asks the wallet to switch and reports not ok on the wrong chain", () => {
    const switchChain = vi.fn();
    const g = guardChain({ chainId: 7794095, switchChain });
    expect(g.ok).toBe(false);
    expect(switchChain).toHaveBeenCalledWith(11155111);
  });
  it("passes on Sepolia without switching", () => {
    const switchChain = vi.fn();
    expect(guardChain({ chainId: 11155111, switchChain }).ok).toBe(true);
    expect(switchChain).not.toHaveBeenCalled();
  });
});

function deps(over: Partial<TxDeps> = {}, chainId = 11155111): TxDeps {
  return {
    wallet: { address: A, chainId, switchChain: vi.fn() },
    reads: reads(),
    simulate: vi.fn(async () => {}),
    send: vi.fn(async () => "0xabc" as Hex),
    wait: vi.fn(async () => ({ status: "success" as const, blockNumber: 42n })),
    ...over,
  };
}
const req = { to: B, data: "0x01" as Hex, what: "x", authority: { kind: "organizer" } as const };

describe("sendGuarded (R1, R2, R4)", () => {
  it("returns hash and block", async () => {
    const r = await sendGuarded(deps(), req);
    expect(r).toEqual({ hash: "0xabc", block: 42n });
    expect(formatTxResult(r)).toContain("block 42");
  });
  it("sends nothing on the wrong chain", async () => {
    const d = deps({}, 7794095);
    await expect(sendGuarded(d, req)).rejects.toBeInstanceOf(ConsoleBlocked);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.wallet.switchChain).toHaveBeenCalledWith(11155111);
  });
  it("sends nothing for a wrong-role wallet", async () => {
    const d = deps({ reads: reads({ organizer: async () => B }) });
    await expect(sendGuarded(d, req)).rejects.toThrow(/not the organizer/);
    expect(d.simulate).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
  it("sends nothing when simulation reverts", async () => {
    const d = deps({
      simulate: async () => {
        throw new Error("revert");
      },
    });
    await expect(sendGuarded(d, req)).rejects.toBeInstanceOf(ConsoleBlocked);
    expect(d.send).not.toHaveBeenCalled();
  });
  it("reports the hash when confirmation fails or reverts", async () => {
    const lost = deps({
      wait: async () => {
        throw new Error("timeout");
      },
    });
    await expect(sendGuarded(lost, req)).rejects.toMatchObject({ name: "TxUncertain", hash: "0xabc" });
    const rev = deps({ wait: async () => ({ status: "reverted" as const, blockNumber: 1n }) });
    await expect(sendGuarded(rev, req)).rejects.toBeInstanceOf(TxUncertain);
  });
});

describe("planTeamFlow (R5)", () => {
  const HR = "0x00000000000000000000000000000000000000c3" as Address;
  const CHILD = "0x00000000000000000000000000000000000000d4" as Address;
  const registered = {
    registeredChild: CHILD,
    registeredLead: A,
    currentOwner: A,
    currentChild: CHILD,
    status: 2,
    expiry: 100n,
    minimumExpiry: 50n,
  };
  const base: TeamFlowInput = {
    label: "alpha-team",
    lead: A,
    team: registered,
    resolver: HR,
    currentUrl: null,
    hackersResolver: HR,
    publicAppOrigin: "https://lanyard-eth.vercel.app",
    repair: false,
  };
  it("unregistered team: register first, link waits", () => {
    const f = planTeamFlow({
      ...base,
      team: {
        ...registered,
        registeredChild: Z,
        registeredLead: Z,
        currentOwner: Z,
        currentChild: Z,
        status: 0,
        expiry: 0n,
      },
    });
    expect(f).toMatchObject({ registration: "needed", link: "waiting", next: "register" });
  });
  it("registered but no url: only the link step remains (never re-register)", () => {
    const f = planTeamFlow(base);
    expect(f).toMatchObject({ registration: "done", link: "needed", next: "link" });
    expect(f.url).toBe("https://lanyard-eth.vercel.app/teams/alpha-team");
  });
  it("link is ready only when the url reads back equal", () => {
    const f = planTeamFlow({ ...base, currentUrl: "https://lanyard-eth.vercel.app/teams/alpha-team" });
    expect(f).toMatchObject({ link: "ready", next: null });
    expect(planTeamFlow({ ...base, currentUrl: "https://elsewhere.example" }).link).toBe("blocked");
    expect(planTeamFlow({ ...base, currentUrl: "https://elsewhere.example", repair: true }).link).toBe(
      "needed",
    );
  });
  it("blocks a repointed resolver and a foreign lead", () => {
    expect(planTeamFlow({ ...base, resolver: B }).link).toBe("blocked");
    expect(planTeamFlow({ ...base, lead: B }).registration).toBe("blocked");
  });
});
