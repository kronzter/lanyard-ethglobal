import { describe, expect, it } from "vitest";
import { canonicalBytes, canonicalHash } from "@/shared/canonical";
import { openScore, scorePublicKey, scoreKeyId, sealScore, scoreAad } from "@/shared/crypto/score-cipher";
import { createFixtureEnsReader } from "@/shared/mocks/fixtures";
import { ENGINE, evaluateWith, prepareWith } from "@/rules";
import { dependencies } from "./judging-fixtures";
import { frozen, context, obs, persona } from "./harness";
const secret = `0x${"b2".repeat(32)}` as const;
const publicKey = scorePublicKey(secret);
const cipher = { ...frozen.scoreCipher, publicKey, keyId: scoreKeyId(publicKey) };
const config = { ...frozen, scoreCipher: cipher };
const material = { privateKey: secret, keyId: cipher.keyId, suite: cipher.suite };
async function scenario(
  options: {
    invalidFirst?: boolean;
    recuse?: boolean;
    forged?: boolean;
    badValues?: boolean;
    judge?: string;
    revoked?: boolean;
  } = {},
) {
  const { s, r, a, assignment } = dependencies();
  const judge = options.judge ?? "hari.judges";
  const who = persona(judge.split(".")[0]!);
  const assign = assignment(judge);
  const aad = scoreAad({
    event: config.edition,
    submission: s.key,
    assignment: assign.key,
    rubric: r.key,
    judge,
  });
  const final = (at: bigint, ciphertext: `0x${string}`) =>
    obs({
      kind: "final_score",
      creator: who.address,
      byLabel: judge,
      at,
      attrs: {
        submission: ["key", s.key],
        assignment: ["key", assign.key],
        rubric: ["key", r.key],
        judge: ["str", judge],
        ciphertext: ["bytes", ciphertext],
      },
    });
  const seal = (values: Record<string, number>) =>
    sealScore(publicKey, canonicalBytes({ schemaVersion: 1, values }), aad);
  const first = final(
    9_022_004n,
    options.invalidFirst ? "0x00" : seal(options.badValues ? { impact: 1001 } : { impact: 750 }),
  );
  const next = final(9_022_005n, seal({ impact: 800 }));
  const recusal = obs({
    kind: "recusal",
    creator: options.forged ? persona("ana").address : who.address,
    byLabel: options.forged ? persona("ana").by : judge,
    at: 9_022_006n,
    attrs: { submission: ["key", s.key], judge: ["str", judge] },
  });
  const records = [s, r, a, assign, first, next, ...(options.recuse ? [recusal] : [])];
  const ctx = { ...context(), configHash: canonicalHash(config) };
  const reader = createFixtureEnsReader();
  if (options.revoked) reader.unregisteredBetween = async () => true;
  const prepared = await prepareWith(ENGINE, records, reader, ctx, config);
  const evaluate = (key = material) =>
    evaluateWith(ENGINE, records, prepared.ens, ctx, config, ENGINE.version, key);
  return { records, ctx, prepared, config, first, next, recusal, evaluate };
}
describe("sealed score decisions", () => {
  it("rejects invalid ciphertext before choosing the earliest valid final", async () => {
    const s = await scenario({ invalidFirst: true });
    const out = s.evaluate();
    expect(out.verdicts.find((v) => v.key === s.first.key)?.reason).toMatch(/malformed/);
    expect(out.verdicts.find((v) => v.key === s.next.key)?.counts).toBe(true);
    expect(out.scores?.find((v) => v.key === s.next.key)?.values).toEqual({ impact: 800 });
  });
  it("rejects out-of-range values without blocking a later valid final", async () => {
    const s = await scenario({ badValues: true });
    expect(s.evaluate().verdicts.find((v) => v.key === s.first.key)?.reason).toMatch(/invalid score values/);
    expect(s.evaluate().verdicts.find((v) => v.key === s.next.key)?.counts).toBe(true);
  });
  it("excludes later valid duplicates and exposes no values before freeze", async () => {
    const s = await scenario();
    expect(s.evaluate().verdicts.find((v) => v.key === s.next.key)?.reason).toMatch(/duplicate final/);
    const before = evaluateWith(ENGINE, s.records, s.prepared.ens, s.ctx, s.config, ENGINE.version);
    expect(before.scores).toBeUndefined();
  });
  it("applies later valid self-recusal before decrypting, but rejects another judge's recusal", async () => {
    const s = await scenario({ recuse: true, invalidFirst: true });
    expect(s.evaluate().verdicts.find((v) => v.key === s.first.key)?.reason).toMatch(/recused/);
    const forged = await scenario({ recuse: true, forged: true });
    expect(forged.evaluate().verdicts.find((v) => v.key === forged.recusal.key)?.counts).toBe(false);
    expect(forged.evaluate().verdicts.find((v) => v.key === forged.first.key)?.counts).toBe(true);
  });
  it("stops on a wrong operator key", async () => {
    const s = await scenario();
    expect(() => s.evaluate({ ...material, privateKey: `0x${"11".repeat(32)}` })).toThrow(/key/);
  });
  it("never decrypts a badge revoked before the cutoff", async () => {
    const s = await scenario({ judge: "hari.judges", invalidFirst: true, revoked: true });
    const v = s.evaluate().verdicts.find((v) => v.key === s.first.key);
    expect(v?.counts).toBe(false);
    expect(v?.reason).toMatch(/unregistered/);
  });
  it("binds ciphertext to its complete context", () => {
    const aad = scoreAad({
      event: "e",
      submission: `0x${"12".repeat(32)}`,
      assignment: `0x${"34".repeat(32)}`,
      rubric: `0x${"56".repeat(32)}`,
      judge: "hari.judges",
    });
    const sealed = sealScore(publicKey, canonicalBytes({ schemaVersion: 1, values: { impact: 750 } }), aad);
    expect(() => openScore(secret, sealed, new Uint8Array())).toThrow(/authentication/);
  });
});
