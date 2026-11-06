// `lanyard verify <event> [--bundle <path>] [--offline]` and `lanyard hash <event> --bundle <path>`
// (B2.3-R3, R4, R6, R8).
//
// verify, online:
//   1. the envelope's hash and EIP-191 signature against the locally configured results wallet
//      (never the bundle's own config), with both cutoffs inside the saved [results, freezeDeadline)
//   2. the bundle's config hash equals the locally frozen edition config; the rules version is this build's
//   3. the Sepolia cutoff block still has the saved hash and timestamp
//   4. the locked publication commits to this bundle hash and URI, and to the reconstructed resultsHash
//   5. historical ENS is re-read independently and must byte-match the bundle's prepared entries
//   6. the rules re-run on the retained inputs and must byte-match the claimed output
// It prints `MATCH — operator-attested captured inputs; completeness not proven`, or the first
// difference. Any failed read exits non-zero and names the read; nothing prints MATCH by default.
// `--offline` skips 3–5 and prints LOCAL_REPRODUCTION, never MATCH.
//
// hash prints the canonical output hash of a bundle's own inputs. It may evaluate an explicit
// development context outside the freeze window, and never claims a published-result verdict.
import { readFile } from "node:fs/promises";
import { canonicalJson, parseJsonStrict } from "../src/shared/canonical";
import { configHash, freezeConfig } from "../src/shared/config/hash";
import { isCutoffInWindow } from "../src/shared/config/validate";
import { EventTimesSchema, type EventConfig } from "../src/shared/config/schema";
import {
  compareEnsEntries,
  resultsBodyOf,
  resultsHashOf,
  verifyEnvelope,
  type EvidenceBody,
  type EvidenceEnvelope,
  type PreparedEnsEntry,
} from "../src/shared/evidence/bundle";
import type { EnsReader } from "../src/shared/interfaces/ens-reader";
import type { ResultsPublisher } from "../src/shared/interfaces/results-publisher";
import type { Hex } from "../src/shared/types/primitives";
import { ENGINE, parseBundleText, prepareWith, rankingsOf, reproduce, type Engine } from "../src/rules";
import type { SepoliaBlocks } from "./sepolia-blocks";

export const MATCH_LINE = "MATCH — operator-attested captured inputs; completeness not proven";
export const LOCAL_LINE =
  "LOCAL_REPRODUCTION — the bundle's own inputs reproduce its output; publication and ENS history were not independently checked";

export type VerifyDeps = {
  config: EventConfig;
  ensReader: () => EnsReader;
  publisher: () => ResultsPublisher;
  sepoliaBlocks: () => SepoliaBlocks;
  /** Fetch a bundle by URI when no --bundle path is given. */
  fetchText?: (uri: string) => Promise<string>;
  engine?: Engine;
};

export type VerifyOutcome =
  | { verdict: "MATCH" | "LOCAL_REPRODUCTION"; outputHash: Hex; bundleHash: Hex; lines: string[] }
  | { verdict: "MISMATCH" | "ERROR"; reason: string; lines: string[] };

class Stop extends Error {
  constructor(
    readonly verdict: "MISMATCH" | "ERROR",
    message: string,
  ) {
    super(message);
  }
}
const mismatch = (m: string) => new Stop("MISMATCH", m);

/** Run one named step; any throw becomes an ERROR naming that step. */
async function step<T>(name: string, f: () => T | Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof Stop) throw e;
    throw new Stop("ERROR", `${name} failed: ${(e as Error).message}`);
  }
}

function parseEnvelope(text: string): { body: unknown; bundleHash: string; signature: string } {
  const v = parseJsonStrict(text) as Record<string, unknown>;
  if (
    typeof v !== "object" ||
    v === null ||
    typeof v.bundleHash !== "string" ||
    typeof v.signature !== "string"
  )
    throw new Error("not a signed evidence envelope { body, bundleHash, signature }");
  return { body: v.body, bundleHash: v.bundleHash, signature: v.signature };
}

