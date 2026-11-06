import { MAX_LIFETIME } from "@arkiv-network/sdk";
import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import type { Hex } from "@/shared/types/primitives";
import { FakeArkiv } from "../fake";
import { KIND_NAMES, KINDS, type Kind } from "../kinds";
import {
  buildCreate,
  buildExtension,
  submissionSnapshot,
  WriteRejected,
  type KindInputs,
  type ProjectContent,
  type WriteContext,
} from "../writers";

const T = eventConfig.times;
const K = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const ADDR = "0x00000000000000000000000000000000000000c3" as const;
const content: ProjectContent = {
  page: {
    title: "zkPay",
    description: "Private payments",
    members: ["Person A", "Person B"],
    links: { ethglobal: "https://ethglobal.com/showcase/zkpay", repository: "https://github.com/x/zkpay" },
  },
  details: { stack: "noir" },
};
const ctx = (byLabel = "organizer"): WriteContext => ({ edition: eventConfig.edition, byLabel, times: T });

const INPUTS: { [K in Kind]: KindInputs[K] } = {
  venue: { version: "v1", venue: { cells: [1, 2], seats: { S001: [0, 0] } } },
  seat_assignment: { hackerAddress: ADDR, hackerLabel: "zkpay-b.hackers", seat: "S014", venue: K(1) },
  shift: {
    volunteer: "ravi.volunteers",
    zone: "west",
    startsAt: T.eventStart,
    endsAt: T.eventStart + 14_400n,
  },
  clock: { volunteer: "ravi.volunteers", shift: K(2), action: "in", statedAt: T.eventStart },
  duty_pass: { volunteer: "ravi.volunteers", shift: K(2), endsAt: T.eventStart + 14_400n },
  ticket: { seat: "S014", venue: K(1), category: "wifi" },
  ticket_claim: { ticket: K(3) },
  ticket_resolution: { ticket: K(3), claim: K(4), seat: "S014" },
  ticket_confirmation: { ticket: K(3), resolution: K(5) },
  project: { team: "zkpay", track: "main", content },
  submission: { project: K(6), team: "zkpay", track: "main", lead: ADDR, content },
  acceptance: { submission: K(7), track: "main" },
  rubric: { track: "main", rubric: { criteria: [{ id: "impact", name: "Impact", weight: 2 }], scale: 10 } },
  judge_assignment: { judge: "ana.judges", submission: K(7), rubric: K(8) },
  score_sheet: {
    submission: K(7),
    judge: "ana.judges",
    rubric: K(8),
    assignment: K(9),
    ciphertext: "0x0102",
  },
  final_score: {
    submission: K(7),
    judge: "ana.judges",
    rubric: K(8),
    assignment: K(9),
    ciphertext: "0x0102",
  },
  recusal: { submission: K(7), judge: "ana.judges" },
  results: { summary: { rankings: [] } },
  drip: { recipient: ADDR, tx: K(10) },
};

const rejected = (f: () => unknown) => {
  try {
    f();
    return "built";
  } catch (e) {
    return e instanceof WriteRejected ? e.reason : `other: ${String(e)}`;
  }
};

