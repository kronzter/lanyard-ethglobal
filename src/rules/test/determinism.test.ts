// Determinism (B2.3-R2) and the evaluation budget (B2.3-R5).
import { describe, expect, it } from "vitest";
import { canonicalHash } from "@/shared/canonical";
import type { CapturedObservation } from "@/shared/evidence/observation";
import { createFixtureEnsReader } from "@/shared/mocks/fixtures";
import { evaluate, prepare, RULES_VERSION } from "@/rules";
import { context, frozen, key, obs, persona, tsOf, venueObs } from "./harness";

/** Seeded PRNG for the test only (the rules never see randomness). */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T>(xs: readonly T[], rand: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

const HACKERS = [
  "zkpay-a",
  "zkpay-b",
  "zkpay-c",
  "zkpay-d",
  "chainchat-a",
  "chainchat-b",
  "seatsense-a",
  "seatsense-d",
];

/** A mixed population: valid and forged seats, rubrics, drips, venues and kinds without rules. */
function population(n: number): CapturedObservation[] {
  const org = persona("organizer");
  const arkiv = persona("partner-arkiv");
  const ravi = persona("ravi");
  const out: CapturedObservation[] = [];
  for (let i = 0; i < n; i++) {
    const at = 9_021_700n + BigInt(i % 400) * 30n; // many records share a block, so key tie-breaks matter
    const k = key(0x10_0000n + BigInt(i));
    const h = persona(HACKERS[i % HACKERS.length]!);
    const other = persona(HACKERS[(i + 1) % HACKERS.length]!);
    switch (i % 6) {
      case 0:
      case 1:
        out.push(
          obs({
            key: k,
            kind: "seat_assignment",
            creator: i % 12 === 1 ? ravi.address : org.address,
            byLabel: i % 12 === 1 ? ravi.by : "organizer",
            at,
            attrs: {
              hacker_label: ["str", h.by],
              hacker_address: ["addr", i % 5 === 0 ? other.address : h.address],
              seat: ["str", `s${i}`],
              venue: ["key", key(1n)],
            },
          }),
        );
        break;
      case 2:
        out.push(
          obs({
            key: k,
            kind: "rubric",
            creator: arkiv.address,
            byLabel: arkiv.by,
            at,
            attrs: { track: ["str", i % 4 ? "arkiv" : "main"], payload: ["bytes", "0x01"] },
          }),
        );
        break;
      case 3:
        out.push(
          obs({
            key: k,
            kind: "drip",
            creator: frozen.authorities.desk!,
            byLabel: "desk",
            at,
            attrs: { recipient: ["addr", h.address], tx: ["str", "0x1"] },
          }),
        );
        break;
      case 4:
        out.push(
          obs({
            key: k,
            kind: "venue",
            creator: org.address,
            byLabel: "organizer",
            at,
            attrs: { version: ["str", `v${i} — 東京`] },
          }),
        );
        break;
      default:
        out.push(obs({ key: k, kind: "ticket", creator: h.address, byLabel: h.by, at }));
    }
  }
  return out;
}

/** A venue, a clocked-in volunteer and a contested ticket, so the B3 cross-record rules are shuffled too. */
function dutyAndTickets(): CapturedObservation[] {
  const priya = persona("priya");
  const ravi = persona("ravi");
  const meera = persona("meera");
  const hacker = persona("zkpay-a");
  const venue = venueObs(9_021_650n);
  const shiftFor = (v: string) =>
    obs({
      kind: "shift",
      creator: priya.address,
      byLabel: priya.by,
      at: 9_022_000n,
      attrs: {
        volunteer: ["str", v],
        zone: ["str", "west"],
        starts_at: ["u64", tsOf(9_022_500n).toString()],
        ends_at: ["u64", tsOf(9_023_500n).toString()],
      },
    });
  const shifts = [shiftFor(ravi.by), shiftFor(meera.by)];
  const clocks = shifts.map((s, i) =>
    obs({
      kind: "clock",
      creator: priya.address,
      byLabel: priya.by,
      at: 9_022_510n,
      attrs: { volunteer: ["str", [ravi, meera][i]!.by], shift: ["key", s.key], action: ["str", "in"] },
    }),
  );
  const ticket = obs({
    kind: "ticket",
    creator: hacker.address,
    byLabel: hacker.by,
    at: 9_022_600n,
    attrs: { seat: ["str", "w1"], venue: ["key", venue.key], category: ["str", "power"] },
  });
  const claims = [ravi, meera].map((h) =>
    obs({
      kind: "ticket_claim",
      creator: h.address,
      byLabel: h.by,
      at: 9_022_610n,
      attrs: { ticket: ["key", ticket.key] },
    }),
  );
  return [venue, ...shifts, ...clocks, ticket, ...claims];
}

describe("determinism", () => {
  it("gives a byte-identical output for 1,000 shuffles of the input", async () => {
    const records = [...dutyAndTickets(), ...population(120)];
    const ctx = context();
    const { ens } = await prepare(records, createFixtureEnsReader(), ctx, frozen);
    const first = evaluate(records, ens, ctx, frozen, RULES_VERSION);
    expect(
      first.verdicts
        .filter((v) => v.kind === "ticket_claim")
        .map((v) => v.counts)
        .sort(),
    ).toEqual([false, true]);
    const expected = canonicalHash(first);
    const rand = mulberry32(2026);
    for (let i = 0; i < 1000; i++) {
      const out = evaluate(shuffle(records, rand), shuffle(ens, rand), ctx, frozen, RULES_VERSION);
      if (canonicalHash(out) !== expected) throw new Error(`shuffle ${i} changed the output`);
    }
  }, 30_000);

  it("deduplicates repeated identical observations", async () => {
    const records = population(30);
    const ctx = context();
    const { ens } = await prepare(records, createFixtureEnsReader(), ctx, frozen);
    const once = evaluate(records, ens, ctx, frozen, RULES_VERSION);
    const twice = evaluate([...records, ...records], ens, ctx, frozen, RULES_VERSION);
    expect(twice).toEqual(once);
  });
});

describe("budget", () => {
  it("evaluates and hashes a prepared 2,000-record bundle in under a minute", async () => {
    const records = population(2000);
    const ctx = context();
    const prepared = await prepare(records, createFixtureEnsReader(), ctx, frozen);
    const start = performance.now();
    const output = evaluate(records, prepared.ens, ctx, frozen, RULES_VERSION);
    const hash = canonicalHash(output);
    const ms = performance.now() - start;
    console.log(
      `evaluate+hash of ${records.length} records: ${ms.toFixed(0)} ms (${output.verdicts.filter((v) => v.counts).length} counted); ` +
        `prepare: ${prepared.stats.fetched} ENS reads, ${prepared.stats.cacheHits} cache hits, ${prepared.stats.timeMappings} time mappings`,
    );
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(output.verdicts).toHaveLength(2000);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});