const firstEnsDifference = (claimed: PreparedEnsEntry[], actual: PreparedEnsEntry[]): string | undefined => {
  const n = Math.max(claimed.length, actual.length);
  for (let i = 0; i < n; i++) {
    const a = claimed[i];
    const b = actual[i];
    if (canonicalJson(a ?? null) !== canonicalJson(b ?? null))
      return `ENS entry ${i}: bundle has ${canonicalJson(a ?? null)}, independent read gives ${canonicalJson(b ?? null)}`;
  }
  return undefined;
};

export async function verify(
  event: string,
  opts: { bundleText?: string; offline?: boolean },
  deps: VerifyDeps,
): Promise<VerifyOutcome> {
  const engine = deps.engine ?? ENGINE;
  const lines: string[] = [];
  try {
    // A bundle from a URI (no --bundle) needs the publication first, to know where and what to fetch.
    let published: Awaited<ReturnType<ResultsPublisher["state"]>> | undefined;
    let text = opts.bundleText;
    if (text === undefined) {
      if (opts.offline) throw new Stop("ERROR", "--offline needs --bundle <path>");
      published = await step("reading the publication state", () => deps.publisher().state());
      const uri = published.eventResults?.bundleUri;
      if (!uri) throw mismatch(`no results are published for ${event}`);
      if (!deps.fetchText) throw new Stop("ERROR", "fetching a bundle URI is not available here");
      text = await step(`fetching ${uri}`, () => deps.fetchText!(uri));
    }

    const raw = await step("parsing the bundle", () => parseEnvelope(text!));
    const body: EvidenceBody = await step("checking the bundle signature and freeze window", () =>
      verifyEnvelope(raw, deps.config.authorities.results),
    );
    const envelope: EvidenceEnvelope = {
      body,
      bundleHash: raw.bundleHash.toLowerCase() as Hex,
      signature: raw.signature as Hex,
    };
    lines.push(`bundle ${envelope.bundleHash} signed by the configured results wallet`);

    if (body.event !== event) throw mismatch(`the bundle is for ${body.event}, not ${event}`);
    const localHash = await step("freezing the local edition config", () => configHash(deps.config));
    if (body.context.configHash !== localHash)
      throw mismatch(
        `bundle config ${body.context.configHash} differs from the local edition config ${localHash}`,
      );
    if (body.ruleVersion !== engine.version)
      throw mismatch(
        `rules version ${body.ruleVersion} is unavailable; this build implements ${engine.version}`,
      );
    for (const cutoff of ["arkivCutoff", "sepoliaCutoff"] as const) {
      if (!isCutoffInWindow(body.context[cutoff].timestamp, freezeConfig(deps.config).times))
        throw mismatch(`${cutoff} is outside the saved freeze window [results, freezeDeadline)`);
    }

    if (!opts.offline) {
      const cutoff = body.context.sepoliaCutoff;
      const block = await step(`reading Sepolia block ${cutoff.number}`, () =>
        deps.sepoliaBlocks().blockRef(cutoff.number),
      );
      if (block.hash !== cutoff.hash || block.timestamp !== cutoff.timestamp)
        throw mismatch(
          `Sepolia cutoff block ${cutoff.number} is now ${block.hash}, not the saved ${cutoff.hash}`,
        );
      lines.push(`Sepolia cutoff block ${cutoff.number} ${cutoff.hash} is canonical`);

      published ??= await step("reading the publication state", () => deps.publisher().state());
      const results = published.eventResults;
      if (!results || results.event !== event) throw mismatch(`no results are published for ${event}`);
      if (!published.locked) throw mismatch("the publication is not locked yet");
      if (results.bundleHash !== envelope.bundleHash)
        throw mismatch(
          `the locked publication commits to bundle ${results.bundleHash}, not ${envelope.bundleHash}`,
        );
      if (results.bundleUri !== body.bundleUri)
        throw mismatch(`the locked publication names bundle URI ${results.bundleUri}, not ${body.bundleUri}`);
      lines.push(`locked publication commits to this bundle`);
    }

    const reproduced = await step("re-running the rules", () => reproduce(engine, body));
    if (!reproduced.match) throw mismatch(`the rules output differs: ${reproduced.difference}`);

    if (!opts.offline) {
      const expected = resultsHashOf(resultsBodyOf(envelope, rankingsOf(reproduced.output)));
      if (published!.eventResults!.resultsHash !== expected)
        throw mismatch(
          `published resultsHash ${published!.eventResults!.resultsHash} differs from the reconstructed ${expected}`,
        );

      const independent = await step("reading historical ENS", () =>
        prepareWith(engine, body.records, deps.ensReader(), body.context, body.config),
      );
      const diff = firstEnsDifference(body.ens, [...independent.ens].sort(compareEnsEntries));
      if (diff) throw mismatch(diff);
      lines.push(`${independent.ens.length} historical ENS entries re-read independently and match`);
    }

    lines.push(`output ${reproduced.outputHash} reproduces from ${body.records.length} captured records`);
    return {
      verdict: opts.offline ? "LOCAL_REPRODUCTION" : "MATCH",
      outputHash: reproduced.outputHash,
      bundleHash: envelope.bundleHash,
      lines,
    };
  } catch (e) {
    if (e instanceof Stop) return { verdict: e.verdict, reason: e.message, lines };
    return { verdict: "ERROR", reason: (e as Error).message, lines };
  }
}

