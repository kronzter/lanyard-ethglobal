import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import raw from "../../fixtures/personas.json";
import { parsePersonas } from "../shared/fixtures/personas";
import {
  buildDemoTeams,
  decideTeam,
  parseTeamArgs,
  validateTeamLabel,
  type TeamObservation,
} from "./team-plan";

const lead = "0x1111111111111111111111111111111111111111" as const;
const child = "0x2222222222222222222222222222222222222222" as const;
const other = "0x3333333333333333333333333333333333333333" as const;
const empty: TeamObservation = {
  registeredChild: zeroAddress,
  registeredLead: zeroAddress,
  currentOwner: zeroAddress,
  currentChild: zeroAddress,
  status: 0,
  expiry: 0n,
  minimumExpiry: 100n,
};
const existing: TeamObservation = {
  registeredChild: child,
  registeredLead: lead,
  currentOwner: lead,
  currentChild: child,
  status: 2,
  expiry: 100n,
  minimumExpiry: 100n,
};

describe("team label policy", () => {
  it.each(["abc", "zkpay", "123", "a--bc", "abc--de", "a".repeat(32)])("accepts %s", (label) => {
    expect(validateTeamLabel(label)).toBe(label);
  });
  it.each([
    "",
    "a",
    "ab",
    "a".repeat(33),
    "Zkpay",
    "zkpay ",
    "-zk",
    "zk-",
    "zk.pay",
    "ab--cd",
    "😊",
    "a_b",
    "hackers",
    "judges",
    "volunteers",
    "partners",
    "admin",
    "staff",
    "lanyard",
    "ethglobal",
    "winner",
  ])("rejects %s", (label) => {
    expect(() => validateTeamLabel(label)).toThrow();
  });
});

describe("register-team arguments", () => {
  it("parses one team with fork and dry-run", () => {
    expect(parseTeamArgs(["--label", "zkpay", "--lead", lead, "--fork", "--dry-run"])).toEqual({
      mode: "team",
      label: "zkpay",
      lead,
      fork: true,
      dryRun: true,
    });
  });
  it("permits fixture seeding only on an explicitly selected fork", () => {
    expect(parseTeamArgs(["--demo", "--fork"])).toEqual({ mode: "demo", fork: true, dryRun: false });
    expect(() => parseTeamArgs(["--demo"])).toThrow(/fork/);
  });
  it.each(
    [
      [],
      ["--label", "zkpay"],
      ["--lead", lead],
      ["--unknown"],
      ["--label"],
      ["--label", "zkpay", "--lead", "bad"],
      ["--label", "zkpay", "--lead", zeroAddress],
      ["--label", "zkpay", "--label", "chainchat", "--lead", lead],
      ["--demo", "--fork", "--label", "zkpay"],
      ["--demo", "--fork", "--lead", lead],
      ["--demo", "--fork", "--fork"],
    ].map((args) => ({ args })),
  )("rejects ambiguous or invalid arguments $args", ({ args }) => {
    expect(() => parseTeamArgs(args)).toThrow();
  });
});

describe("team creation reconciliation", () => {
  it("registers an untouched label", () => {
    expect(decideTeam(empty, lead).action).toBe("register");
  });
  it("skips an intact team already held by the requested lead", () => {
    expect(decideTeam(existing, lead).action).toBe("skip");
  });
  it.each([
    { ...existing, currentOwner: other },
    { ...existing, registeredLead: other },
    { ...existing, currentChild: other },
    { ...existing, currentOwner: zeroAddress, status: 0 },
    { ...existing, expiry: 99n },
    { ...empty, status: 1 },
    { ...empty, currentOwner: lead, status: 2 },
    { ...empty, registeredLead: lead },
  ])("blocks conflicts, expired teams and incomplete registrations", (observation) => {
    expect(decideTeam(observation, lead).action).toBe("blocked");
  });
});

describe("fixture team seed plan", () => {
  const personas = parsePersonas(raw).personas;
  it("seeds three teams with twelve hackers badges including each lead", () => {
    const teams = buildDemoTeams(personas);
    expect(teams.map((team) => team.label)).toEqual(["chainchat", "seatsense", "zkpay"]);
    expect(teams.flatMap((team) => team.members)).toHaveLength(12);
    for (const team of teams) {
      expect(team.members.map((member) => member.displayName)).toEqual([
        "Person A",
        "Person B",
        "Person C",
        "Person D",
      ]);
      expect(team.members[0]!.address).toBe(team.lead);
      expect(team.members.map((member) => member.label)).toEqual([
        `${team.label}-a`,
        `${team.label}-b`,
        `${team.label}-c`,
        `${team.label}-d`,
      ]);
    }
  });
  it("rejects a roster without exactly one lead per team", () => {
    expect(() => buildDemoTeams(personas.filter((p) => p.id !== "zkpay-a"))).toThrow(/lead/);
    const changed = personas.map((p) => (p.id === "zkpay-b" ? { ...p, labels: [...p.labels, "zkpay"] } : p));
    expect(() => buildDemoTeams(changed)).toThrow(/lead/);
  });
  it("rejects missing hacker-badge ownership", () => {
    const changed = personas.map((p) => (p.id === "zkpay-d" ? { ...p, labels: [] } : p));
    expect(() => buildDemoTeams(changed)).toThrow(/badge/);
  });
});
