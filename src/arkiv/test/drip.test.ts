import { addr } from "@arkiv-network/sdk/schema";
import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import { drip, findDrips, forgetDripIntent, type DripDeps } from "../drip";
import { FakeArkiv } from "../fake";
import { APP, KINDS } from "../kinds";
import { memoryStore } from "../store";

const DESK = "0x6f383cb1a6770386c81e66ea0373436280ad6e16" as const;
const NEWBIE = "0x00000000000000000000000000000000000000c3" as const;
const STRANGER = "0x00000000000000000000000000000000000000d4" as const;
const WEI = 500_000_000_000_000_000n;

function setup(deskAccount: `0x${string}` = DESK) {
  // The fake's clock starts just before the event so retention deadlines lie in the future.
  const f = new FakeArkiv(eventConfig.times.eventStart - 10_000n);
  f.fund(DESK, 25n * 10n ** 18n);
  const journal = memoryStore();
  const deps: DripDeps = {
    reader: f,
    desk: f.writer(deskAccount),
    deskWallet: DESK,
    dripWei: WEI,
    edition: eventConfig.edition,
    times: eventConfig.times,
    journal,
    pollMs: 0,
    receiptTimeoutMs: 0,
    sleep: async () => {},
  };
  return { f, deps, journal };
}

describe("desk drip", () => {
  it("sends the configured amount once and writes a readonly drip record from the desk wallet", async () => {
    const { f, deps } = setup();
    const out = await drip(deps, NEWBIE);
    expect(out.status).toBe("sent");
    expect(await f.balance(NEWBIE)).toBe(WEI);
    const [rec] = await findDrips(f, DESK, eventConfig.edition, NEWBIE);
    expect(rec!.creator).toBe(DESK);
    expect(rec!.flags.readonly).toBe(true);
    expect(rec!.attributes.by_label!.value.value).toBe("desk");
    expect(rec!.attributes.tx!.value.value).toBe(out.status === "sent" && out.txHash);
  });

  it("refuses a second drip before sending anything, even with a fresh journal", async () => {
    const { f, deps } = setup();
    await drip(deps, NEWBIE);
    const again = await drip({ ...deps, journal: memoryStore() }, NEWBIE.toUpperCase().replace("0X", "0x"));
    expect(again).toMatchObject({ status: "refused", reason: "already-dripped" });
    expect(await f.balance(NEWBIE)).toBe(WEI);
  });

  it("ignores a drip record written by any wallet other than the desk", async () => {
    const { f, deps } = setup();
    await f.writer(STRANGER).write({
      creates: [
        {
          schema: KINDS.drip.schema,
          values: {
            app: APP,
            event: eventConfig.edition,
            kind: "drip",
            by_label: "desk",
            recipient: addr(NEWBIE),
            tx: "0xforged",
          } as never,
          expiration: KINDS.drip.retention(eventConfig.times),
          flags: KINDS.drip.flags,
        },
      ],
    });
    expect((await drip(deps, NEWBIE)).status).toBe("sent");
  });

  it("refuses wallets other than the configured desk wallet, invalid addresses and itself", async () => {
    expect(await drip(setup(STRANGER).deps, NEWBIE)).toMatchObject({
      status: "refused",
      reason: "not-desk-wallet",
    });
    expect(await drip(setup().deps, "0x1234")).toMatchObject({
      status: "refused",
      reason: "invalid-address",
    });
    expect(await drip(setup().deps, DESK)).toMatchObject({ status: "refused", reason: "self" });
  });

  it("drops a transfer the desk wallet declines, with no retry", async () => {
    const { f, deps, journal } = setup();
    f.rejectNextRequest();
    expect((await drip(deps, NEWBIE)).status).toBe("rejected");
    expect(journal.dump()).toEqual({});
    expect(await f.balance(NEWBIE)).toBe(0n);
  });

  it("reconciles an uncertain transfer by its hash instead of sending again", async () => {
    const { f, deps } = setup();
    f.holdNextTransfer();
    const first = await drip(deps, NEWBIE);
    expect(first.status).toBe("uncertain");
    const pending = await drip(deps, NEWBIE);
    expect(pending.status).toBe("uncertain"); // still no receipt: refuse to send again
    f.mineHeld();
    const resumed = await drip(deps, NEWBIE);
    expect(resumed).toMatchObject({ status: "sent", resumed: true });
    expect(await f.balance(NEWBIE)).toBe(WEI); // exactly one transfer
  });

  it("writes only the missing record when the record write was declined after the transfer", async () => {
    const { f, deps } = setup();
    const desk = deps.desk;
    let declineRecord = true;
    deps.desk = {
      ...desk,
      write: async (b) => {
        if (declineRecord) {
          declineRecord = false;
          f.rejectNextRequest();
        }
        return desk.write(b);
      },
    };
    expect((await drip(deps, NEWBIE)).status).toBe("uncertain");
    expect(await drip(deps, NEWBIE)).toMatchObject({ status: "sent", resumed: true });
    expect(await f.balance(NEWBIE)).toBe(WEI);
  });

  it("never resends a prepared intent without a hash until the operator clears it", async () => {
    const { deps, journal } = setup();
    await journal.set(`drip:${eventConfig.edition}:${NEWBIE}`, JSON.stringify({ status: "prepared" }));
    expect((await drip(deps, NEWBIE)).status).toBe("uncertain");
    await forgetDripIntent(journal, eventConfig.edition, NEWBIE);
    expect((await drip(deps, NEWBIE)).status).toBe("sent");
  });
});
