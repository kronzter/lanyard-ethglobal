// `lanyard verify` and `lanyard hash` (B2.3-R3, R4, R6, R8) against the signed rules vector, a
// persisted mock publication, the fixture ENS history and the mock Sepolia block source.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, parseJsonStrict } from "../src/shared/canonical";
import { eventConfig } from "../src/shared/event.config";
import {
  bundleHashOf,
  resultsBodyOf,
  resultsHashOf,
  type EvidenceEnvelope,
} from "../src/shared/evidence/bundle";
import { parseEvidenceBody } from "../src/shared/evidence/bundle";
import { createFixtureEnsReader, fixtureTimeline } from "../src/shared/mocks/fixtures";
import { MockResultsPublisher } from "../src/shared/mocks/mock-results-publisher";
import { MemoryPublisherStore } from "../src/shared/mocks/publisher-store";
import type { Hex } from "../src/shared/types/primitives";
import { ENGINE, reproduce, signBody } from "../src/rules";
import { RULES_VECTOR_FILE } from "../scripts/rules-vector";
import { fixtureResultsAccount } from "../scripts/rules-vector";
import { mockSepoliaBlocks } from "./sepolia-blocks";
import { hashBundle, verify, type VerifyDeps } from "./verify";

const ROOT = path.resolve(import.meta.dirname, "..");
const vectorText = readFileSync(path.join(ROOT, RULES_VECTOR_FILE), "utf8");
const vector = () => {
  const raw = parseJsonStrict(vectorText) as { body: unknown; bundleHash: Hex; signature: Hex };
  return { ...raw, body: parseEvidenceBody(raw.body) } as EvidenceEnvelope;
};
const EVENT = eventConfig.edition;
const RESULTS_KEY = `0x${"5e".repeat(32)}` as Hex;

async function lockedPublisher(
  env: EvidenceEnvelope,
  patch: Partial<{ bundleHash: Hex; resultsHash: Hex; bundleUri: string }> = {},
  lock = true,
) {
  const publisher = new MockResultsPublisher({ store: new MemoryPublisherStore() });
  await publisher.setEventResults({
    event: EVENT,
    resultsKey: RESULTS_KEY,
    resultsHash: resultsHashOf(resultsBodyOf(env, [])),
    bundleHash: env.bundleHash,
    bundleUri: env.body.bundleUri,
    ...patch,
  });
  if (lock) await publisher.lockResults(await publisher.state());
  return publisher;
}

const deps = (publisher: MockResultsPublisher, overrides: Partial<VerifyDeps> = {}): VerifyDeps => ({
  config: eventConfig,
  ensReader: () => createFixtureEnsReader(),
  publisher: () => publisher,
  sepoliaBlocks: () => mockSepoliaBlocks(fixtureTimeline()),
  ...overrides,
});

const text = (env: unknown) => canonicalJson(env);
const resign = async (body: EvidenceEnvelope["body"]) => {
  const account = fixtureResultsAccount();
  return signBody(body, (message) => account.signMessage({ message }));
};

