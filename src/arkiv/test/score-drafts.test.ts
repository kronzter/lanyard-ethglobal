import { describe, expect, it } from "vitest";
import { ScoreDrafts, type DraftContext } from "../score-drafts";
import { memoryStore } from "../store";
const h = (v: string) => `0x${v.repeat(64)}` as `0x${string}`;
const context: DraftContext = {
  chainId: 7794095,
  resetId: h("1"),
  event: "mumbai2026",
  wallet: `0x${"12".repeat(20)}`,
  submission: h("2"),
  assignment: h("3"),
  rubric: h("4"),
  keyId: "x25519:test",
};
describe("device-local scores", () => {
  it("restores after restart and keeps missing values absent", async () => {
    const store = memoryStore();
    await new ScoreDrafts(store).save(context, { impact: 750 });
    expect(await new ScoreDrafts(store).load(context)).toEqual({ impact: 750 });
  });
  it("isolates every context coordinate and requires re-entry after storage loss", async () => {
    const store = memoryStore();
    const drafts = new ScoreDrafts(store);
    await drafts.save(context, { impact: 750 });
    for (const changed of [
      { wallet: `0x${"34".repeat(20)}` },
      { event: "other" },
      { chainId: 1 },
      { resetId: h("5") },
      { submission: h("6") },
      { assignment: h("7") },
      { rubric: h("8") },
      { keyId: "other" },
    ])
      expect(await drafts.load({ ...context, ...changed } as DraftContext)).toBeNull();
    expect(await new ScoreDrafts(memoryStore()).load(context)).toBeNull();
  });
  it("does not report success for failed durable writes", async () => {
    const store = memoryStore();
    store.set = async () => {
      throw new Error("quota exceeded");
    };
    await expect(new ScoreDrafts(store).save(context, { impact: 750 })).rejects.toThrow("quota exceeded");
  });
});
