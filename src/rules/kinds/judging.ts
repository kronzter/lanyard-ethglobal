// Immutable judging dependencies. All selection uses retained evidence order.
import { z } from "zod";
import { canonicalHash, canonicalJson, parseJsonStrict } from "@/shared/canonical";
import { isTeamLabel, isCanonicalLabel } from "@/shared/labels";
import { Bytes32Schema, AddressSchema } from "@/shared/types/primitives";
import { TeamPageContentSchema } from "@/shared/types/team-page";
import { bytes, ref, str, type DecodedRecord } from "../decode";
import { ok, reject, type KindRule, type RuleCtx } from "../types";

const RO = { readonly: true, permissionlessExtension: false } as const;
export const RubricSchema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            weight: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .min(1),
    scale: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length, "duplicate criteria");
export const SubmissionSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: Bytes32Schema,
    team: z.string().refine(isTeamLabel),
    track: z.string(),
    lead: AddressSchema,
    content: z
      .object({
        page: TeamPageContentSchema.refine((p) => p.links.ethglobal !== undefined),
        details: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export function payload(r: DecodedRecord, field: string): unknown {
  const h = bytes(r, field);
  if (h === undefined) return undefined;
  try {
    const b = Uint8Array.from(h.slice(2).match(/../g) ?? [], (x) => parseInt(x, 16));
    return parseJsonStrict(new TextDecoder("utf-8", { fatal: true }).decode(b));
  } catch {
    return undefined;
  }
}
export const submissionContent = (r: DecodedRecord) => SubmissionSchema.safeParse(payload(r, "snapshot"));
const earlier = (ctx: RuleCtx, kind: string, same: (r: DecodedRecord) => boolean) =>
  ctx.records.some((r) => r.kind === kind && ctx.verdictOf(r.key)?.counts && same(r));
const dependency = (r: DecodedRecord, field: string, kind: string, ctx: RuleCtx) =>
  ctx.records.find((x) => x.key === ref(r, field) && x.kind === kind && ctx.verdictOf(x.key)?.counts);
const track = (ctx: RuleCtx, id: string | undefined) => ctx.config.tracks.find((t) => t.id === id);
export const judgeTrack = (label: string, partner: string | null) =>
  isCanonicalLabel(label) &&
  (partner === null
    ? /^[^.]+\.judges$/.test(label)
    : label.endsWith(`.judges.${partner}.partners`) && label.split(".").length === 5);

export const submission: KindRule = {
  flags: { readonly: true, permissionlessExtension: true },
  writers: [{ via: "badge", applies: isTeamLabel, describe: "the team lead" }],
  check(r, ctx) {
    if (r.obs.createdAtTimestamp >= ctx.config.times.submissionDeadline)
      return reject("submission deadline reached");
    const parsed = submissionContent(r);
    if (!parsed.success) return reject("invalid immutable submission snapshot");
    const s = parsed.data;
    if (
      s.team !== r.byLabel ||
      s.team !== str(r, "team") ||
      s.track !== str(r, "track") ||
      s.project !== ref(r, "project") ||
      s.lead !== r.creator
    )
      return reject("submission snapshot context mismatch");
    if (!track(ctx, s.track)) return reject("unknown submission track");
    if (
      canonicalHash(s) !== str(r, "content_hash") ||
      canonicalJson(payload(r, "snapshot")) !== canonicalJson(s)
    )
      return reject("submission content hash mismatch");
    if (earlier(ctx, "submission", (x) => str(x, "team") === s.team))
      return reject("duplicate submission: earliest valid captured submission counts");
    return ok;
  },
};
export const rubric: KindRule = {
  flags: RO,
  writers: [{ via: "authority", authority: "organizer" }, { via: "partner" }],
  check(r, ctx) {
    const t = track(ctx, str(r, "track"));
    if (!t) return reject("rubric names unknown track");
    if (ctx.writer.via === "partner" && t.partner !== ctx.writer.partner)
      return reject("partner may only write its own track's rubric");
    if (r.obs.createdAtTimestamp >= ctx.config.times.submissionDeadline)
      return reject("rubric deadline reached");
    if (!RubricSchema.safeParse(payload(r, "payload")).success)
      return reject("invalid rubric criteria, weights or scale");
    if (earlier(ctx, "rubric", (x) => str(x, "track") === t.id))
      return reject("later rubric: earliest valid captured rubric is frozen");
    return ok;
  },
};
export const acceptance: KindRule = {
  flags: RO,
  writers: [{ via: "authority", authority: "organizer" }],
  check(r, ctx) {
    if (!track(ctx, str(r, "track"))) return reject("acceptance names unknown track");
    const s = dependency(r, "submission", "submission", ctx);
    return s && str(s, "track") === str(r, "track")
      ? ok
      : reject("acceptance requires a counted submission in the same track");
  },
};
export const judge_assignment: KindRule = {
  flags: RO,
  writers: [
    { via: "authority", authority: "organizer" },
    { via: "partner" },
    { via: "authority", authority: "headJudge" },
  ],
  reads: ({ record, creationBlock }) => {
    const label = str(record, "judge");
    return label && isCanonicalLabel(label)
      ? [
          { query: "owner", label, block: creationBlock },
          { query: "expiry", label, block: creationBlock },
        ]
      : [];
  },
  check(r, ctx) {
    if (r.obs.createdAtTimestamp >= ctx.config.times.judgingEnd) return reject("judging deadline reached");
    const s = dependency(r, "submission", "submission", ctx);
    const rubric = dependency(r, "rubric", "rubric", ctx);
    if (!s || !rubric || str(s, "track") !== str(rubric, "track"))
      return reject("assignment requires counted submission and frozen rubric in the same track");
    if (!earlier(ctx, "acceptance", (a) => ref(a, "submission") === s.key))
      return reject("submission is not accepted");
    const t = track(ctx, str(s, "track"))!;
    if (ctx.writer.via === "partner" && t.partner !== ctx.writer.partner)
      return reject("partner cannot assign another track");
    if (ctx.writer.via === "authority" && ctx.writer.authority === "headJudge" && t.id !== "main")
      return reject("head judge may assign main only");
    const judge = str(r, "judge");
    if (!judge || !judgeTrack(judge, t.partner)) return reject("judge badge does not match track");
    const expiry = ctx.ens.expiry(judge, ctx.creationBlock);
    return ctx.ens.owner(judge, ctx.creationBlock) && expiry !== null && expiry > r.obs.createdAtTimestamp
      ? ok
      : reject("assigned judge is not registered and unexpired");
  },
};
