import { readFileSync } from "node:fs";
import path from "node:path";
import { mnemonicToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { eventConfig } from "@/shared/event.config";
import { assertByLabelsKnown, parsePersonas, type PersonaRole } from "@/shared/fixtures/personas";
import pages from "../team-pages.json";
import raw from "../personas.json";

const file = parsePersonas(raw);
const personas = file.personas;
const byRole = (role: PersonaRole) => personas.filter((p) => p.role === role);
const root = path.resolve(import.meta.dirname, "../..");

describe("personas.json roster (P0.4-R1)", () => {
  it.each([
    ["organizer", 1],
    ["results", 1],
    ["desk", 1],
    ["coordinator", 1],
    ["head-judge", 1],
    ["partner", 2],
    ["partner-staff", 4],
    ["lead", 4],
    ["volunteer", 10],
    ["partner-judge", 6],
    ["global-judge", 3],
  ] as const)("has %s × %i", (role, count) => {
    expect(byRole(role)).toHaveLength(count);
  });

  it("has two partners, arkiv and ens, each with two staff and three judges", () => {
    for (const partner of ["arkiv", "ens"]) {
      expect(
        byRole("partner")
          .filter((p) => p.partner === partner)
          .map((p) => p.labels),
      ).toEqual([[`${partner}.partners`]]);
      const staff = byRole("partner-staff").filter((p) => p.partner === partner);
      expect(staff).toHaveLength(2);
      expect(staff.every((p) => p.by.endsWith(`.staff.${partner}.partners`))).toBe(true);
      const judges = byRole("partner-judge").filter((p) => p.partner === partner);
      expect(judges).toHaveLength(3);
      expect(judges.every((p) => p.by.endsWith(`.judges.${partner}.partners`))).toBe(true);
    }
  });

  it("gives global judges a judges-book badge", () => {
    expect(byRole("global-judge").every((p) => /^[a-z]+\.judges$/.test(p.by))).toBe(true);
  });

  it("makes Priya a lead in the volunteers book", () => {
    expect(personas.find((p) => p.id === "priya")).toMatchObject({ role: "lead", by: "priya.volunteers" });
    expect(
      [...byRole("lead"), ...byRole("volunteer")].every((p) => p.by.endsWith(".volunteers") && p.zone),
    ).toBe(true);
  });

  it("has three teams of Person A–D, every member with a hackers badge and the lead owning the team name", () => {
    const teams = [...new Set(byRole("hacker").map((p) => p.team))];
    expect(teams).toEqual(["zkpay", "chainchat", "seatsense"]);
    for (const team of teams) {
      const members = byRole("hacker").filter((p) => p.team === team);
      expect(members.map((p) => p.displayName)).toEqual(["Person A", "Person B", "Person C", "Person D"]);
      expect(members.every((p) => p.labels.includes(p.by) && p.by.endsWith(".hackers"))).toBe(true);
      expect(members.filter((p) => p.labels.includes(team!)).map((p) => p.displayName)).toEqual(["Person A"]);
    }
  });

  it("gives authorities descriptive by labels and no badges", () => {
    for (const p of personas.filter((x) =>
      ["organizer", "results", "desk", "coordinator", "head-judge"].includes(x.role),
    )) {
      expect(p.labels).toEqual([]);
    }
  });
});

describe("persona keys and addresses", () => {
  it("derives every address from the public test mnemonic at its hdIndex", () => {
    for (const p of personas) {
      expect(mnemonicToAccount(file.mnemonic, { addressIndex: p.hdIndex }).address.toLowerCase(), p.id).toBe(
        p.address,
      );
    }
  });

  it("matches the config's authority wallets", () => {
    const addr = (id: string) => personas.find((p) => p.id === id)!.address;
    expect(eventConfig.authorities).toEqual({
      organizer: addr("organizer"),
      results: addr("results"),
      partners: { arkiv: addr("partner-arkiv"), ens: addr("partner-ens") },
    });
  });

  it("lists every key env var in .env.example with no value", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    for (const p of personas) expect(example, p.keyEnv).toMatch(new RegExp(`^${p.keyEnv}=$`, "m"));
  });
});

describe("by-label coverage", () => {
  it("accepts persona labels and rejects unknown ones", () => {
    expect(() => assertByLabelsKnown(["priya.volunteers", "organizer", "zkpay"], file)).not.toThrow();
    expect(() => assertByLabelsKnown(["priya.volunteers", "mallory.volunteers"], file, "test")).toThrow(
      /test uses by labels with no persona: mallory\.volunteers/,
    );
  });

  it("knows every registered team in the team-page fixtures", () => {
    const registered = Object.values(pages)
      .filter((p) => p.status !== "unknown-team")
      .map((p) => p.team);
    expect(() => assertByLabelsKnown(registered, file, "fixtures/team-pages.json")).not.toThrow();
    expect(() => assertByLabelsKnown([pages.unknownTeam.team], file)).toThrow();
  });
});
