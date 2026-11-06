import { describe, expect, it } from "vitest";
import { PERMS_TEXT_KEY, SHIFT_MANAGER, grantsPermission } from "../ens/permission-envelope";
import { EnsReadError } from "../interfaces/ens-reader";
import { createFixtureEnsReader, fixtureEnsHistory, fixtureTimeline } from "../mocks/fixtures";
import { parsePersonas } from "../fixtures/personas";
import personasRaw from "../../../fixtures/personas.json";

const reader = createFixtureEnsReader();
const history = fixtureEnsHistory();
const timeline = fixtureTimeline();
const addr = (id: string) => parsePersonas(personasRaw).personas.find((p) => p.id === id)!.address;
const blockOf = (label: string, type: string, nth = 0) =>
  history.events.filter((e) => e.label === label && e.type === type)[nth]!.block;
const at = (sepoliaBlock: bigint) => ({ sepoliaBlock });
const tb = timeline.times;

describe("MockEnsReader on the fixture day", () => {
  it("shows Priya's lead note one block before its removal and not at the removal block", async () => {
    const removed = history.events
      .filter((e) => e.label === "priya.volunteers" && e.type === "setText")
      .at(-1)!.block;
    expect(await reader.text("priya.volunteers", PERMS_TEXT_KEY, at(removed - 1n))).toMatch(/shift-manager/);
    expect(await reader.text("priya.volunteers", PERMS_TEXT_KEY, at(removed))).toBeNull();
  });

  it("authorizes by owner, not by the address record", async () => {
    const b = tb.eventStart.block + 10n;
    expect(await reader.owner("anita.volunteers", at(b))).toBe(addr("anita"));
    expect(await reader.address("anita.volunteers", at(b))).toBe(addr("ravi"));
  });

  it("invalidates Leela's badge at exactly its expiry", async () => {
    expect(await reader.owner("leela.volunteers", at(tb.submissionDeadline.block - 1n))).toBe(addr("leela"));
    expect(await reader.owner("leela.volunteers", at(tb.submissionDeadline.block))).toBeNull();
    expect(await reader.expiry("leela.volunteers", at(tb.submissionDeadline.block))).toBe(
      tb.submissionDeadline.timestamp,
    );
  });

  it("revives Omar's expired badge with the same registration ID", async () => {
    const before = tb.eventStart.block + 100n;
    const expired = tb.eventStart.block + 6n * 300n;
    const revived = blockOf("omar.volunteers", "renew");
    const id = await reader.registrationId("omar.volunteers", at(before));
    expect(await reader.owner("omar.volunteers", at(expired))).toBeNull();
    expect(await reader.registrationId("omar.volunteers", at(expired))).toBeNull();
    expect(await reader.owner("omar.volunteers", at(revived))).toBe(addr("omar"));
    expect(await reader.registrationId("omar.volunteers", at(revived))).toBe(id);
    expect(await reader.unregisteredBetween("omar.volunteers", before, revived)).toBe(false);
  });

  it("makes Kabir's stale lead note grant nothing after the reissue", async () => {
    const reissued = blockOf("kabir.volunteers", "register", 1);
    const check = async (b: bigint) =>
      grantsPermission(
        await reader.text("kabir.volunteers", PERMS_TEXT_KEY, at(b)),
        {
          registrationId: await reader.registrationId("kabir.volunteers", at(b)),
          owner: await reader.owner("kabir.volunteers", at(b)),
        },
        SHIFT_MANAGER,
      );
    expect(await check(reissued - 2n)).toBe(true);
    expect(await reader.owner("kabir.volunteers", at(reissued - 1n))).toBeNull(); // unregistered block
    expect(await reader.text("kabir.volunteers", PERMS_TEXT_KEY, at(reissued))).toMatch(/shift-manager/); // still readable
    expect(await check(reissued)).toBe(false);
    expect(await reader.unregisteredBetween("kabir.volunteers", reissued - 2n, reissued)).toBe(true);
  });

  it("keeps Rahul's note valid across renewal", async () => {
    const renewed = blockOf("rahul.volunteers", "renew");
    const before = await reader.registrationId("rahul.volunteers", at(renewed - 1n));
    expect(await reader.registrationId("rahul.volunteers", at(renewed))).toBe(before);
    expect(await reader.expiry("rahul.volunteers", at(renewed))).toBe(tb.eventEnd.timestamp + 86_400n);
  });

  it("drops a revoked judge from the unregister block on", async () => {
    const u = blockOf("ben.judges.arkiv.partners", "unregister");
    expect(await reader.owner("ben.judges.arkiv.partners", at(u - 1n))).toBe(addr("ben"));
    expect(await reader.owner("ben.judges.arkiv.partners", at(u))).toBeNull();
    expect(await reader.unregisteredBetween("ben.judges.arkiv.partners", u, u)).toBe(true);
    expect(await reader.unregisteredBetween("ben.judges.arkiv.partners", u + 1n, u)).toBe(false);
  });

  it("keeps partner judges valid after the event ends, until the freeze deadline", async () => {
    expect(await reader.owner("ana.judges.arkiv.partners", at(tb.eventEnd.block + 1n))).toBe(addr("ana"));
    expect(await reader.owner("ana.judges.arkiv.partners", at(tb.freezeDeadline.block))).toBeNull();
    expect(await reader.owner("arkiv.partners", at(tb.freezeDeadline.block))).toBe(addr("partner-arkiv"));
  });

  it("stops resolving a team once its ancestor, the edition, lapses", async () => {
    expect(await reader.owner("zkpay", at(tb.freezeDeadline.block))).toBe(addr("zkpay-a"));
    expect(await reader.expiry("zkpay", at(timeline.head))).toBeGreaterThan(BigInt(timeline.head));
    expect(await reader.owner("zkpay", at(timeline.head))).toBeNull();
  });

  it("maps timestamps to the latest block at or before them", async () => {
    expect(await reader.sepoliaBlockAt(tb.results.timestamp)).toBe(tb.results.block);
    expect(await reader.sepoliaBlockAt(tb.results.timestamp + 7n)).toBe(tb.results.block);
    expect(await reader.headBlock()).toBe(timeline.head);
  });

  it("throws instead of answering on RPC failure or an out-of-range block", async () => {
    const broken = createFixtureEnsReader({ fail: () => true });
    await expect(broken.owner("priya.volunteers", at(tb.eventStart.block))).rejects.toThrow(EnsReadError);
    await expect(reader.owner("priya.volunteers", at(timeline.head + 1n))).rejects.toThrow(/beyond the head/);
    await expect(reader.sepoliaBlockAt(0n)).rejects.toThrow(EnsReadError);
  });
});
