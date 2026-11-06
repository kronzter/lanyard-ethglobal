import { describe, expect, it } from "vitest";
import { isCutoffInWindow } from "@/shared/config/validate";
import { eventConfig } from "@/shared/event.config";
import { dedupeObservations } from "@/shared/evidence/observation";
import { byLabelOf, parseEvidenceScenarios } from "@/shared/fixtures/evidence-scenarios";
import { assertByLabelsKnown, parsePersonas } from "@/shared/fixtures/personas";
import { AlreadyPublishedError } from "@/shared/interfaces/results-publisher";
import {
  MockResultsPublisher,
  PublisherCrashError,
  type ReceiptOutcome,
} from "@/shared/mocks/mock-results-publisher";
import { createSerializedStore } from "@/shared/mocks/publisher-store";
import personasRaw from "../personas.json";
import raw from "../evidence-scenarios.json";

const s = parseEvidenceScenarios(raw);
const personas = parsePersonas(personasRaw);
const observations = [
  s.deletedCapturedFinal.observation,
  s.expiredLeaseRetainedClaim.ticket,
  s.expiredLeaseRetainedClaim.claim,
];

describe("evidence-scenarios.json (P0.4-R5)", () => {
  it("uses only persona by labels and persona creators", () => {
    assertByLabelsKnown(
      observations.map((o) => byLabelOf(o)!),
      personas,
      "fixtures/evidence-scenarios.json",
    );
    const addresses = new Set(personas.personas.map((p) => p.address));
    for (const o of observations) expect(addresses.has(o.creator), o.key).toBe(true);
  });

  it("keeps a deleted captured final as usable evidence", () => {
    const o = s.deletedCapturedFinal.observation;
    expect(o.deletedAtBlock).toBeGreaterThan(o.observedAtBlock);
    expect(dedupeObservations([o])).toEqual([o]);
  });

  it("records an uncaptured deleted final as a gap with no retained bytes", () => {
    const u = s.deletedUncapturedFinal;
    expect(u.retained).toBeNull();
    expect(u.missingSinceBlock).toBeGreaterThan(u.inInventorySinceBlock);
    expect(observations.some((o) => o.key === u.key)).toBe(false);
  });

  it("has a claim whose logical lease lapsed while its retention was extended", () => {
    const { claim, ticket, leaseSeconds, evaluatedAtTimestamp } = s.expiredLeaseRetainedClaim;
    expect(evaluatedAtTimestamp - claim.createdAtTimestamp).toBeGreaterThanOrEqual(BigInt(leaseSeconds));
    expect(claim.expiresAtBlock).toBeGreaterThan(claim.observedAtBlock + BigInt(leaseSeconds) / 2n);
    expect(claim.attributes.find((a) => a.name === "ticket")?.value).toBe(ticket.key);
    expect(claim.createdAtTimestamp).toBeGreaterThan(ticket.createdAtTimestamp);
  });

  it("lists cutoffs on both edges of [results, freezeDeadline), matching the config check", () => {
    for (const c of s.cutoffs)
      expect(isCutoffInWindow(c.timestamp, eventConfig.times), c.note).toBe(c.inWindow);
    const ts = s.cutoffs.map((c) => c.timestamp);
    const t = eventConfig.times;
    expect(ts).toEqual([t.results - 1n, t.results, t.freezeDeadline - 1n, t.freezeDeadline]);
  });

  it("replays the publication restart: a new instance adopts the broadcast without resending", async () => {
    let file: string | null = null;
    const store = createSerializedStore({
      read: async () => file,
      write: async (text) => void (file = text),
    });
    const outcomes: ReceiptOutcome[] = [s.publicationRestart.outcome];
    const open = () => new MockResultsPublisher({ store, outcome: () => outcomes.shift() ?? "success" });
    const { input } = s.publicationRestart.broadcast;
    const crash = await open()
      .setEventResults(input)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(crash).toBeInstanceOf(PublisherCrashError);
    const restarted = open();
    expect(await restarted.reconcile((crash as PublisherCrashError).txHash)).toMatchObject({
      blockNumber: 1n,
    });
    expect((await restarted.state()).eventResults).toEqual(input);
    await expect(restarted.setEventResults(input)).rejects.toThrow(AlreadyPublishedError);
  });
});
