import { describe, expect, it } from "vitest";
import { configHash, freezeConfig } from "../config/hash";
import { scoreKeyId } from "../crypto/score-cipher";
import type { EventConfigInput } from "../config/schema";
import { BlockedCapabilityError, measured, requireMeasured, unmeasured } from "../config/unmeasured";
import {
  ConfigError,
  assertCutoffInWindow,
  checkAncestorLifetimes,
  isCutoffInWindow,
  judgeBadgeExpiry,
  namespaceExpiry,
  staffBadgeExpiry,
  validateEventConfig,
} from "../config/validate";
import { eventConfig, eventConfigInput } from "../event.config";

const DAY = 86_400n;
const clone = (): EventConfigInput => structuredClone(eventConfigInput) as EventConfigInput;
const withTimes = (patch: Partial<EventConfigInput["times"]>): EventConfigInput => {
  const c = clone();
  c.times = { ...c.times, ...patch };
  return c;
};
const fullyMeasured = (): EventConfigInput => {
  const c = clone();
  const id = (n: string) => `0x${n.repeat(64)}`;
  c.chains.sepolia.confirmations = measured(3, "test");
  c.chains.sepolia.resetId = measured(id("1"), "test");
  c.chains.rabdi.confirmations = measured(5, "test");
  c.chains.rabdi.resetId = measured(id("2"), "test");
  c.scoreCipher = measured(
    { suite: "x25519-hkdf-sha256-aes-256-gcm", keyId: "k1", publicKey: id("3"), implementation: "test@1" },
    "test",
  );
  c.shiftWriteProfile = measured("confirmed-sequential", "test");
  c.fundingProfile = measured("faucet-contract", "test");
  return c;
};

