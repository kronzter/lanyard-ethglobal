// One writer per record kind (B1.2-R1–R4). Each returns SDK create parameters with the four common
// attributes, the kind's creation flags and its retention, after rejecting anything Arkiv would
// refuse or that would lose evidence: non-canonical labels, strings over 128 bytes, payloads over
// 128 KiB, and retention that is already over or longer than MAX_LIFETIME. Nothing here sends;
// writes go through an ArkivWriter (one batch = one wallet approval).
import {
  ExpirationTime,
  MAX_ATTRIBUTES,
  MAX_BYTES_LENGTH,
  MAX_LIFETIME,
  MAX_STRING_BYTES,
  type CreateEntityParameters,
  type Expiry,
} from "@arkiv-network/sdk";
import { addr, key, u64 } from "@arkiv-network/sdk/schema";
import { canonicalBytes, canonicalHash } from "@/shared/canonical";
import type { EventTimes } from "@/shared/config/schema";
import { isCanonicalLabel } from "@/shared/labels";
import {
  requireEthglobalForSeal,
  validateTeamPageContent,
  type TeamPageContent,
} from "@/shared/types/team-page";
import { isAddress, isHex, type Address, type Hex } from "@/shared/types/primitives";
import type { BlockRef, StoredEntity } from "./api";
import { APP, KINDS, type Kind } from "./kinds";

export const BLOCK_SECONDS = 2n;

export type WriteRejectReason =
  | "label"
  | "string-too-long"
  | "payload-too-large"
  | "retention-over"
  | "retention-too-long"
  | "earlier-expiry"
  | "invalid";

export class WriteRejected extends Error {
  constructor(
    readonly reason: WriteRejectReason,
    detail: string,
  ) {
    super(`not sent (${reason}): ${detail}`);
    this.name = "WriteRejected";
  }
}

/** Who writes and when: the writer's relative label, the edition and the chain head if known. */
export type WriteContext = {
  edition: string;
  /** The writer's relative ENS label (`priya.volunteers`) or an authority persona (`organizer`). */
  byLabel: string;
  times: EventTimes;
  /** The current head; when given, retention is checked against it before sending. */
  head?: BlockRef;
};

/** The project's editable content: the public team page plus free-form details. */
export type ProjectContent = { page: TeamPageContent; details?: Record<string, string> };

export type RubricCriterion = { id: string; name: string; weight: number };
export type Rubric = { criteria: RubricCriterion[]; scale: number };

export type KindInputs = {
  venue: { version: string; venue: unknown };
  seat_assignment: { hackerAddress: Address; hackerLabel: string; seat: string; venue: Hex };
  shift: { volunteer: string; zone: string; startsAt: bigint; endsAt: bigint; supersedes?: Hex };
  clock: { volunteer: string; shift: Hex; action: "in" | "out"; statedAt?: bigint };
  duty_pass: { volunteer: string; shift: Hex; endsAt: bigint };
  ticket: { seat: string; venue: Hex; category: string };
  ticket_claim: { ticket: Hex };
  ticket_resolution: { ticket: Hex; claim: Hex; seat: string };
  ticket_confirmation: { ticket: Hex; resolution: Hex };
  project: { team: string; track: string; content: ProjectContent };
  submission: { project: Hex; team: string; track: string; lead: Address; content: ProjectContent };
  acceptance: { submission: Hex; track: string };
  rubric: { track: string; rubric: Rubric };
  judge_assignment: { judge: string; submission: Hex; rubric: Hex };
  score_sheet: { submission: Hex; judge: string; rubric: Hex; assignment: Hex; ciphertext: Hex };
  final_score: { submission: Hex; judge: string; rubric: Hex; assignment: Hex; ciphertext: Hex };
  recusal: { submission: Hex; judge: string };
  results: { summary: unknown };
  drip: { recipient: Address; tx: Hex };
};

const utf8 = (s: string) => new TextEncoder().encode(s).length;
const reject = (reason: WriteRejectReason, detail: string): never => {
  throw new WriteRejected(reason, detail);
};

function checkLabel(name: string, value: string) {
  if (!isCanonicalLabel(value)) reject("label", `${name} "${value}" is not a canonical ENS label`);
}
const ref = (name: string, value: Hex) => {
  if (!isHex(value, 32)) reject("invalid", `${name} must be a 32-byte record key`);
  return key(value.toLowerCase() as Hex);
};
const bytesOf = (name: string, data: Uint8Array) => {
  if (data.length > MAX_BYTES_LENGTH)
    reject("payload-too-large", `${name} is ${data.length} bytes > ${MAX_BYTES_LENGTH}`);
  return data;
};
const hexBytes = (name: string, h: Hex) => {
  if (!isHex(h)) reject("invalid", `${name} must be 0x hex`);
  const body = h.slice(2);
  return bytesOf(name, new Uint8Array((body.match(/../g) ?? []).map((b) => parseInt(b, 16))));
};
const nonEmpty = (name: string, v: string) => {
  if (v.trim() === "") reject("invalid", `${name} is empty`);
  return v;
};

