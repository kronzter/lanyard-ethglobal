import { mnemonicToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson, parseJsonStrict } from "../canonical";
import {
  EvidenceError,
  assertSummaryFits,
  bundleHashOf,
  evidenceSigningMessage,
  parseEvidenceBody,
  resultsBodyOf,
  resultsHashOf,
  verifyEnvelope,
  type EvidenceEnvelope,
} from "../evidence/bundle";
import { eventConfig } from "../event.config";

const MNEMONIC = "test test test test test test test test test test test junk"; // public test mnemonic
const resultsWallet = mnemonicToAccount(MNEMONIC, { addressIndex: 1 });
const stranger = mnemonicToAccount(MNEMONIC, { addressIndex: 2 });
const h = (c: string) => `0x${c.repeat(64)}`;
const t = eventConfig.times;
const config = { edition: "mumbai2026", times: t, schemaVersion: 1 };

const record = (key: string, createdAtBlock: string) => ({
  key,
  kind: "final_score",
  creator: "0x00000000000000000000000000000000000000c1",
  owner: "0x00000000000000000000000000000000000000c1",
  flags: { readonly: true, permissionlessExtension: false },
  createdAtBlock,
  updatedAtBlock: createdAtBlock,
  expiresAtBlock: "999999",
  createdAtTimestamp: "1796540000",
  observedAtBlock: "900000",
  observedAtBlockHash: h("b"),
  network: { chainId: 7794095, resetId: h("c") },
  attributes: [{ name: "kind", type: "str", indexed: true, value: "final_score" }],
  payload: "0x01",
});

const rawBody = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  event: "mumbai2026",
  context: {
    event: "mumbai2026",
    arkivChainId: 7794095,
    arkivResetId: h("c"),
    sepoliaChainId: 11155111,
    arkivCutoff: { number: "900100", hash: h("d"), timestamp: String(t.results + 60n) },
    sepoliaCutoff: { number: "9037205", hash: h("e"), timestamp: String(t.results + 48n) },
    configHash: canonicalHash(config),
  },
  config,
  ruleVersion: h("f"),
  records: [record(h("2"), "100"), record(h("1"), "200")],
  ens: [
    {
      label: "ana.judges.arkiv.partners",
      block: "9030000",
      query: "owner",
      key: "",
      result: "0x00000000000000000000000000000000000000c1",
    },
    {
      label: "ana.judges.arkiv.partners",
      block: "9030000",
      query: "registrationId",
      key: "",
      result: h("9"),
    },
  ],
  diagnostics: { intervals: [{ fromBlock: "1", toBlock: "900100" }], gaps: [], knownKeys: 2 },
  decryption: { keyId: "k1", suite: "x25519-hkdf-sha256-aes-256-gcm", privateKey: h("7") },
  prizes: [{ team: "zkpay", prizes: ["Arkiv track, 1st"] }],
  output: { rankings: [{ team: "zkpay", score: "17/2" }] },
  bundleUri: "https://evidence.example/mumbai2026/bundle.json",
  ...patch,
});

async function envelope(
  signer = resultsWallet,
  body = parseEvidenceBody(rawBody()),
): Promise<EvidenceEnvelope> {
  const bundleHash = bundleHashOf(body);
  return {
    body,
    bundleHash,
    signature: await signer.signMessage({ message: evidenceSigningMessage(bundleHash) }),
  };
}