describe("mumbai2026 config", () => {
  it("validates, with one track per partner plus main", () => {
    expect(eventConfig.edition).toBe("mumbai2026");
    expect(eventConfig.tracks.map((t) => [t.id, t.partner])).toEqual([
      ["main", null],
      ["arkiv", "arkiv"],
      ["ens", "ens"],
    ]);
  });

  it("derives namespace and badge lifetimes from the freeze window", () => {
    const t = eventConfig.times;
    expect(namespaceExpiry(t)).toBe(t.freezeDeadline + 30n * DAY); // freezeDeadline is later than eventEnd
    expect(namespaceExpiry({ ...t, eventEnd: t.freezeDeadline + DAY })).toBe(t.freezeDeadline + 31n * DAY);
    expect(judgeBadgeExpiry(t)).toBe(t.freezeDeadline);
    expect(staffBadgeExpiry(t)).toBe(t.eventEnd);
  });

  it("is fully measured, with a stable config hash and the real score key", () => {
    expect(eventConfig.shiftWriteProfile).toEqual(
      expect.objectContaining({ status: "measured", value: "confirmed-sequential" }),
    );
    expect(eventConfig.fundingProfile).toEqual(
      expect.objectContaining({ status: "measured", value: "desk-wallet" }),
    );
    const frozen = freezeConfig(eventConfig);
    expect(frozen.scoreCipher.keyId).toBe(scoreKeyId(frozen.scoreCipher.publicKey));
    expect(configHash(eventConfig)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(configHash(eventConfig)).toBe(configHash(eventConfig));
  });

  it("sets a positive desk drip amount and rejects a zero one", () => {
    expect(eventConfig.funding?.dripWei).toBe(500_000_000_000_000_000n);
    const c = clone();
    c.funding = { dripWei: 0n };
    expect(() => validateEventConfig(c)).toThrow();
  });

  it("still blocks a config with any gate left unmeasured, naming its spike check", () => {
    const c = clone();
    c.scoreCipher = unmeasured("P0.6-S11");
    expect(() => configHash(validateEventConfig(c))).toThrow(BlockedCapabilityError);
    try {
      freezeConfig(validateEventConfig(c));
    } catch (e) {
      expect((e as BlockedCapabilityError).gate).toBe("P0.6-S11");
    }
  });
});

describe("time ordering", () => {
  const t = eventConfigInput.times;
  it.each([
    ["eventStart at submissionDeadline", { eventStart: t.submissionDeadline }, /eventStart must be before/],
    [
      "submission after judging end",
      { submissionDeadline: t.judgingEnd + 1n },
      /submissionDeadline must not be after/,
    ],
    ["judging end after results", { judgingEnd: t.results + 1n }, /judgingEnd must not be after results/],
    ["results at freezeDeadline", { results: t.freezeDeadline }, /results must be before freezeDeadline/],
    ["eventEnd before judging end", { eventEnd: t.judgingEnd - 1n }, /eventEnd must not be before/],
  ])("rejects %s", (_name, patch, message) => {
    expect(() => validateEventConfig(withTimes(patch))).toThrow(message);
  });

  it("allows the equalities the contract permits", () => {
    expect(() =>
      validateEventConfig(
        withTimes({ submissionDeadline: t.judgingEnd, results: t.judgingEnd, eventEnd: t.judgingEnd }),
      ),
    ).not.toThrow();
  });
});

describe("freeze cutoff window [results, freezeDeadline)", () => {
  const t = eventConfig.times;
  it("includes results and excludes freezeDeadline", () => {
    expect(isCutoffInWindow(t.results, t)).toBe(true);
    expect(isCutoffInWindow(t.freezeDeadline - 1n, t)).toBe(true);
    expect(isCutoffInWindow(t.results - 1n, t)).toBe(false);
    expect(isCutoffInWindow(t.freezeDeadline, t)).toBe(false);
    expect(() => assertCutoffInWindow(t.freezeDeadline, t)).toThrow(/outside the freeze window/);
  });
});

describe("ancestor lifetimes", () => {
  const t = eventConfig.times;
  it("rejects any structural ancestor that expires before namespaceExpiry", () => {
    const ok = namespaceExpiry(t);
    expect(() => checkAncestorLifetimes(t, [{ name: "lanyard.eth", expiry: ok }])).not.toThrow();
    expect(() =>
      checkAncestorLifetimes(t, [
        { name: "lanyard.eth", expiry: ok + DAY },
        { name: "arkiv.partners.mumbai2026.lanyard.eth", expiry: t.eventEnd },
      ]),
    ).toThrow(/arkiv\.partners\.mumbai2026\.lanyard\.eth expires/);
  });
});

describe("structural checks", () => {
  const expectIssue = (mutate: (c: EventConfigInput) => void, message: RegExp) => {
    const c = clone();
    mutate(c);
    expect(() => validateEventConfig(c)).toThrow(ConfigError);
    expect(() => validateEventConfig(c)).toThrow(message);
  };

  it("rejects a non-canonical edition", () => expectIssue((c) => (c.edition = "Mumbai2026"), /edition/));
  it("rejects a missing non-partner track", () =>
    expectIssue((c) => (c.tracks = c.tracks.filter((t) => t.partner !== null)), /non-partner track/));
  it("rejects a partner without a track", () =>
    expectIssue(
      (c) => (c.tracks = c.tracks.filter((t) => t.partner !== "ens")),
      /partner ens needs exactly one track/,
    ));
  it("rejects a zero authority", () =>
    expectIssue(
      (c) => (c.authorities.results = "0x0000000000000000000000000000000000000000"),
      /zero address/,
    ));
  it("rejects shared authority wallets", () =>
    expectIssue((c) => (c.authorities.results = c.authorities.organizer), /independent/));
  it("rejects a missing partner authority", () =>
    expectIssue(
      (c) => delete (c.authorities.partners as Record<string, string>).ens,
      /authorities\.partners\.ens is missing/,
    ));
  it("rejects a wrong chain ID", () =>
    expectIssue((c) => ((c.chains.rabdi as { chainId: number }).chainId = 1), /chains\.rabdi\.chainId/));
  it("rejects a fractional venue scale", () => expectIssue((c) => (c.venue.cellSizeMm = 0.5), /cellSizeMm/));
  it("rejects unknown fields", () =>
    expectIssue((c) => Object.assign(c, { privateKey: "nope" }), /Unrecognized key|unrecognized/i));
});

describe("configHash", () => {
  it("is deterministic once every gated value is measured", () => {
    const cfg = validateEventConfig(fullyMeasured());
    const h = configHash(cfg);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(configHash(validateEventConfig(fullyMeasured()))).toBe(h);
  });

  it("commits to the freeze window", () => {
    const a = configHash(validateEventConfig(fullyMeasured()));
    const moved = fullyMeasured();
    moved.times.freezeDeadline = BigInt(moved.times.freezeDeadline) + 1n;
    expect(configHash(validateEventConfig(moved))).not.toBe(a);
  });

  it("requireMeasured names the blocking check", () => {
    expect(() => requireMeasured(unmeasured("P0.6-S6"), "funding profile")).toThrow(
      /funding profile is blocked until P0\.6-S6/,
    );
    expect(requireMeasured(measured(7, "evidence"), "x")).toBe(7);
  });
});
