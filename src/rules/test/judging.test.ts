import { describe, expect, it } from "vitest";
import { bytesToHex } from "viem";
import { canonicalBytes } from "@/shared/canonical";
import { submissionSnapshot } from "@/arkiv/writers";
import { context, key, obs, persona, run, timeline } from "./harness";

const AT = 9_022_000n;
const lead = persona("zkpay-a");
const org = persona("organizer");
const content = {
  page: {
    title: "ZK Pay",
    description: "Private payments",
    members: ["Person A"],
    links: { ethglobal: "https://ethglobal.com/showcase/zkpay" },
  },
};
function submission(at = AT, extra: Partial<Parameters<typeof obs>[0]> = {}) {
  const sealed = submissionSnapshot({
    project: key(999n),
    team: "zkpay",
    track: "main",
    lead: lead.address,
    content,
  });
  return obs({
    kind: "submission",
    creator: lead.address,
    byLabel: "zkpay",
    at,
    flags: { readonly: true, permissionlessExtension: true },
    attrs: {
      project: ["key", key(999n)],
      team: ["str", "zkpay"],
      track: ["str", "main"],
      snapshot: ["bytes", bytesToHex(sealed.bytes)],
      content_hash: ["str", sealed.contentHash],
    },
    ...extra,
  });
}
function rubric(
  at = AT - 2n,
  track = "main",
  payload: unknown = { criteria: [{ id: "impact", name: "Impact", weight: 2 }], scale: 10 },
) {
  return obs({
    kind: "rubric",
    creator: org.address,
    byLabel: "organizer",
    at,
    attrs: { track: ["str", track], payload: ["bytes", bytesToHex(canonicalBytes(payload))] },
  });
}
function dependencies() {
  const s = submission();
  const r = rubric();
  const a = obs({
    kind: "acceptance",
    creator: org.address,
    byLabel: "organizer",
    at: AT + 1n,
    attrs: { submission: ["key", s.key], track: ["str", "main"] },
  });
  const assignment = (judge = "gita.judges", creator = org.address) =>
    obs({
      kind: "judge_assignment",
      creator,
      byLabel: "organizer",
      at: AT + 2n,
      attrs: { submission: ["key", s.key], rubric: ["key", r.key], judge: ["str", judge] },
    });
  return { s, r, a, assignment };
}
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
