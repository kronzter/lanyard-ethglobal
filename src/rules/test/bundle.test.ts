// Assembling, signing, reading back and reproducing evidence bundles.
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "@/shared/canonical";
import { verifyEnvelope } from "@/shared/evidence/bundle";
import { createFixtureEnsReader } from "@/shared/mocks/fixtures";
import { assembleBody, ENGINE, evaluate, parseBundleText, prepare, reproduce, signBody } from "@/rules";
import { context, frozen, persona, RULES_VERSION, venueObs } from "./harness";

async function body() {
  const records = [
    venueObs(9_021_700n),
    venueObs(9_021_800n, undefined, { creator: persona("ravi").address, byLabel: "ravi.volunteers" }),
  ];
  const ctx = context();
  const { ens } = await prepare(records, createFixtureEnsReader(), ctx, frozen);
  return assembleBody({
    context: ctx,
    config: frozen as unknown as Record<string, unknown>,
    ruleVersion: RULES_VERSION,
    records,
    ens,
    diagnostics: { intervals: [], gaps: [], knownKeys: records.length },
    decryption: { keyId: "test", suite: "none", privateKey: `0x${"00".repeat(32)}` },
    prizes: [],
    output: evaluate(records, ens, ctx, frozen, RULES_VERSION),
    bundleUri: "https://bundles.lanyard.example/test.json",
  });
}

describe("evidence bundles", () => {
  it("reproduces its own output from its retained inputs", async () => {
    const r = reproduce(ENGINE, await body());
    expect(r.match).toBe(true);
    expect(r.output.verdicts.map((v) => v.counts)).toEqual([true, false]);
  });

  it("names the first verdict that differs from the claimed output", async () => {
    const b = await body();
    const tampered = { ...b, output: structuredClone(b.output) as typeof b.output };
    (tampered.output as { verdicts: { counts: boolean }[] }).verdicts[1]!.counts = true;
    const r = reproduce(ENGINE, tampered);
    expect(r).toMatchObject({ match: false, difference: expect.stringMatching(/^verdict 1/) });
  });

  it("signs, writes and reads back a bundle with its hash checked", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const envelope = await signBody(await body(), (message) => account.signMessage({ message }));
    const read = parseBundleText(canonicalJson(envelope));
    expect(read.bundleHash).toBe(envelope.bundleHash);
    await expect(
      verifyEnvelope(envelope, account.address.toLowerCase() as `0x${string}`),
    ).resolves.toBeTruthy();
    expect(() => parseBundleText(canonicalJson({ ...envelope, bundleHash: `0x${"00".repeat(32)}` }))).toThrow(
      /bundleHash/,
    );
  });

  it("refuses an out-of-window context unless explicitly allowed", async () => {
    const b = await body();
    const early = structuredClone(b);
    early.context.arkivCutoff.timestamp = frozen.times.results - 1n;
    early.context.sepoliaCutoff.timestamp = frozen.times.results - 1n;
    expect(() => parseBundleText(canonicalJson(early))).toThrow(/freeze window/);
    expect(parseBundleText(canonicalJson(early), { allowOutOfWindow: true }).body.event).toBe("mumbai2026");
  });
});
