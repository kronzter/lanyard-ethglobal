import { defineSchema, str } from "@arkiv-network/sdk/schema";
import { ExpirationTime } from "@arkiv-network/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventConfig } from "@/shared/event.config";
import type { Hex } from "@/shared/types/primitives";
import { cachedReader } from "../cache";
import { FakeArkiv } from "../fake";
import { LIVE_PAUSED, createLiveCore, sweepExpired, type LiveStatus } from "../live";
import {
  allRecordsForEvent,
  leaderboardInputs,
  myShifts,
  projectsForJudge,
  scanKind,
  ticketsOpenInZone,
} from "../readers";
import { buildCreate, type WriteContext } from "../writers";

const T = eventConfig.times;
const A = "0x00000000000000000000000000000000000000a1" as const;
const K = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const ctx = (byLabel: string): WriteContext => ({ edition: eventConfig.edition, byLabel, times: T });
const fresh = () => new FakeArkiv(T.eventStart - 10_000n);
const VENUE = {
  seats: [
    { id: "S001", cell: { x: 0, y: 0 }, zone: "west" },
    { id: "S002", cell: { x: 1, y: 0 }, zone: "east" },
  ],
};

describe("readers", () => {
  it("decode their kind, skip junk that only claims app=lanyard, and page by key within a budget", async () => {
    const f = fresh();
    await f.writer(A).write({
      creates: Array.from({ length: 5 }, () =>
        buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
      ),
    });
    const Junk = defineSchema({ app: str().indexed(), event: str().indexed(), kind: str().indexed() });
    await f.writer(A).write({
      creates: [
        {
          schema: Junk,
          values: { app: "lanyard", event: eventConfig.edition, kind: "ticket" } as never,
          expiration: ExpirationTime.fromMinutes(30),
        },
      ],
    });
    const all = await scanKind(f, eventConfig.edition, "ticket", {}, { pageSize: 2 });
    expect(all.records).toHaveLength(5);
    expect(all.skipped).toBe(1);
    expect(all.complete).toBe(true);
    expect(all.pages.map((p) => p.count)).toEqual([2, 2, 2, 0]);
    const capped = await scanKind(f, eventConfig.edition, "ticket", {}, { pageSize: 2, maxPages: 2 });
    expect(capped.complete).toBe(false);
  });

  it("list a volunteer's shifts and a zone's unresolved tickets (status modeled positively)", async () => {
    const f = fresh();
    const w = f.writer(A);
    await w.write({
      creates: [
        buildCreate("shift", ctx("priya.volunteers"), {
          volunteer: "ravi.volunteers",
          zone: "west",
          startsAt: T.eventStart,
          endsAt: T.eventStart + 3600n,
        }),
      ],
    });
    const [t1, t2, t3] = (
      await w.write({
        creates: [
          buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
          buildCreate("ticket", ctx("zkpay-b.hackers"), { seat: "S001", venue: K(1), category: "power" }),
          buildCreate("ticket", ctx("zkpay-c.hackers"), { seat: "S002", venue: K(1), category: "food" }),
        ],
      })
    ).created;
    await w.write({
      creates: [
        buildCreate("ticket_resolution", ctx("ravi.volunteers"), { ticket: t1!, claim: K(9), seat: "S001" }),
      ],
    });
    expect((await myShifts(f, eventConfig.edition, "ravi.volunteers")).records).toHaveLength(1);
    const open = await ticketsOpenInZone(f, eventConfig.edition, VENUE, "west");
    expect(open.records.map((r) => r.key)).toEqual([t2]);
    expect(
      (await ticketsOpenInZone(f, eventConfig.edition, VENUE, "east")).records.map((r) => r.key),
    ).toEqual([t3]);
  });

  it("join a judge's assignments to their submissions and gather leaderboard inputs", async () => {
    const f = fresh();
    const w = f.writer(A);
    const content = {
      page: {
        title: "zkPay",
        description: "",
        members: ["Person A"],
        links: { ethglobal: "https://ethglobal.com/showcase/zkpay" },
      },
    };
    const [sub] = (
      await w.write({
        creates: [
          buildCreate("submission", ctx("zkpay"), {
            project: K(1),
            team: "zkpay",
            track: "main",
            lead: A,
            content,
          }),
        ],
      })
    ).created;
    await w.write({
      creates: [
        buildCreate("judge_assignment", ctx("organizer"), {
          judge: "ana.judges",
          submission: sub!,
          rubric: K(2),
        }),
        buildCreate("judge_assignment", ctx("organizer"), {
          judge: "ana.judges",
          submission: K(3),
          rubric: K(2),
        }),
      ],
    });
    const mine = await projectsForJudge(f, eventConfig.edition, "ana.judges");
    expect(mine.items.map((i) => i.submission?.key ?? null).sort()).toEqual([null, sub].sort());
    const inputs = await leaderboardInputs(f, eventConfig.edition);
    expect(inputs.byKind.submission).toHaveLength(1);
    expect(inputs.byKind.judge_assignment).toHaveLength(2);
    expect((await allRecordsForEvent(f, eventConfig.edition)).records).toHaveLength(3);
  });

  it("cache repeated reads within the TTL and clear on invalidate", async () => {
    const f = fresh();
    let t = 0;
    const spy = vi.spyOn(f, "query");
    const c = cachedReader(f, { ttlMs: 1000, now: () => t });
    const q = { equals: { kind: { type: "str", value: "ticket" } } as never };
    await c.query(q);
    await c.query(q);
    expect(spy).toHaveBeenCalledTimes(1);
    t = 2000;
    await c.query(q);
    expect(spy).toHaveBeenCalledTimes(2);
    c.invalidate();
    await c.query(q);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe("live core", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes on events, pauses on a lost watcher, then resubscribes and rebuilds", async () => {
    const f = fresh();
    const statuses: LiveStatus["state"][] = [];
    let refreshes = 0;
    const core = createLiveCore({
      reader: f,
      refresh: async () => void refreshes++,
      onStatus: (s) => statuses.push(s.state),
      debounceMs: 10,
      retryMs: 50,
      rescanMs: 10_000,
    });
    core.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("live");
    await f.writer(A).write({
      creates: [
        buildCreate("ticket", ctx("zkpay-a.hackers"), { seat: "S001", venue: K(1), category: "wifi" }),
      ],
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(refreshes).toBe(2);
    let paused: LiveStatus | undefined;
    const core2 = createLiveCore({
      reader: f,
      refresh: async () => {},
      onStatus: (s) => (s.state === "paused" ? (paused = s) : undefined),
      retryMs: 50,
    });
    core2.start();
    f.failWatchers();
    expect(paused).toMatchObject({ state: "paused", message: LIVE_PAUSED });
    expect(statuses).toContain("paused");
    await vi.advanceTimersByTimeAsync(60);
    expect(statuses.at(-1)).toBe("live");
    core.stop();
    core2.stop();
  });

  it("sweeps expired records against the head", () => {
    expect(sweepExpired([{ expiresAt: 5n }, { expiresAt: 11n }], { number: 10n })).toEqual([
      { expiresAt: 11n },
    ]);
  });
});
