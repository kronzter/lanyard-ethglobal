// The rules' cross-runtime vector (B2.3-R7): a small signed evidence bundle whose recomputed
// output must byte-match on Node, in the browser and on Hermes. `pnpm rules:version` regenerates
// it whenever RULES_VERSION changes. It is signed with the fixture results wallet, derived at
// runtime from the public `test … junk` mnemonic in fixtures/personas.json; no key is written.
import { mnemonicToAccount } from "viem/accounts";
import personasJson from "../fixtures/personas.json";
import { mockBlockHash } from "../cli/sepolia-blocks";
import { bytesToHex } from "viem";
import { canonicalBytes } from "../src/shared/canonical";
import { createFixtureEnsReader, fixtureVenue } from "../src/shared/mocks/fixtures";
import type { EvidenceEnvelope } from "../src/shared/evidence/bundle";
import type { Hex } from "../src/shared/types/primitives";
import { assembleBody, prepareWith, RULES, signBody, evaluateWith, type Engine } from "../src/rules";
import { context, frozen, key, obs, persona } from "../src/rules/test/harness";

export const RULES_VECTOR_FILE = "src/rules/test/vectors/rules-bundle.json";
export const RESULTS_HD_INDEX = 1;

/** The fixture results wallet (HD index 1 of the public test mnemonic). */
export const fixtureResultsAccount = () =>
  mnemonicToAccount((personasJson as { mnemonic: string }).mnemonic, { addressIndex: RESULTS_HD_INDEX });

/** An in-window context whose Sepolia cutoff carries the mock chain's block hash. */
export function vectorContext() {
  const c = context();
  return {
    ...c,
    sepoliaCutoff: {
      ...c.sepoliaCutoff,
      hash: mockBlockHash(frozen.chains.sepolia.chainId, c.sepoliaCutoff.number),
    },
  };
}

export function vectorRecords() {
  const org = persona("organizer");
  const ravi = persona("ravi");
  const arkiv = persona("partner-arkiv");
  const venueKey = key(0x1000n);
  const seat = (k: bigint, creator: Hex, by: string, label: string, address: string) =>
    obs({
      key: key(k),
      kind: "seat_assignment",
      creator,
      byLabel: by,
      at: 9_022_000n,
      attrs: {
        hacker_label: ["str", label],
        hacker_address: ["addr", address],
        seat: ["str", "w1"],
        venue: ["key", venueKey],
      },
    });
  return [
    obs({
      key: venueKey,
      kind: "venue",
      creator: org.address,
      byLabel: "organizer",
      at: 9_021_700n,
      attrs: {
        version: ["str", "v1 — café 東京 🎪"],
        payload: ["bytes", bytesToHex(canonicalBytes({ ...fixtureVenue(), name: "Hall — café 東京 🎪" }))],
      },
    }),
    seat(0x1001n, org.address, "organizer", "zkpay-a.hackers", persona("zkpay-a").address),
    seat(0x1002n, ravi.address, ravi.by, "zkpay-b.hackers", persona("zkpay-b").address),
    seat(0x1003n, org.address, "organizer", "zkpay-c.hackers", persona("zkpay-d").address),
    obs({
      key: key(0x1004n),
      kind: "rubric",
      creator: arkiv.address,
      byLabel: arkiv.by,
      at: 9_023_000n,
      attrs: {
        track: ["str", "arkiv"],
        payload: [
          "bytes",
          bytesToHex(canonicalBytes({ criteria: [{ id: "impact", name: "Impact", weight: 1 }], scale: 10 })),
        ],
      },
    }),
    obs({
      key: key(0x1005n),
      kind: "rubric",
      creator: arkiv.address,
      byLabel: arkiv.by,
      at: 9_023_000n,
      attrs: { track: ["str", "main"], payload: ["bytes", "0x02"] },
    }),
    obs({
      key: key(0x1006n),
      kind: "drip",
      creator: frozen.authorities.desk!,
      byLabel: "desk",
      at: 9_021_650n,
      attrs: { recipient: ["addr", persona("zkpay-a").address], tx: ["str", "0xab"] },
    }),
    obs({
      key: key(0x1007n),
      kind: "shift",
      creator: persona("priya").address,
      byLabel: "priya.volunteers",
      at: 9_022_100n,
    }),
  ];
}

/** Build and sign the vector bundle for a given rules version. */
export async function buildRulesVector(version: Hex): Promise<EvidenceEnvelope> {
  const engine: Engine = { rules: RULES, version };
  const ctx = vectorContext();
  const records = vectorRecords();
  const prepared = await prepareWith(engine, records, createFixtureEnsReader(), ctx, frozen);
  const output = evaluateWith(engine, records, prepared.ens, ctx, frozen, version);
  const body = assembleBody({
    context: ctx,
    config: frozen as unknown as Record<string, unknown>,
    ruleVersion: version,
    records,
    ens: prepared.ens,
    diagnostics: {
      intervals: [{ fromBlock: 0n, toBlock: ctx.arkivCutoff.number }],
      gaps: [],
      knownKeys: records.length,
    },
    decryption: { keyId: "vector-only", suite: "none", privateKey: `0x${"00".repeat(32)}` },
    prizes: [],
    output,
    bundleUri: "https://bundles.lanyard.example/mumbai2026/rules-vector.json",
  });
  const account = fixtureResultsAccount();
  return signBody(body, (message) => account.signMessage({ message }));
}
