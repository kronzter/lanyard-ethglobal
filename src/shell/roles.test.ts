import { describe, expect, it } from "vitest";
import personasJson from "../../fixtures/personas.json";
import { eventConfig } from "@/shared/event.config";
import { parsePersonas } from "@/shared/fixtures/personas";
import {
  createFixtureEnsReader,
  createFixtureIdentityDirectory,
  fixtureTimeline,
} from "@/shared/mocks/fixtures";
import type { Address } from "@/shared/types/primitives";
import { DEFAULT_MOCK_MOMENT, mockMoments } from "./mock-clock";
import { authorityRoles, ensName, roleKey, roleTitle, rolesFor, screensFor, type ShellRole } from "./roles";
import { ROUTES } from "./routes";

const personas = parsePersonas(personasJson).personas;
const addressOf = (id: string) => personas.find((p) => p.id === id)!.address as Address;
const directory = createFixtureIdentityDirectory(createFixtureEnsReader());
const moments = mockMoments(fixtureTimeline());
const blockOf = (id: string) => ({ sepoliaBlock: moments.find((m) => m.id === id)!.block });
const now = blockOf(DEFAULT_MOCK_MOMENT);
const roles = (id: string, at = now) => rolesFor(addressOf(id), directory, at, eventConfig);
const badges = (rs: ShellRole[]) => rs.flatMap((r) => (r.kind === "badge" ? [r.label] : []));

describe("authorityRoles", () => {
  it("matches configured wallets in any letter case", () => {
    const upper = eventConfig.authorities.organizer.toUpperCase().replace("0X", "0x") as Address;
    expect(authorityRoles(upper, eventConfig)).toEqual([{ kind: "authority", authority: "organizer" }]);
    expect(authorityRoles(eventConfig.authorities.partners.ens!, eventConfig)).toEqual([
      { kind: "authority", authority: "partner:ens" },
    ]);
  });

  it("finds nothing for other wallets", () => {
    expect(authorityRoles("0x000000000000000000000000000000000000dead", eventConfig)).toEqual([]);
  });
});

describe("rolesFor on the fixture chain", () => {
  it("gives a team lead both the team name and their hackers badge", async () => {
    expect(badges(await roles("zkpay-a"))).toEqual(["zkpay", "zkpay-a.hackers"]);
  });

  it("gives an authority wallet its role without needing any badge", async () => {
    expect(await roles("results")).toEqual([{ kind: "authority", authority: "results" }]);
  });

  it("lists the organizer's authority before the structural names it owns", async () => {
    const rs = await roles("organizer");
    expect(rs[0]).toEqual({ kind: "authority", authority: "organizer" });
    expect(badges(rs)).toEqual(["", "hackers", "judges", "partners", "volunteers"]);
  });

  it("lists a partner's authority before the partner name and sub-books it owns", async () => {
    const rs = await roles("partner-arkiv");
    expect(rs[0]).toEqual({ kind: "authority", authority: "partner:arkiv" });
    expect(badges(rs)).toEqual(["arkiv.partners", "judges.arkiv.partners", "staff.arkiv.partners"]);
  });

  it("decides by ownership, not address records: Ravi does not get Anita's badge", async () => {
    expect(badges(await roles("ravi"))).toEqual(["ravi.volunteers"]);
    expect(badges(await roles("anita"))).toEqual(["anita.volunteers"]);
  });

  it("drops a judge unregistered after results", async () => {
    expect(badges(await roles("gita", blockOf("judging")))).toEqual(["gita.judges"]);
    expect(badges(await roles("gita", blockOf("after-results")))).toEqual([]);
  });

  it("finds nothing once the edition lapses, and nothing for an unknown wallet", async () => {
    expect(badges(await roles("zkpay-a", blockOf("head")))).toEqual([]);
    expect(await rolesFor("0x000000000000000000000000000000000000dead", directory, now, eventConfig)).toEqual(
      [],
    );
  });
});

describe("screensFor", () => {
  const known = new Set(ROUTES.map((r) => r.path));

  it("only offers screens that exist, for every persona's roles", async () => {
    for (const p of personas) {
      for (const r of await roles(p.id)) {
        for (const s of screensFor(r)) expect(known, `${roleKey(r)} → ${s}`).toContain(s);
      }
    }
  });

  it("routes each kind of role to its screens", () => {
    const badge = (label: string, role: string): ShellRole => ({ kind: "badge", label, role });
    expect(screensFor({ kind: "authority", authority: "organizer" })).toEqual([
      "/organizer",
      "/admin/ens",
      "/venue",
    ]);
    expect(screensFor({ kind: "authority", authority: "results" })).toEqual([]);
    expect(screensFor(badge("zkpay-a.hackers", "hacker"))).toEqual(["/tickets"]);
    expect(screensFor(badge("zkpay", "team-lead"))).toEqual(["/team"]);
    expect(screensFor(badge("ravi.volunteers", "volunteer"))).toEqual(["/volunteer", "/lead", "/tickets"]);
    expect(screensFor(badge("gita.judges", "global-judge"))).toEqual(["/judge"]);
    expect(screensFor(badge("sam.staff.arkiv.partners", "partner-staff:arkiv"))).toEqual(["/tickets"]);
    expect(screensFor(badge("x.y", "unknown"))).toEqual([]);
  });
});

describe("display", () => {
  it("builds ENS names forward from the label", () => {
    const names = { edition: eventConfig.edition, baseName: eventConfig.baseName };
    expect(ensName("zkpay-a.hackers", names)).toBe("zkpay-a.hackers.mumbai2026.lanyard.eth");
    expect(ensName("", names)).toBe("mumbai2026.lanyard.eth");
  });

  it("titles roles for the selector", () => {
    expect(roleTitle({ kind: "authority", authority: "partner:arkiv" })).toBe("Partner · arkiv");
    expect(roleTitle({ kind: "badge", label: "fatima.judges.ens.partners", role: "partner-judge:ens" })).toBe(
      "Judge · ens",
    );
    expect(roleTitle({ kind: "badge", label: "q", role: "unknown" })).toBe("Unrecognized badge");
  });
});
