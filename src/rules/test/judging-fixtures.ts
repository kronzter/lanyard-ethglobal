import { bytesToHex } from "viem";
import { canonicalBytes } from "@/shared/canonical";
import { submissionSnapshot } from "@/arkiv/writers";
import { key, obs, persona } from "./harness";

export const AT = 9_022_000n;
const lead = persona("zkpay-a");
const org = persona("organizer");
export const content = {
  page: {
    title: "ZK Pay",
    description: "Private payments",
    members: ["Person A"],
    links: { ethglobal: "https://ethglobal.com/showcase/zkpay" },
  },
};
export function submission(at = AT, extra: Partial<Parameters<typeof obs>[0]> = {}) {
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
export function rubric(
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
export function dependencies() {
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
