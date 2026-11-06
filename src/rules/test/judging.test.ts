import { describe, expect, it } from "vitest";
import { context, key, persona, run, timeline } from "./harness";
import { AT, content, submission, rubric, dependencies } from "./judging-fixtures";
describe("immutable judging inputs", () => {
  it("accepts the team owner's immutable snapshot without needing a mutable project", async () => {
    const s = submission();
    const result = await run([s]);
    expect(result.verdict(s).counts).toBe(true);
    content.page.description = "Edited draft";
    expect((await run([s])).output).toEqual(result.output);
  });
  it("rejects members who do not own the team name", async () => {
    const s = submission(AT, { creator: persona("zkpay-b").address });
    expect((await run([s])).verdict(s).counts).toBe(false);
  });
  it("keeps the earliest valid captured submission and shows duplicates regardless of input order", async () => {
    const first = submission();
    const later = submission(AT + 1n);
    const a = await run([later, first]);
    const b = await run([first, later]);
    expect(a.output).toEqual(b.output);
    expect(a.verdict(first).counts).toBe(true);
    expect(a.verdict(later).reason).toMatch(/duplicate submission/);
    expect((await run([first, later])).verdict(first).counts).toBe(true);
  });
  it("rejects at the submission deadline and later", async () => {
    for (const at of [
      timeline.times.submissionDeadline.block,
      timeline.times.submissionDeadline.block + 1n,
    ]) {
      const s = submission(at);
      expect((await run([s])).verdict(s).reason).toMatch(/deadline/);
    }
  });
  it("rejects a modified content commitment", async () => {
    const s = submission();
    s.attributes.find((a) => a.name === "content_hash")!.value = key(123n);
    expect((await run([s])).verdict(s).reason).toMatch(/hash mismatch/);
  });
  it("freezes earliest valid rubric, rejecting malformed weights and duplicate criteria", async () => {
    const bad = rubric(AT - 3n, "main", { criteria: [{ id: "a", name: "A", weight: 0 }], scale: 10 });
    const first = rubric();
    const later = rubric(AT - 1n);
    const result = await run([later, bad, first]);
    expect(result.verdict(bad).counts).toBe(false);
    expect(result.verdict(first).counts).toBe(true);
    expect(result.verdict(later).reason).toMatch(/later rubric/);
  });
  it("requires accepted submissions and matching judge tracks", async () => {
    const { s, r, a, assignment } = dependencies();
    const good = assignment();
    const wrong = assignment("ana.judges.arkiv.partners");
    const result = await run([s, r, a, good, wrong]);
    expect(result.verdict(a).counts).toBe(true);
    expect(result.verdict(good).counts).toBe(true);
    expect(result.verdict(wrong).reason).toMatch(/match track/);
    expect((await run([s, r, good])).verdict(good).reason).toMatch(/not accepted/);
  });
  it("allows the configured head judge to assign main and rejects partner authorities", async () => {
    const { s, r, a, assignment } = dependencies();
    const head = assignment("gita.judges", persona("head-judge").address);
    const partner = assignment("gita.judges", persona("partner-arkiv").address);
    const result = await run([s, r, a, head, partner]);
    expect(result.verdict(head).counts).toBe(true);
    expect(result.verdict(partner).reason).toMatch(/another track/);
    expect(result.output.configHash).toEqual(context().configHash);
  });
});
