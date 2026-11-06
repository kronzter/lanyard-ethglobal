// Raw weighted means stay rational until display. No numeric preview exists before decryption.
import type { Hex } from "@/shared/types/primitives";
import type { RulesConfig } from "./config";
import { ref, str, type DecodedRecord } from "./decode";
import { payload, RubricSchema } from "./kinds/judging";
import type { RulesOutput } from "./types";
export type RankedProject = {
  submission: Hex;
  team: string;
  judgeCount: number;
  spread: boolean;
  rank?: number;
  numerator?: bigint;
  denominator?: bigint;
  displayHundredths?: bigint;
};
export type TrackRanking = { track: string; projects: RankedProject[] };
export function aggregateRankings(
  records: readonly DecodedRecord[],
  output: RulesOutput,
  config: RulesConfig,
): TrackRanking[] | undefined {
  if (!output.scores) return undefined;
  const counted = new Set(output.verdicts.filter((v) => v.counts).map((v) => v.key));
  const sources = new Map(records.map((r) => [r.key, r]));
  const values = new Map(
    output.scores.filter((s) => s.values && counted.has(s.key)).map((s) => [s.key, s.values!]),
  );
  const compareSubmission = (a: RankedProject, b: RankedProject) => {
    const ra = sources.get(a.submission)!;
    const rb = sources.get(b.submission)!;
    return ra.obs.createdAtBlock < rb.obs.createdAtBlock
      ? -1
      : ra.obs.createdAtBlock > rb.obs.createdAtBlock
        ? 1
        : a.submission < b.submission
          ? -1
          : a.submission > b.submission
            ? 1
            : 0;
  };
  return config.tracks.map((track) => {
    const projects = records
      .filter(
        (s) =>
          s.kind === "submission" &&
          str(s, "track") === track.id &&
          counted.has(s.key) &&
          records.some(
            (a) => a.kind === "acceptance" && counted.has(a.key) && ref(a, "submission") === s.key,
          ),
      )
      .map((s) => {
        const entry: RankedProject = {
          submission: s.key,
          team: str(s, "team")!,
          judgeCount: 0,
          spread: false,
        };
        const finals = records.filter(
          (f) =>
            f.kind === "final_score" &&
            ref(f, "submission") === s.key &&
            counted.has(f.key) &&
            values.has(f.key),
        );
        if (!finals.length) return entry;
        const rubric = RubricSchema.parse(payload(sources.get(ref(finals[0]!, "rubric")!)!, "payload"));
        const weights = rubric.criteria.reduce((n, c) => n + BigInt(c.weight), 0n);
        const totals = finals.map((f) =>
          rubric.criteria.reduce((n, c) => n + BigInt(values.get(f.key)![c.id]!) * BigInt(c.weight), 0n),
        );
        const numerator = totals.reduce((a, b) => a + b, 0n);
        const denominator = BigInt(finals.length) * weights;
        const low = totals.reduce((a, b) => (a < b ? a : b));
        const high = totals.reduce((a, b) => (a > b ? a : b));
        return {
          ...entry,
          judgeCount: finals.length,
          numerator,
          denominator,
          displayHundredths: numerator / denominator,
          spread: finals.length > 1 && (high - low) * 100n > 30n * weights * BigInt(rubric.scale * 100),
        };
      })
      .sort((a, b) => {
        if (a.judgeCount && b.judgeCount) {
          const delta = a.numerator! * b.denominator! - b.numerator! * a.denominator!;
          if (delta) return delta > 0n ? -1 : 1;
        } else if (a.judgeCount !== b.judgeCount) return a.judgeCount ? -1 : 1;
        return compareSubmission(a, b);
      })
      .map((p, i) => (p.judgeCount ? { ...p, rank: i + 1 } : p));
    return { track: track.id, projects };
  });
}
