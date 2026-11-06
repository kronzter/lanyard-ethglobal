import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import type { Hex } from "@/shared/types/primitives";
import { PENDING_CLOCK_IN, clockInWithPass, replaceShift, replacementState } from "../batches";
import { FakeArkiv } from "../fake";
import { WriteQueue } from "../queue";
import { memoryStore } from "../store";
import { buildCreate, type WriteContext } from "../writers";

const LEAD = "0x00000000000000000000000000000000000000a1" as const;
const T = eventConfig.times;
const ctx: WriteContext = { edition: eventConfig.edition, byLabel: "priya.volunteers", times: T };
const ticket = () =>
  buildCreate("ticket", ctx, { seat: "S014", venue: `0x${"1".repeat(64)}` as Hex, category: "wifi" });

function setup() {
  const f = new FakeArkiv(T.eventStart - 10_000n);
  const store = memoryStore();
  const queue = new WriteQueue({
    store,
    reader: f,
    account: LEAD,
    writer: (onTxHash) => f.writer(LEAD, onTxHash),
  });
  return { f, store, queue };
}

describe("write queue", () => {
  it("journals, confirms and reads back a write", async () => {
    const { queue } = setup();
    const r = await queue.submit("Raise a Wi-Fi ticket", { creates: [ticket()] });
    expect(r.status).toBe("verified");
    expect(await queue.pending()).toEqual([]);
    expect((await queue.history())[0]).toMatchObject({ status: "verified", label: "Raise a Wi-Fi ticket" });
  });

  it("drops a wallet rejection with a message and no retry", async () => {
    const { f, queue } = setup();
    f.rejectNextRequest();
    const r = await queue.submit("Raise a ticket", { creates: [ticket()] });
    expect(r).toMatchObject({ status: "rejected", message: expect.stringMatching(/cancelled/) });
    expect(await queue.history()).toEqual([]);
  });

  it("keeps a lost response uncertain, blocks the next signature, then reconciles by hash", async () => {
    const { f, queue } = setup();
    f.loseNextResponse();
    const lost = await queue.submit("Raise a ticket", { creates: [ticket()] });
    expect(lost.status).toBe("uncertain");
    // The write did land; reconcile finds its receipt and only then allows the next write.
    const next = await queue.submit("Raise another", { creates: [ticket()] });
    expect(next.status).toBe("verified");
    const history = await queue.history();
    expect(history.map((i) => i.status)).toEqual(["confirmed", "verified"]);
    expect(
      (await f.query({ equals: { kind: { type: "str", value: "ticket" } } as never })).entities,
    ).toHaveLength(2);
  });

  it("treats a prepared intent without a hash as uncertain after a restart and never resends it", async () => {
    const { f, store } = setup();
    await store.set("queue:index", JSON.stringify(["x"]));
    await store.set(
      "queue:intent:x",
      JSON.stringify({
        id: "x",
        account: LEAD,
        label: "Clock in",
        status: "prepared",
        expectedCreates: 2,
        createdAtMs: 1,
      }),
    );
    const restarted = new WriteQueue({ store, reader: f, account: LEAD, writer: (h) => f.writer(LEAD, h) });
    const r = await restarted.submit("Raise a ticket", { creates: [ticket()] });
    expect(r).toMatchObject({ status: "blocked", message: expect.stringMatching(/Clock in/) });
    expect(
      (await f.query({ equals: { kind: { type: "str", value: "ticket" } } as never })).entities,
    ).toHaveLength(0);
    await restarted.dismiss("x");
    expect((await restarted.submit("Raise a ticket", { creates: [ticket()] })).status).toBe("verified");
  });

  it("serializes writes for one account and drops pre-send validation failures", async () => {
    const { f, queue } = setup();
    const order: string[] = [];
    await Promise.all([
      queue.submit("one", { creates: [ticket()] }).then(() => order.push("one")),
      queue.submit("two", { creates: [ticket()] }).then(() => order.push("two")),
    ]);
    expect(order).toEqual(["one", "two"]);
    const bad = await queue.submit("bad", {
      patches: [{ schema: ticket().schema, entityKey: `0x${"9".repeat(64)}` as Hex, set: {} }],
    });
    expect(bad.status).toBe("failed");
    expect(await queue.pending()).toEqual([]);
    expect(
      (await f.query({ equals: { kind: { type: "str", value: "ticket" } } as never })).entities,
    ).toHaveLength(2);
  });
});

describe("batch helpers", () => {
  it("clocks in with a duty pass in one batch, keys in order", async () => {
    const { f, queue } = setup();
    const r = await clockInWithPass(queue, ctx, {
      volunteer: "ravi.volunteers",
      shift: `0x${"2".repeat(64)}` as Hex,
      endsAt: T.eventStart + 3600n,
    });
    expect(r.status).toBe("verified");
    if (r.status !== "verified") return;
    const kinds = await Promise.all(
      r.created.map(async (k) => (await f.get(k))!.attributes.kind!.value.value),
    );
    expect(kinds).toEqual(["clock", "duty_pass"]);
  });

  it("replaces a shift in two confirmed steps, shows the pending gap and resumes without a second shift", async () => {
    const { f, queue, store } = setup();
    const old = `0x${"3".repeat(64)}` as Hex;
    const input = {
      oldShift: old,
      volunteer: "ravi.volunteers",
      zone: "west",
      startsAt: T.eventStart,
      endsAt: T.eventStart + 7200n,
      clockIn: true,
    };
    // Step 1 lands, then the volunteer's clock-in is declined in the wallet.
    let calls = 0;
    const declining = new WriteQueue({
      store,
      reader: f,
      account: LEAD,
      writer: (h) => {
        if (++calls === 2) f.rejectNextRequest();
        return f.writer(LEAD, h);
      },
    });
    const first = await replaceShift(declining, store, ctx, input);
    expect(first).toMatchObject({ status: "pending-clock-in", message: PENDING_CLOCK_IN });
    expect((await replacementState(store, ctx.edition, old))?.status).toBe("shift-confirmed");
    const resumed = await replaceShift(queue, store, ctx, input);
    expect(resumed).toMatchObject({ status: "complete", resumed: true });
    const shifts = (await f.query({ equals: { kind: { type: "str", value: "shift" } } as never })).entities;
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.attributes.supersedes!.value.value).toBe(old);
  });
});
