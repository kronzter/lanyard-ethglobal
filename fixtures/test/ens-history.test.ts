import { describe, expect, it } from "vitest";
import { checkAncestorLifetimes, namespaceExpiry } from "@/shared/config/validate";
import { PERMS_TEXT_KEY, SHIFT_MANAGER, parsePermissionEnvelope } from "@/shared/ens/permission-envelope";
import { registrationIdOf } from "@/shared/ens/registration-id";
import { eventConfig } from "@/shared/event.config";
import { parseEnsHistory, parentLabel, registryOf, type EnsEvent } from "@/shared/fixtures/ens-history";
import { parsePersonas } from "@/shared/fixtures/personas";
import { parseTimeline } from "@/shared/fixtures/timeline";
import historyRaw from "../ens-history.json";
import personasRaw from "../personas.json";
import timelineRaw from "../timeline.json";

const history = parseEnsHistory(historyRaw);
const timeline = parseTimeline(timelineRaw);
const personas = parsePersonas(personasRaw).personas;
const t = eventConfig.times;
const of = <T extends EnsEvent["type"]>(type: T) =>
  history.events.filter((e): e is Extract<EnsEvent, { type: T }> => e.type === type);
const tb = timeline.times;

describe("ens-history.json shape", () => {
  it("keeps every event between genesis and head, in block order", () => {
    for (const e of history.events) {
      expect(e.block).toBeGreaterThanOrEqual(timeline.genesis.block);
      expect(e.block).toBeLessThanOrEqual(timeline.head);
    }
  });

  it("has a registry for every registered label's parent", () => {
    for (const e of of("register")) expect(() => registryOf(history, e.label), e.label).not.toThrow();
  });

  it("registers every name before any other event touches it", () => {
    const seen = new Set<string>();
    for (const e of history.events) {
      if (e.type === "register") seen.add(e.label);
      else expect(seen.has(e.label), `${e.type} ${e.label}`).toBe(true);
    }
  });

  it("registers only persona wallets", () => {
    const addresses = new Set(personas.map((p) => p.address));
    for (const e of of("register")) expect(addresses.has(e.owner), e.label).toBe(true);
  });

  it("issues every persona badge to that persona", () => {
    for (const p of personas) {
      for (const label of p.labels) {
        expect(
          of("register").some((e) => e.label === label && e.owner === p.address),
          label,
        ).toBe(true);
      }
    }
  });
});

describe("the scripted day (P0.4-R3)", () => {
  it("issues badges when the event starts", () => {
    expect(
      of("register").filter((e) => e.block >= tb.eventStart.block && e.label.endsWith(".hackers")).length,
    ).toBe(12);
  });

  it("makes Priya lead with a registration-bound note, then removes it at a known block", () => {
    const notes = of("setText").filter((e) => e.label === "priya.volunteers" && e.key === PERMS_TEXT_KEY);
    expect(notes.map((e) => e.value === null)).toEqual([false, true]);
    const env = parsePermissionEnvelope(notes[0]!.value);
    const reg = of("register").find((e) => e.label === "priya.volunteers")!;
    expect(env).toMatchObject({
      holder: personas.find((p) => p.id === "priya")!.address,
      permissions: [SHIFT_MANAGER],
      registrationId: registrationIdOf({
        chainId: history.chainId,
        registry: registryOf(history, reg.label),
        resource: reg.resource,
      }),
    });
  });

  it("unregisters one judge mid-judging", () => {
    const u = of("unregister").filter(
      (e) =>
        e.label.includes(".judges") && e.block > tb.submissionDeadline.block && e.block < tb.judgingEnd.block,
    );
    expect(u.map((e) => e.label)).toEqual(["ben.judges.arkiv.partners"]);
  });

  it("lets one badge reach its expiry during the event without renewal", () => {
    const leela = of("register").find((e) => e.label === "leela.volunteers")!;
    expect(leela.expiry).toBe(t.submissionDeadline);
    expect(of("renew").some((e) => e.label === "leela.volunteers")).toBe(false);
  });

  it("revives one expired badge by renewal", () => {
    const reg = of("register").find((e) => e.label === "omar.volunteers")!;
    const renew = of("renew").find((e) => e.label === "omar.volunteers")!;
    expect(renew.block).toBeGreaterThan(tb.eventStart.block + (reg.expiry - t.eventStart) / 12n);
    expect(renew.expiry).toBe(t.eventEnd);
  });
});

describe("edge cases (P0.4-R5)", () => {
  it("has an owner/address disagreement", () => {
    const anita = personas.find((p) => p.id === "anita")!;
    const addr = of("setAddr").find((e) => e.label === "anita.volunteers")!;
    expect(addr.address).not.toBe(anita.address);
  });

  it("leaves a stale lead note on a reissued badge", () => {
    const regs = of("register").filter((e) => e.label === "kabir.volunteers");
    expect(regs).toHaveLength(2);
    expect(regs[0]!.resource).not.toBe(regs[1]!.resource);
    const lastNote = of("setText")
      .filter((e) => e.label === "kabir.volunteers")
      .at(-1)!;
    expect(lastNote.block).toBeLessThan(regs[1]!.block); // never refreshed after reissue
  });

  it("revokes a judge after a freeze cutoff at results", () => {
    const late = of("unregister").filter((e) => e.block > tb.results.block);
    expect(late.map((e) => e.label)).toEqual(["gita.judges"]);
  });

  it("keeps partner ancestors and every structural name alive past namespaceExpiry", () => {
    const structural = of("register").filter(
      (e) =>
        parentLabel(e.label) === "" ||
        parentLabel(e.label) === "@base" ||
        /^(judges|staff)\.[a-z]+\.partners$|^[a-z]+\.partners$/.test(e.label),
    );
    expect(structural.length).toBeGreaterThanOrEqual(1 + 4 + 2 + 4 + 3);
    expect(() =>
      checkAncestorLifetimes(
        t,
        structural.map((e) => ({ name: e.label || "(edition)", expiry: e.expiry })),
      ),
    ).not.toThrow();
    for (const e of structural) expect(e.expiry, e.label).toBeGreaterThanOrEqual(namespaceExpiry(t));
  });

  it("lets team names outlive the edition, so the head block exercises ancestor expiry", () => {
    const edition = of("register").find((e) => e.label === "")!;
    const zkpay = of("register").find((e) => e.label === "zkpay")!;
    expect(zkpay.expiry).toBeGreaterThan(edition.expiry);
    expect(timeline.genesis.timestamp + (timeline.head - timeline.genesis.block) * 12n).toBeGreaterThan(
      edition.expiry,
    );
  });
});
