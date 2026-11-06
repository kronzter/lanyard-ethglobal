// Test harness for the rules: captured observations on a mock Rabdi chain whose creation
// timestamps line up with the fixture Sepolia timeline, plus a frozen-config evaluation context.
import personasJson from "../../../fixtures/personas.json";
import { freezeConfig } from "@/shared/config/hash";
import { eventConfig } from "@/shared/event.config";
import { canonicalBytes, canonicalHash } from "@/shared/canonical";
import type { CapturedObservation } from "@/shared/evidence/observation";
import { parsePersonas } from "@/shared/fixtures/personas";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import { createFixtureEnsReader, fixtureTimeline, fixtureVenue } from "@/shared/mocks/fixtures";
import type { Address, Hex } from "@/shared/types/primitives";
import { evaluateWith, evaluationView, prepareWith, RULES_VERSION, type Engine, ENGINE } from "@/rules";

export const timeline = fixtureTimeline();
export const frozen = freezeConfig(eventConfig);
export const CONFIG_HASH = canonicalHash(frozen);
const RABDI = frozen.chains.rabdi;

/** Timestamp of a fixture Sepolia block (12 s cadence). */
export const tsOf = (sepoliaBlock: bigint): bigint =>
  timeline.genesis.timestamp + (sepoliaBlock - timeline.genesis.block) * 12n;

const personas = parsePersonas(personasJson).personas;
export function persona(id: string): { address: Address; by: string } {
  const p = personas.find((x) => x.id === id);
  if (!p) throw new Error(`no persona ${id}`);
  return { address: p.address as Address, by: p.by };
}

const blockHash = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

/** A context with both cutoffs at the `results` time (the start of the freeze window). */
export function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  const results = timeline.times.results;
  return {
    event: frozen.edition,
    arkivChainId: RABDI.chainId,
    arkivResetId: RABDI.resetId,
    sepoliaChainId: frozen.chains.sepolia.chainId,
    arkivCutoff: { number: 1_000_000n, hash: blockHash(1_000_000n), timestamp: results.timestamp },
    sepoliaCutoff: { number: results.block, hash: blockHash(results.block), timestamp: results.timestamp },
    configHash: CONFIG_HASH,
    ...overrides,
  };
}

type Attr = [type: "str" | "u64" | "addr" | "key" | "bytes" | "bool", value: string];
let nextKey = 1n;
export const key = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

export type ObsSpec = {
  kind: string;
  creator: Address;
  byLabel?: string;
  /** Sepolia block whose timestamp (plus `offset`) is the record's creation time. */
  at: bigint;
  offset?: bigint;
  attrs?: Record<string, Attr>;
  flags?: { readonly: boolean; permissionlessExtension: boolean };
  key?: Hex;
  event?: string;
  observedAtBlock?: bigint;
  resetId?: Hex;
};

/** A captured observation. Its Arkiv creation block follows the Sepolia block so order is natural. */
export function obs(s: ObsSpec): CapturedObservation {
  const createdAtBlock = s.at - timeline.genesis.block + 1_000n;
  const attrs: Record<string, Attr> = {
    app: ["str", "lanyard"],
    event: ["str", s.event ?? frozen.edition],
    kind: ["str", s.kind],
    ...(s.byLabel !== undefined ? { by_label: ["str", s.byLabel] as Attr } : {}),
    ...s.attrs,
  };
  return {
    key: s.key ?? key(nextKey++),
    kind: s.kind,
    creator: s.creator,
    owner: s.creator,
    flags: s.flags ?? { readonly: true, permissionlessExtension: false },
    createdAtBlock,
    updatedAtBlock: createdAtBlock,
    expiresAtBlock: createdAtBlock + 5_000_000n,
    createdAtTimestamp: tsOf(s.at) + (s.offset ?? 0n),
    observedAtBlock: s.observedAtBlock ?? 999_000n,
    observedAtBlockHash: blockHash(999_000n),
    network: { chainId: RABDI.chainId, resetId: s.resetId ?? RABDI.resetId },
    attributes: Object.entries(attrs)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, [type, value]]) => ({ name, type, indexed: type !== "bytes", value })),
    payload: "0x",
  };
}

/** prepare → evaluate with one engine, returning verdicts by key. */
export async function run(
  records: CapturedObservation[],
  opts: { engine?: Engine; reader?: EnsReader; ctx?: EvaluationContext } = {},
) {
  const engine = opts.engine ?? ENGINE;
  const ctx = opts.ctx ?? context();
  const prepared = await prepareWith(engine, records, opts.reader ?? createFixtureEnsReader(), ctx, frozen);
  const output = evaluateWith(engine, records, prepared.ens, ctx, frozen, engine.version);
  const byKey = new Map(output.verdicts.map((v) => [v.key, v]));
  return { output, prepared, verdict: (r: CapturedObservation) => byKey.get(r.key)! };
}

export { RULES_VERSION };

// ── B3 helpers ──────────────────────────────────────────────────────────────────────────────

const hexOf = (bytes: Uint8Array): Hex =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** An organizer-published venue record carrying `venue` (the small fixture venue by default). */
export function venueObs(at: bigint, venue: unknown = fixtureVenue(), extra: Partial<ObsSpec> = {}) {
  return obs({
    kind: "venue",
    creator: persona("organizer").address,
    byLabel: "organizer",
    at,
    attrs: { version: ["str", "v1"], payload: ["bytes", hexOf(canonicalBytes(venue))] },
    ...extra,
  });
}

/** A present-tense context: both cutoffs at a fixture Sepolia block. */
export const contextAt = (block: bigint): EvaluationContext =>
  context({
    arkivCutoff: { number: 1_000_000n, hash: blockHash(1_000_000n), timestamp: tsOf(block) },
    sepoliaCutoff: { number: block, hash: blockHash(block), timestamp: tsOf(block) },
  });

/** prepare → evaluate → view at a present-tense moment. */
export async function viewAt(records: CapturedObservation[], block: bigint) {
  const ctx = contextAt(block);
  const r = await run(records, { ctx });
  return { ...r, view: evaluationView(records, r.prepared.ens, ctx, r.output) };
}
