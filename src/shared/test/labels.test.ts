import { describe, expect, it } from "vitest";
import {
  LabelError,
  isCanonicalLabel,
  isTeamLabel,
  normalizeLabel,
  toFullName,
  toRelativeLabel,
} from "../labels";

const names = { edition: "mumbai2026", baseName: "lanyard.eth" };

describe("normalizeLabel", () => {
  it.each(["priya.volunteers", "zkpay", "ana.judges.arkiv.partners", "sam.staff.ens.partners", "team-42"])(
    "accepts %s",
    (label) => expect(normalizeLabel(label)).toBe(label),
  );

  it("treats the empty label as the edition itself", () => {
    expect(normalizeLabel("")).toBe("");
  });

  it.each([
    ["Judges", /not canonical/],
    ["judges ", /ENSIP-15/],
    ["🦄", /segment/],
    ["zk🦄pay", /segment/],
    ["-zkpay", /segment/],
    ["zkpay-", /segment/],
    ["priya..volunteers", /ENSIP-15|segment/],
    [".volunteers", /ENSIP-15|segment/],
    ["ab--cd", /ENSIP-15/],
    ["zk_pay", /ENSIP-15|segment/],
  ])("rejects %j", (label, reason) => {
    expect(() => normalizeLabel(label)).toThrow(LabelError);
    expect(() => normalizeLabel(label)).toThrow(reason);
  });
});

describe("full names", () => {
  it("round-trips relative labels", () => {
    for (const label of ["priya.volunteers", "zkpay", "winner.zkpay", "ana.judges.arkiv.partners"]) {
      const full = toFullName(label, names);
      expect(full).toBe(`${label}.mumbai2026.lanyard.eth`);
      expect(toRelativeLabel(full, names)).toBe(label);
    }
  });

  it("maps the empty label to the edition name and back", () => {
    expect(toFullName("", names)).toBe("mumbai2026.lanyard.eth");
    expect(toRelativeLabel("mumbai2026.lanyard.eth", names)).toBe("");
  });

  it("rejects names outside the edition and non-canonical input", () => {
    expect(() => toRelativeLabel("priya.volunteers.other.lanyard.eth", names)).toThrow(/not under/);
    expect(() => toRelativeLabel("lanyard.eth", names)).toThrow(LabelError);
    expect(() => toFullName("Priya.volunteers", names)).toThrow(LabelError);
  });
});

describe("label predicates", () => {
  it("knows canonical and team labels", () => {
    expect(isCanonicalLabel("zkpay")).toBe(true);
    expect(isCanonicalLabel("ZKPAY")).toBe(false);
    expect(isTeamLabel("zkpay")).toBe(true);
    expect(isTeamLabel("judges")).toBe(false);
    expect(isTeamLabel("winner")).toBe(false);
    expect(isTeamLabel("winner.zkpay")).toBe(false);
    expect(isTeamLabel("")).toBe(false);
  });
});
