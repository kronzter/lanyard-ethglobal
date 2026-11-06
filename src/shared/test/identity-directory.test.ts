import { describe, expect, it } from "vitest";
import personasRaw from "../../../fixtures/personas.json";
import { roleOfLabel } from "../ens/roles";
import { parsePersonas } from "../fixtures/personas";
import { EnsReadError } from "../interfaces/ens-reader";
import {
  createFixtureEnsReader,
  createFixtureIdentityDirectory,
  fixtureEnsHistory,
  fixtureTimeline,
} from "../mocks/fixtures";

const directory = createFixtureIdentityDirectory();
const tb = fixtureTimeline().times;
const addr = (id: string) => parsePersonas(personasRaw).personas.find((p) => p.id === id)!.address;
const during = { sepoliaBlock: tb.eventStart.block + 10n };

describe("roleOfLabel", () => {
  it.each([
    ["", "edition-owner"],
    ["volunteers", "book-owner:volunteers"],
    ["zkpay", "team-lead"],
    ["winner.zkpay", "winner:zkpay"],
    ["sam.zkpay", "team-member:zkpay"],
    ["zkpay-a.hackers", "hacker"],
    ["priya.volunteers", "volunteer"],
    ["gita.judges", "global-judge"],
    ["arkiv.partners", "partner:arkiv"],
    ["staff.arkiv.partners", "partner-sub-book-owner:staff.arkiv"],
    ["ana.judges.arkiv.partners", "partner-judge:arkiv"],
    ["sam.staff.arkiv.partners", "partner-staff:arkiv"],
    ["x.y.z.w.v", "unknown"],
  ])("%j → %s", (label, role) => expect(roleOfLabel(label)).toBe(role));
});

describe("MockIdentityDirectory", () => {
  it("returns every owned role, sorted by label, so a multi-role wallet can choose", async () => {
    expect(await directory.labelsFor(addr("zkpay-a"), during)).toEqual([
      { label: "zkpay", role: "team-lead" },
      { label: "zkpay-a.hackers", role: "hacker" },
    ]);
    expect((await directory.labelsFor(addr("partner-arkiv"), during)).map((r) => r.label)).toEqual([
      "arkiv.partners",
      "judges.arkiv.partners",
      "staff.arkiv.partners",
    ]);
  });

  it("never grants a role through an address record", async () => {
    expect(await directory.labelsFor(addr("ravi"), during)).toEqual([
      { label: "ravi.volunteers", role: "volunteer" },
    ]);
    expect(await directory.labelsFor(addr("anita"), during)).toEqual([
      { label: "anita.volunteers", role: "volunteer" },
    ]);
  });

  it("checks ownership at the requested block", async () => {
    expect(await directory.labelsFor(addr("priya"), { sepoliaBlock: tb.eventStart.block - 1n })).toEqual([]);
    const unregistered = fixtureEnsHistory().events.find(
      (e) => e.label === "ben.judges.arkiv.partners" && e.type === "unregister",
    )!;
    expect(await directory.labelsFor(addr("ben"), { sepoliaBlock: unregistered.block - 1n })).toHaveLength(1);
    expect(await directory.labelsFor(addr("ben"), { sepoliaBlock: unregistered.block })).toEqual([]);
  });

  it("returns nothing for an unknown wallet and accepts any address casing", async () => {
    expect(await directory.labelsFor("0x000000000000000000000000000000000000dead", during)).toEqual([]);
    expect(
      await directory.labelsFor(addr("ravi").toUpperCase().replace("0X", "0x") as `0x${string}`, during),
    ).toHaveLength(1);
  });

  it("surfaces reader failures instead of returning no roles", async () => {
    const failing = createFixtureIdentityDirectory(createFixtureEnsReader({ fail: (m) => m === "owner" }));
    await expect(failing.labelsFor(addr("priya"), during)).rejects.toThrow(EnsReadError);
  });
});