/** `lanyard hash`: the output hash of a bundle's own inputs (envelope or bare body). */
export function hashBundle(
  event: string,
  text: string,
  engine: Engine = ENGINE,
): { outputHash: Hex; bundleHash: Hex; inWindow: boolean; claimedMatches: boolean; difference?: string } {
  const { body, bundleHash } = parseBundleText(text, { allowOutOfWindow: true });
  if (body.event !== event) throw new Error(`the bundle is for ${body.event}, not ${event}`);
  if (body.ruleVersion !== engine.version)
    throw new Error(
      `rules version ${body.ruleVersion} is unavailable; this build implements ${engine.version}`,
    );
  const times = EventTimesSchema.parse(body.config.times);
  const r = reproduce(engine, body);
  return {
    outputHash: r.outputHash,
    bundleHash,
    inWindow:
      isCutoffInWindow(body.context.arkivCutoff.timestamp, times) &&
      isCutoffInWindow(body.context.sepoliaCutoff.timestamp, times),
    claimedMatches: r.match,
    difference: r.match ? undefined : r.difference,
  };
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export async function runVerify(args: string[], deps: VerifyDeps): Promise<number> {
  const event = args[0];
  if (!event || event.startsWith("--")) {
    console.error("usage: lanyard verify <event> [--bundle <path>] [--offline]");
    return 1;
  }
  const path = flag(args, "--bundle");
  const bundleText = path ? await readFile(path, "utf8") : undefined;
  const outcome = await verify(event, { bundleText, offline: args.includes("--offline") }, deps);
  for (const l of outcome.lines) console.log(`  ${l}`);
  if (outcome.verdict === "MISMATCH" || outcome.verdict === "ERROR") {
    console.error(`${outcome.verdict}: ${outcome.reason}`);
    return 1;
  }
  console.log(outcome.verdict === "MATCH" ? MATCH_LINE : LOCAL_LINE);
  return 0;
}

export async function runHash(args: string[]): Promise<number> {
  const event = args[0];
  const path = flag(args, "--bundle");
  if (!event || event.startsWith("--") || !path) {
    console.error("usage: lanyard hash <event> --bundle <path>");
    return 1;
  }
  const r = hashBundle(event, await readFile(path, "utf8"));
  console.log(r.outputHash);
  if (!r.inWindow)
    console.error("note: development context outside the freeze window; not a published-result verdict");
  if (!r.claimedMatches) {
    console.error(`the bundle's claimed output differs: ${r.difference}`);
    return 1;
  }
  return 0;
}
