// Evidence bundles from the rules' side (B2.2 bundle schema, B2.3 reproduction).
//
// `assembleBody` builds a canonical bundle body from captured records, prepared ENS entries,
// frozen config, explicit context and the computed output; `reproduce` re-runs `evaluate` on a
// body's own retained inputs and compares canonical output bytes. Signing (the operator's
// attestation) takes an injected EIP-191 signer, so no key ever passes through this module.
import { canonicalHash, canonicalJson, parseJsonStrict } from "@/shared/canonical";
import {
  bundleHashOf,
  compareEnsEntries,
  evidenceSigningMessage,
  parseEvidenceBody,
  type EvidenceBody,
  type EvidenceEnvelope,
  type PreparedEnsEntry,
} from "@/shared/evidence/bundle";
import { dedupeObservations, type CapturedObservation } from "@/shared/evidence/observation";
import type { EvaluationContext } from "@/shared/interfaces/evaluation-context";
import type { Hex } from "@/shared/types/primitives";
import { evaluateWith, type Engine } from "./engine";
import type { RulesOutput, Verdict } from "./types";

export type BodyInput = {
  context: EvaluationContext;
  /** The frozen config whose canonical hash is `context.configHash`. */
  config: Record<string, unknown>;
  ruleVersion: Hex;
  records: readonly CapturedObservation[];
  ens: readonly PreparedEnsEntry[];
  diagnostics: EvidenceBody["diagnostics"];
  decryption: EvidenceBody["decryption"];
  prizes: EvidenceBody["prizes"];
  output: RulesOutput;
  bundleUri: string;
};

/** A checked, canonical body. Pass `allowOutOfWindow` only for an explicit development context. */
export function assembleBody(i: BodyInput, opts: { allowOutOfWindow?: boolean } = {}): EvidenceBody {
  const raw = {
    schemaVersion: 1,
    event: i.context.event,
    context: i.context,
    config: i.config,
    ruleVersion: i.ruleVersion,
    records: dedupeObservations([...i.records]),
    ens: [...i.ens].sort(compareEnsEntries),
    diagnostics: i.diagnostics,
    decryption: i.decryption,
    prizes: i.prizes,
    output: i.output,
    bundleUri: i.bundleUri,
  };
  // Round-trip through canonical JSON so the body holds exactly what a reader of the file sees.
  return parseEvidenceBody(parseJsonStrict(canonicalJson(raw)), opts);
}

/**
 * Read a bundle file's text: a signed envelope `{ body, bundleHash, signature }` or a bare body.
 * Checks structure, ordering and config hash, and that an envelope's hash matches its body; it does
 * not check the signature (that needs the configured results wallet: `verifyEnvelope`).
 */
export function parseBundleText(
  text: string,
  opts: { allowOutOfWindow?: boolean } = {},
): { body: EvidenceBody; bundleHash: Hex; signature?: Hex } {
  const v = parseJsonStrict(text);
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new Error("a bundle must be a JSON object");
  const signed = "body" in v && "bundleHash" in v;
  const body = parseEvidenceBody(signed ? (v as { body: unknown }).body : v, opts);
  const bundleHash = bundleHashOf(body);
  if (signed) {
    const e = v as { bundleHash: unknown; signature?: unknown };
    if (typeof e.bundleHash !== "string" || e.bundleHash.toLowerCase() !== bundleHash)
      throw new Error("bundleHash does not match the body");
    return {
      body,
      bundleHash,
      signature: typeof e.signature === "string" ? (e.signature as Hex) : undefined,
    };
  }
  return { body, bundleHash };
}

/** Sign a body as the results operator: EIP-191 over `Lanyard evidence v1\n<bundleHash>`. */
export async function signBody(
  body: EvidenceBody,
  signMessage: (message: string) => Promise<Hex>,
): Promise<EvidenceEnvelope> {
  const bundleHash = bundleHashOf(body);
  return { body, bundleHash, signature: await signMessage(evidenceSigningMessage(bundleHash)) };
}

export const outputHashOf = (output: unknown): Hex => canonicalHash(output);

export type Reproduction =
  | { match: true; output: RulesOutput; outputHash: Hex }
  | { match: false; output: RulesOutput; outputHash: Hex; claimedHash: Hex; difference: string };

/** Describe the first place two outputs differ, verdict by verdict. */
export function firstDifference(claimed: unknown, actual: RulesOutput): string | undefined {
  if (canonicalJson(claimed) === canonicalJson(actual)) return undefined;
  const c = (claimed ?? {}) as Partial<RulesOutput>;
  for (const field of ["schemaVersion", "event", "ruleVersion", "configHash"] as const) {
    if (canonicalJson(c[field] ?? null) !== canonicalJson(actual[field]))
      return `output.${field}: claimed ${canonicalJson(c[field] ?? null)}, recomputed ${canonicalJson(actual[field])}`;
  }
  const claimedVerdicts: Partial<Verdict>[] = Array.isArray(c.verdicts) ? c.verdicts : [];
  const n = Math.max(claimedVerdicts.length, actual.verdicts.length);
  for (let i = 0; i < n; i++) {
    const a = claimedVerdicts[i];
    const b = actual.verdicts[i];
    if (canonicalJson(a ?? null) !== canonicalJson(b ?? null))
      return `verdict ${i} (${b?.key ?? a?.key ?? "?"}): claimed ${canonicalJson(a ?? null)}, recomputed ${canonicalJson(b ?? null)}`;
  }
  return "output differs outside the verdict list";
}

/** Re-run the rules on a body's retained inputs and compare canonical output bytes. Pure. */
export function reproduce(engine: Engine, body: EvidenceBody): Reproduction {
  const output = evaluateWith(engine, body.records, body.ens, body.context, body.config, body.ruleVersion);
  const outputHash = outputHashOf(output);
  const difference = firstDifference(body.output, output);
  return difference === undefined
    ? { match: true, output, outputHash }
    : { match: false, output, outputHash, claimedHash: outputHashOf(body.output), difference };
}
