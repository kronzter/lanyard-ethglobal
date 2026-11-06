// Trusted authority references establish required evidence; unassigned judge ciphertext cannot.
import type { PreparedEnsEntry } from "@/shared/evidence/bundle";
import type { CapturedObservation } from "@/shared/evidence/observation";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import { authorityMatch, screen } from "./base";
import { rulesConfigOf } from "./config";
import { decodeRecord, ref, str } from "./decode";
import type { Engine } from "./engine";
import { judgeTrack } from "./kinds/judging";
import { EnsSnapshot } from "./snapshot";
import { TimeMap } from "./time";
export function assertRequiredEvidence(
  engine: Engine,
  records: readonly CapturedObservation[],
  entries: readonly PreparedEnsEntry[],
  context: EvaluationContext,
  frozen: unknown,
) {
  const config = rulesConfigOf(frozen, context.configHash);
  const ens = EnsSnapshot.from(entries);
  const time = TimeMap.fromEntries(entries);
  const keys = new Set(records.map((r) => r.key));
  for (const observation of records) {
    const s = screen(observation, context, engine.rules);
    if (!s.ok) continue;
    const r = s.record;
    if (r.obs.createdAtTimestamp >= config.times.judgingEnd) continue;
    const authority = authorityMatch(r, s.rule, config);
    if (!authority) continue;
    if (
      r.kind === "acceptance" &&
      authority.via === "authority" &&
      authority.authority === "organizer" &&
      config.tracks.some((t) => t.id === str(r, "track"))
    ) {
      const key = ref(r, "submission");
      if (key && !keys.has(key)) throw new Error(`Missing required submission evidence ${key}`);
    }
    if (r.kind !== "judge_assignment") continue;
    const judge = str(r, "judge");
    if (!judge) continue;
    const track = config.tracks.find((t) => judgeTrack(judge, t.partner));
    if (!track) continue;
    if (authority.via === "partner" && authority.partner !== track.partner) continue;
    if (authority.via === "authority" && authority.authority === "headJudge" && track.id !== "main") continue;
    const wrongTrack = ["submission", "rubric"].some((field) => {
      const source = records.find((o) => o.key === ref(r, field));
      if (!source) return false;
      const decoded = decodeRecord(source);
      return decoded.ok && str(decoded.record, "track") !== track.id;
    });
    if (wrongTrack) continue;
    const block = time.blockAt(r.obs.createdAtTimestamp);
    const expiry = ens.expiry(judge, block);
    if (!ens.owner(judge, block) || expiry === null || expiry <= r.obs.createdAtTimestamp) continue;
    for (const field of ["submission", "rubric"]) {
      const key = ref(r, field);
      if (key && !keys.has(key)) throw new Error(`Missing required ${field} evidence ${key}`);
    }
  }
}