describe("lanyard verify", () => {
  it("prints MATCH for an intact, signed, locked, reproducible bundle", async () => {
    const env = vector();
    const r = await verify(EVENT, { bundleText: vectorText }, deps(await lockedPublisher(env)));
    expect(r).toMatchObject({ verdict: "MATCH", bundleHash: env.bundleHash });
  });

  it("fetches and hash-checks the committed bundle URI when no path is given", async () => {
    const env = vector();
    const fetched: string[] = [];
    const r = await verify(
      EVENT,
      {},
      deps(await lockedPublisher(env), {
        fetchText: async (uri) => (fetched.push(uri), vectorText),
      }),
    );
    expect(fetched).toEqual([env.body.bundleUri]);
    expect(r.verdict).toBe("MATCH");
  });

  it("offline reproduction is LOCAL_REPRODUCTION, never MATCH, and needs no publication or ENS", async () => {
    const env = vector();
    const r = await verify(
      EVENT,
      { bundleText: vectorText, offline: true },
      deps(await lockedPublisher(env), {
        ensReader: () => {
          throw new Error("must not read ENS offline");
        },
        publisher: () => {
          throw new Error("must not read the publication offline");
        },
      }),
    );
    expect(r.verdict).toBe("LOCAL_REPRODUCTION");
  });

  it("still verifies a saved in-window context long after freezeDeadline (current time is irrelevant)", async () => {
    // Nothing reads a clock; the fixture head is 75 days after the freeze deadline.
    const r = await verify(EVENT, { bundleText: vectorText }, deps(await lockedPublisher(vector())));
    expect(r.verdict).toBe("MATCH");
  });

  describe("never prints MATCH when", () => {
    it("the signature is altered", async () => {
      const env = vector();
      const tampered = {
        ...(parseJsonStrict(vectorText) as object),
        signature: env.signature.replace(/.$/, (c) => (c === "0" ? "1" : "0")),
      };
      const r = await verify(EVENT, { bundleText: text(tampered) }, deps(await lockedPublisher(env)));
      expect(r.verdict).not.toBe("MATCH");
    });

    it("the bundle is signed by a different wallet", async () => {
      const env = vector();
      const other = privateKeyToAccount(`0x${"42".repeat(32)}`);
      const forged = await signBody(env.body, (message) => other.signMessage({ message }));
      const r = await verify(EVENT, { bundleText: text(forged) }, deps(await lockedPublisher(forged)));
      expect(r).toMatchObject({
        verdict: "ERROR",
        reason: expect.stringMatching(/not the configured results wallet/),
      });
    });

    it("a record is changed after signing", async () => {
      const raw = parseJsonStrict(vectorText) as { body: { records: { attributes: { value: string }[] }[] } };
      raw.body.records[0]!.attributes[0]!.value = "tampered";
      const r = await verify(EVENT, { bundleText: text(raw) }, deps(await lockedPublisher(vector())));
      expect(r.verdict).not.toBe("MATCH");
    });

    it("the claimed output differs from the recomputation, even with a valid signature", async () => {
      const env = vector();
      const body = structuredClone(env.body) as typeof env.body & {
        output: { verdicts: { counts: boolean }[] };
      };
      body.output.verdicts[3]!.counts = true;
      const forged = await resign(parseEvidenceBody(body));
      const r = await verify(EVENT, { bundleText: text(forged) }, deps(await lockedPublisher(forged)));
      expect(r).toMatchObject({ verdict: "MISMATCH", reason: expect.stringMatching(/verdict 3/) });
    });

    it("an ENS entry was altered by the operator, even with a valid signature", async () => {
      const env = vector();
      const body = structuredClone(env.body);
      const owner = body.ens.find((e) => e.query === "owner")!;
      owner.result = "0x00000000000000000000000000000000000000ee";
      const resigned = await resign(parseEvidenceBody(body));
      const r = await verify(EVENT, { bundleText: text(resigned) }, deps(await lockedPublisher(resigned)));
      expect(r.verdict).toBe("MISMATCH");
    });

    it("the bundle's config differs from the local edition config", async () => {
      const r = await verify(
        EVENT,
        { bundleText: vectorText },
        deps(await lockedPublisher(vector()), {
          config: { ...eventConfig, venue: { cellSizeMm: 500 } },
        }),
      );
      expect(r).toMatchObject({ verdict: "MISMATCH", reason: expect.stringMatching(/local edition config/) });
    });

    it("the rules version is unavailable", async () => {
      const r = await verify(
        EVENT,
        { bundleText: vectorText },
        deps(await lockedPublisher(vector()), {
          engine: { ...ENGINE, version: `0x${"99".repeat(32)}` },
        }),
      );
      expect(r).toMatchObject({ verdict: "MISMATCH", reason: expect.stringMatching(/unavailable/) });
    });

    it.each([
      ["early", -1n],
      ["late", 0n],
    ])("a signed %s cutoff lies outside [results, freezeDeadline)", async (_name, delta) => {
      const env = vector();
      const t = eventConfig.times;
      const ts = delta < 0n ? t.results + delta : t.freezeDeadline;
      const body = structuredClone(env.body);
      body.context.arkivCutoff.timestamp = ts;
      body.context.sepoliaCutoff.timestamp = ts;
      // A dishonest operator signs it anyway; parsing for signing must allow the window breach.
      const forged = await resign(parseEvidenceBody(body, { allowOutOfWindow: true }));
      const r = await verify(EVENT, { bundleText: text(forged) }, deps(await lockedPublisher(forged)));
      expect(r.verdict).not.toBe("MATCH");
      expect((r as { reason: string }).reason).toMatch(/freeze window/);
    });

    it("the Sepolia cutoff block hash changed (reorg)", async () => {
      const env = vector();
      const r = await verify(
        EVENT,
        { bundleText: vectorText },
        deps(await lockedPublisher(env), {
          sepoliaBlocks: () =>
            mockSepoliaBlocks(fixtureTimeline(), { override: () => `0x${"bb".repeat(32)}` }),
        }),
      );
      expect(r).toMatchObject({ verdict: "MISMATCH", reason: expect.stringMatching(/Sepolia cutoff block/) });
    });

    it("the ENS RPC fails mid-verify, naming the failing read", async () => {
      const r = await verify(
        EVENT,
        { bundleText: vectorText },
        deps(await lockedPublisher(vector()), {
          ensReader: () => createFixtureEnsReader({ fail: (m) => m === "owner" }),
        }),
      );
      expect(r).toMatchObject({
        verdict: "ERROR",
        reason: expect.stringMatching(/reading historical ENS failed: .*owner/),
      });
    });

    it("the publication is missing, unlocked or commits to another bundle", async () => {
      const env = vector();
      const none = new MockResultsPublisher({ store: new MemoryPublisherStore() });
      expect((await verify(EVENT, { bundleText: vectorText }, deps(none))).verdict).toBe("MISMATCH");
      const unlocked = await lockedPublisher(env, {}, false);
      expect(await verify(EVENT, { bundleText: vectorText }, deps(unlocked))).toMatchObject({
        reason: expect.stringMatching(/not locked/),
      });
      const other = await lockedPublisher(env, { bundleHash: `0x${"cd".repeat(32)}` });
      expect((await verify(EVENT, { bundleText: vectorText }, deps(other))).verdict).toBe("MISMATCH");
      const badResults = await lockedPublisher(env, { resultsHash: `0x${"ef".repeat(32)}` });
      expect(await verify(EVENT, { bundleText: vectorText }, deps(badResults))).toMatchObject({
        reason: expect.stringMatching(/resultsHash/),
      });
    });

    it("the bundle is for another event", async () => {
      const r = await verify("berlin2027", { bundleText: vectorText }, deps(await lockedPublisher(vector())));
      expect(r.verdict).toBe("MISMATCH");
    });
  });

  it("deleted captured rows still reproduce (retained bytes are the evidence)", async () => {
    const env = vector();
    const body = structuredClone(env.body);
    body.records[1]!.deletedAtBlock = body.records[1]!.observedAtBlock + 10n;
    const resigned = await resign(parseEvidenceBody(body));
    const r = await verify(EVENT, { bundleText: text(resigned) }, deps(await lockedPublisher(resigned)));
    expect(r.verdict).toBe("MATCH");
  });
});

describe("lanyard hash", () => {
  it("prints the same output hash as a direct reproduction", () => {
    const env = vector();
    const r = hashBundle(EVENT, vectorText);
    expect(r).toMatchObject({
      outputHash: reproduce(ENGINE, env.body).outputHash,
      inWindow: true,
      claimedMatches: true,
    });
    expect(r.bundleHash).toBe(bundleHashOf(env.body));
  });

  it("accepts a bare body and an explicit development context, flagged as outside the window", () => {
    const env = vector();
    const body = structuredClone(env.body);
    body.context.arkivCutoff.timestamp = eventConfig.times.results - 100n;
    body.context.sepoliaCutoff.timestamp = eventConfig.times.results - 100n;
    const r = hashBundle(EVENT, text(body));
    expect(r.inWindow).toBe(false);
    expect(r.claimedMatches).toBe(true); // B2 kinds read no cutoff state
  });

  it("refuses an unavailable rules version", () => {
    expect(() => hashBundle(EVENT, vectorText, { ...ENGINE, version: `0x${"98".repeat(32)}` })).toThrow(
      /unavailable/,
    );
  });
});
