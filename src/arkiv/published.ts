// App-safe bundle retrieval: independently configured signer/config plus edition commitments.
import { canonicalJson, parseJsonStrict } from "@/shared/canonical";
import { configHash } from "@/shared/config/hash";
import type { EventConfig } from "@/shared/config/schema";
import {
  verifyEnvelope,
  resultsBodyOf,
  resultsHashOf,
  type EvidenceEnvelope,
} from "@/shared/evidence/bundle";
import type { EnsReader } from "@/shared/interfaces/ens-reader";
import { ENGINE, prepare, reproduce, rankingsOf } from "@/rules";

export async function publishedBundle(
  config: EventConfig,
  ens: EnsReader,
  fetchText: (uri: string) => Promise<string>,
) {
  const at = { sepoliaBlock: await ens.headBlock() };
  const hash = await ens.text("", "lanyard.bundle-hash", at);
  if (!hash) return null;
  const uri = await ens.text("", "lanyard.bundle-uri", at);
  const resultsHash = await ens.text("", "lanyard.results-hash", at);
  if (!uri || !resultsHash || !uri.startsWith("https://"))
    throw new Error("Publication commitment is incomplete");
  const raw = parseJsonStrict(await fetchText(uri)) as EvidenceEnvelope;
  const body = await verifyEnvelope(raw, config.authorities.results);
  if (
    raw.bundleHash !== hash ||
    body.bundleUri !== uri ||
    body.event !== config.edition ||
    body.context.configHash !== configHash(config)
  )
    throw new Error("Published bundle does not match edition commitment/config");
  const reproduced = reproduce(ENGINE, body);
  if (!reproduced.match) throw new Error(`Published computation differs: ${reproduced.difference}`);
  const independent = await prepare(body.records, ens, body.context, body.config);
  if (canonicalJson(independent.ens) !== canonicalJson(body.ens))
    throw new Error("Published historical ENS observations differ");
  const envelope = { ...raw, body };
  if (resultsHashOf(resultsBodyOf(envelope, rankingsOf(reproduced.output))) !== resultsHash)
    throw new Error("Published results hash differs");
  return { envelope, output: reproduced.output };
}