describe("record writers", () => {
  it("cover every kind in the B1 table", () => {
    expect([...KIND_NAMES].sort()).toEqual(Object.keys(INPUTS).sort());
    expect(KIND_NAMES).toHaveLength(19);
  });

  it.each(KIND_NAMES.map((k) => [k]))(
    "%s round-trips with common attributes, flags and retention",
    async (kind) => {
      const f = new FakeArkiv(T.eventStart - 10_000n);
      const head = await f.head();
      const params = buildCreate(kind, { ...ctx("ravi.volunteers"), head }, INPUTS[kind] as never);
      const [k] = (await f.writer(ADDR).write({ creates: [params] })).created;
      const e = (await f.get(k!))!;
      const a = e.attributes;
      expect([
        a.app!.value.value,
        a.event!.value.value,
        a.kind!.value.value,
        a.by_label!.value.value,
      ]).toEqual(["lanyard", "mumbai2026", kind, "ravi.volunteers"]);
      expect(["app", "event", "kind", "by_label"].every((n) => a[n]!.indexed)).toBe(true);
      expect(e.flags.readonly).toBe(KINDS[kind].flags.readonly);
      expect(e.flags.permissionlessExtension).toBe(
        !!(KINDS[kind].flags as { permissionlessExtension?: boolean }).permissionlessExtension,
      );
      expect(a["arkiv.schema"]).toBeUndefined();
      const until = KINDS[kind].retention.until?.(T);
      if (until === undefined) expect(e.expiresAt - e.createdAt).toBe(MAX_LIFETIME);
      else expect(e.expiresAt).toBe(head.number + 1n + (until - (head.timestamp + 2n) + 1n) / 2n);
    },
  );

  it("rejects non-canonical labels, long strings, large payloads and bad references before sending", () => {
    expect(rejected(() => buildCreate("ticket", ctx("Ravi.Volunteers"), INPUTS.ticket))).toBe("label");
    expect(
      rejected(() => buildCreate("ticket", ctx(), { ...INPUTS.ticket, category: "x".repeat(129) })),
    ).toBe("string-too-long");
    expect(rejected(() => buildCreate("results", ctx(), { summary: { blob: "x".repeat(131_073) } }))).toBe(
      "payload-too-large",
    );
    expect(rejected(() => buildCreate("ticket_claim", ctx(), { ticket: "0x1234" }))).toBe("invalid");
    expect(rejected(() => buildCreate("clock", ctx(), { ...INPUTS.clock, action: "maybe" as never }))).toBe(
      "invalid",
    );
    expect(
      rejected(() => buildCreate("shift", ctx(), { ...INPUTS.shift, endsAt: INPUTS.shift.startsAt })),
    ).toBe("invalid");
  });

  it("rejects retention that is over or longer than MAX_LIFETIME", () => {
    const after = { number: 5n, hash: K(0), timestamp: T.eventEnd + 8n * 86_400n };
    expect(rejected(() => buildCreate("ticket", { ...ctx(), head: after }, INPUTS.ticket))).toBe(
      "retention-over",
    );
    const longAgo = { number: 5n, hash: K(0), timestamp: T.results - 200n * 86_400n };
    expect(rejected(() => buildCreate("rubric", { ...ctx(), head: longAgo }, INPUTS.rubric))).toBe(
      "retention-too-long",
    );
  });

  it("requires the ETHGlobal link and binds the exact snapshot with content_hash", () => {
    const a = submissionSnapshot(INPUTS.submission);
    expect(submissionSnapshot(INPUTS.submission).contentHash).toBe(a.contentHash);
    const edited = { ...INPUTS.submission, content: { ...content, details: { stack: "circom" } } };
    expect(submissionSnapshot(edited).contentHash).not.toBe(a.contentHash);
    const noShowcase = {
      ...INPUTS.submission,
      content: { ...content, page: { ...content.page, links: {} } },
    };
    expect(() => submissionSnapshot(noShowcase)).toThrow(/ETHGlobal/);
  });

  it("rejects an extension that would not move expiry later", async () => {
    const f = new FakeArkiv(T.eventStart - 10_000n);
    const [k] = (await f.writer(ADDR).write({ creates: [buildCreate("ticket", ctx(), INPUTS.ticket)] }))
      .created;
    const e = (await f.get(k!))!;
    const head = await f.head();
    expect(rejected(() => buildExtension(e, T.eventEnd, head))).toBe("earlier-expiry");
    const later = buildExtension(e, T.eventEnd + 20n * 86_400n, head);
    await f.writer(ADDR).write({ extensions: [later] });
    expect((await f.get(k!))!.expiresAt).toBeGreaterThan(e.expiresAt);
  });
});