/** The canonical immutable snapshot a submission seals, and the hash that binds it (B4.1-R8). */
export function submissionSnapshot(input: KindInputs["submission"]) {
  if (!isAddress(input.lead)) reject("invalid", "lead must be an address");
  const page = requireEthglobalForSeal(validateTeamPageContent(input.content.page));
  const snapshot = {
    schemaVersion: 1,
    project: input.project.toLowerCase(),
    team: input.team,
    track: input.track,
    lead: input.lead.toLowerCase(),
    content: { page, details: input.content.details ?? {} },
  };
  return { snapshot, bytes: canonicalBytes(snapshot), contentHash: canonicalHash(snapshot) };
}

/** Rubric checks from B4.1-R9: unique criteria, positive integer weights, a bounded scale. */
export function validateRubric(r: Rubric): Rubric {
  if (r.criteria.length === 0) reject("invalid", "a rubric needs at least one criterion");
  if (new Set(r.criteria.map((c) => c.id)).size !== r.criteria.length)
    reject("invalid", "criterion ids must be unique");
  if (!r.criteria.every((c) => Number.isSafeInteger(c.weight) && c.weight > 0))
    reject("invalid", "weights must be positive integers");
  if (!Number.isSafeInteger(r.scale) || r.scale < 1 || r.scale > 100)
    reject("invalid", "scale must be an integer 1–100");
  return r;
}

/** The kind-specific values, before the common attributes are added. */
function kindValues<K extends Kind>(kind: K, input: KindInputs[K]): Record<string, unknown> {
  switch (kind) {
    case "venue": {
      const v = input as KindInputs["venue"];
      return { version: nonEmpty("version", v.version), payload: bytesOf("venue", canonicalBytes(v.venue)) };
    }
    case "seat_assignment": {
      const v = input as KindInputs["seat_assignment"];
      if (!isAddress(v.hackerAddress)) reject("invalid", "hackerAddress must be an address");
      checkLabel("hackerLabel", v.hackerLabel);
      return {
        hacker_address: addr(v.hackerAddress.toLowerCase() as Address),
        hacker_label: v.hackerLabel,
        seat: nonEmpty("seat", v.seat),
        venue: ref("venue", v.venue),
      };
    }
    case "shift": {
      const v = input as KindInputs["shift"];
      checkLabel("volunteer", v.volunteer);
      if (v.endsAt <= v.startsAt) reject("invalid", "a shift must end after it starts");
      return {
        volunteer: v.volunteer,
        zone: nonEmpty("zone", v.zone),
        starts_at: u64(v.startsAt),
        ends_at: u64(v.endsAt),
        ...(v.supersedes ? { supersedes: ref("supersedes", v.supersedes) } : {}),
      };
    }
    case "clock": {
      const v = input as KindInputs["clock"];
      checkLabel("volunteer", v.volunteer);
      if (v.action !== "in" && v.action !== "out") reject("invalid", "action must be in or out");
      return {
        volunteer: v.volunteer,
        shift: ref("shift", v.shift),
        action: v.action,
        ...(v.statedAt !== undefined ? { stated_at: u64(v.statedAt) } : {}),
      };
    }
    case "duty_pass": {
      const v = input as KindInputs["duty_pass"];
      checkLabel("volunteer", v.volunteer);
      return { volunteer: v.volunteer, shift: ref("shift", v.shift), ends_at: u64(v.endsAt) };
    }
    case "ticket": {
      const v = input as KindInputs["ticket"];
      return {
        seat: nonEmpty("seat", v.seat),
        venue: ref("venue", v.venue),
        category: nonEmpty("category", v.category),
      };
    }
    case "ticket_claim":
      return { ticket: ref("ticket", (input as KindInputs["ticket_claim"]).ticket) };
    case "ticket_resolution": {
      const v = input as KindInputs["ticket_resolution"];
      return {
        ticket: ref("ticket", v.ticket),
        claim: ref("claim", v.claim),
        seat: nonEmpty("seat", v.seat),
      };
    }
    case "ticket_confirmation": {
      const v = input as KindInputs["ticket_confirmation"];
      return { ticket: ref("ticket", v.ticket), resolution: ref("resolution", v.resolution) };
    }
    case "project": {
      const v = input as KindInputs["project"];
      checkLabel("team", v.team);
      const page = validateTeamPageContent(v.content.page);
      return {
        team: v.team,
        track: nonEmpty("track", v.track),
        content: bytesOf("content", canonicalBytes({ page, details: v.content.details ?? {} })),
      };
    }
    case "submission": {
      const v = input as KindInputs["submission"];
      checkLabel("team", v.team);
      const s = submissionSnapshot(v);
      return {
        project: ref("project", v.project),
        team: v.team,
        track: nonEmpty("track", v.track),
        content_hash: s.contentHash,
        snapshot: bytesOf("snapshot", s.bytes),
      };
    }
    case "acceptance": {
      const v = input as KindInputs["acceptance"];
      return { submission: ref("submission", v.submission), track: nonEmpty("track", v.track) };
    }
    case "rubric": {
      const v = input as KindInputs["rubric"];
      return {
        track: nonEmpty("track", v.track),
        payload: bytesOf("rubric", canonicalBytes(validateRubric(v.rubric))),
      };
    }
    case "judge_assignment": {
      const v = input as KindInputs["judge_assignment"];
      checkLabel("judge", v.judge);
      return { judge: v.judge, submission: ref("submission", v.submission), rubric: ref("rubric", v.rubric) };
    }
    case "score_sheet":
    case "final_score": {
      const v = input as KindInputs["final_score"];
      checkLabel("judge", v.judge);
      return {
        submission: ref("submission", v.submission),
        judge: v.judge,
        rubric: ref("rubric", v.rubric),
        assignment: ref("assignment", v.assignment),
        ciphertext: hexBytes("ciphertext", v.ciphertext),
      };
    }
    case "recusal": {
      const v = input as KindInputs["recusal"];
      checkLabel("judge", v.judge);
      return { submission: ref("submission", v.submission), judge: v.judge };
    }
    case "results":
      return { summary: bytesOf("summary", canonicalBytes((input as KindInputs["results"]).summary)) };
    case "drip": {
      const v = input as KindInputs["drip"];
      if (!isAddress(v.recipient)) reject("invalid", "recipient must be an address");
      if (!isHex(v.tx, 32)) reject("invalid", "tx must be a transaction hash");
      return { recipient: addr(v.recipient.toLowerCase() as Address), tx: v.tx.toLowerCase() };
    }
  }
  return reject("invalid", `unknown kind ${String(kind)}`);
}