describe("evidence body", () => {
  it("survives a canonical JSON round trip with the same hash", () => {
    const body = parseEvidenceBody(rawBody());
    const reparsed = parseEvidenceBody(parseJsonStrict(canonicalJson(body)));
    expect(bundleHashOf(reparsed)).toBe(bundleHashOf(body));
  });

  it.each([
    ["unsorted records", { records: [record(h("1"), "200"), record(h("2"), "100")] }, /sorted/],
    [
      "a duplicated record",
      { records: [record(h("2"), "100"), record(h("2"), "100")] },
      /one observation per key/,
    ],
    ["unsorted ENS entries", { ens: [...rawBody().ens].reverse() }, /ENS entries must be sorted/],
    ["a config that does not match its hash", { config: { ...config, edition: "other" } }, /configHash/],
    [
      "a cutoff before results",
      {
        context: {
          ...rawBody().context,
          arkivCutoff: { number: "1", hash: h("d"), timestamp: String(t.results - 1n) },
        },
      },
      /outside the freeze window/,
    ],
    [
      "a cutoff at the freeze deadline",
      {
        context: {
          ...rawBody().context,
          sepoliaCutoff: { number: "1", hash: h("e"), timestamp: String(t.freezeDeadline) },
        },
      },
      /outside the freeze window/,
    ],
    [
      "an ENS read past the Sepolia cutoff",
      { ens: [{ label: "a.judges", block: "9999999", query: "owner", key: "", result: null }] },
      /past the Sepolia cutoff/,
    ],
    ["an http bundle URI", { bundleUri: "http://evidence.example/b.json" }, /https/],
    ["an Arkiv results key in the body", { resultsKey: h("4") }, /Unrecognized|unrecognized/],
  ])("rejects %s", (_name, patch, message) => {
    expect(() => parseEvidenceBody(rawBody(patch))).toThrow(message);
  });
});

describe("envelope signature", () => {
  it("signs the exact Lanyard message and verifies against the configured results wallet", async () => {
    const env = await envelope();
    expect(evidenceSigningMessage(env.bundleHash)).toBe(`Lanyard evidence v1\n${env.bundleHash}`);
    await expect(verifyEnvelope(env, resultsWallet.address)).resolves.toBeTruthy();
  });

  it("rejects a tampered body, a tampered signature and the wrong signer", async () => {
    const env = await envelope();
    const tampered = {
      ...env,
      body: { ...env.body, prizes: [{ team: "chainchat", prizes: ["Arkiv track, 1st"] }] },
    };
    await expect(verifyEnvelope(tampered, resultsWallet.address)).rejects.toThrow(
      /bundleHash does not match/,
    );
    const flipped = `${env.signature.slice(0, -4)}${env.signature.slice(-4) === "1b1b" ? "1c1c" : "1b1b"}`;
    await expect(verifyEnvelope({ ...env, signature: flipped }, resultsWallet.address)).rejects.toThrow(
      EvidenceError,
    );
    await expect(verifyEnvelope(await envelope(stranger), resultsWallet.address)).rejects.toThrow(
      /not the configured results wallet/,
    );
  });
});

describe("results summary", () => {
  it("is built from the checked envelope and hashes deterministically", async () => {
    const env = await envelope();
    const rb = resultsBodyOf(env, [{ team: "zkpay", score: "17/2" }]);
    expect(rb.bundleHash).toBe(env.bundleHash);
    expect(rb.outputHash).toBe(canonicalHash(env.body.output));
    expect(resultsHashOf(rb)).toBe(resultsHashOf(structuredClone(rb)));
    expect(Object.keys(rb)).not.toContain("resultsKey");
  });

  it("rejects an oversized summary before publication", () => {
    expect(assertSummaryFits({ a: "x" })).toBeLessThan(100);
    expect(() => assertSummaryFits({ a: "x".repeat(128 * 1024) })).toThrow(/over the 131072-byte limit/);
  });
});

describe("retained input scope", () => {
  it("rejects unresolved gaps, mutable inputs and results rows", () => {
    const body = rawBody();
    expect(() =>
      parseEvidenceBody({
        ...body,
        diagnostics: { ...body.diagnostics, gaps: [{ fromBlock: "1", toBlock: "2", reason: "missed scan" }] },
      }),
    ).toThrow(/gaps/);
    for (const patch of [{ kind: "results" }, { flags: { readonly: false, permissionlessExtension: false } }])
      expect(() =>
        parseEvidenceBody({ ...body, records: body.records.map((r) => ({ ...r, ...patch })) }),
      ).toThrow(/not ranking evidence/);
  });
});