/** Check a retention deadline against the head: still ahead, and within MAX_LIFETIME blocks. */
export function checkRetention(kind: Kind, times: EventTimes, head: BlockRef): void {
  const until = KINDS[kind].retention.until?.(times);
  if (until === undefined) return; // `maximum` is always valid
  if (until <= head.timestamp) reject("retention-over", `${kind} retention ended at ${until}`);
  const blocks = (until - head.timestamp + BLOCK_SECONDS - 1n) / BLOCK_SECONDS;
  if (blocks > MAX_LIFETIME)
    reject("retention-too-long", `${kind} would need ${blocks} blocks > ${MAX_LIFETIME}`);
}

/** Build the create parameters for one record of `kind`. Throws WriteRejected before any send. */
export function buildCreate<K extends Kind>(
  kind: K,
  ctx: WriteContext,
  input: KindInputs[K],
): CreateEntityParameters {
  checkLabel("by_label", ctx.byLabel);
  if (ctx.head) checkRetention(kind, ctx.times, ctx.head);
  const values: Record<string, unknown> = {
    app: APP,
    event: ctx.edition,
    kind,
    by_label: ctx.byLabel,
    ...kindValues(kind, input),
  };
  for (const [name, v] of Object.entries(values)) {
    const s =
      typeof v === "string"
        ? v
        : (v as { type?: string; value?: unknown }).type === "str"
          ? String((v as { value: unknown }).value)
          : null;
    if (s !== null && utf8(s) > MAX_STRING_BYTES)
      reject("string-too-long", `${name} is ${utf8(s)} bytes > ${MAX_STRING_BYTES}`);
  }
  if (Object.keys(values).length > MAX_ATTRIBUTES)
    reject("invalid", `more than ${MAX_ATTRIBUTES} attributes`);
  const def = KINDS[kind];
  return {
    schema: def.schema,
    values: values as never,
    expiration: def.retention.at(ctx.times),
    flags: def.flags,
  };
}

/**
 * An extension that keeps a record longer. Rejects before sending when it would not move the
 * expiry later, judged against the head at 2-second blocks (the chain re-checks it exactly).
 */
export function buildExtension(
  entity: StoredEntity,
  untilUnix: bigint,
  head: BlockRef,
): { entityKey: Hex; expiration: Expiry } {
  if (untilUnix <= head.timestamp) reject("earlier-expiry", "the new deadline is already over");
  const target = head.number + (untilUnix - head.timestamp + BLOCK_SECONDS - 1n) / BLOCK_SECONDS;
  if (target <= entity.expiresAt)
    reject("earlier-expiry", `${entity.key} already expires at block ${entity.expiresAt}`);
  if (target - head.number > MAX_LIFETIME)
    reject("retention-too-long", `extension needs more than ${MAX_LIFETIME} blocks`);
  return { entityKey: entity.key, expiration: ExpirationTime.atBlock(target) };
}
