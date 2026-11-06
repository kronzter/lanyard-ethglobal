// Separate-process verifier harness: the caller supplies an independent trusted config file.
import { readFile } from "node:fs/promises";
import { MockResultsPublisher } from "../../src/shared/mocks/mock-results-publisher";
import { validateEventConfig } from "../../src/shared/config/validate";
import { parseJsonStrict } from "../../src/shared/canonical";
import { createFixtureEnsReader, fixtureTimeline } from "../../src/shared/mocks/fixtures";
import { mockSepoliaBlocks } from "../sepolia-blocks";
import { fileStore } from "../providers";
import { verify } from "../verify";
void (async () => {
  const [trustedFile, bundleFile, publisherFile] = process.argv.slice(2);
  if (!trustedFile || !bundleFile || !publisherFile)
    throw new Error("Expected trusted config, bundle and mock publication files");
  const raw = parseJsonStrict(await readFile(trustedFile, "utf8")) as { funding?: { dripWei: string } };
  if (raw.funding) (raw.funding as unknown as { dripWei: bigint }).dripWei = BigInt(raw.funding.dripWei);
  const config = validateEventConfig(raw);
  const result = await verify(
    config.edition,
    { bundleText: await readFile(bundleFile, "utf8") },
    {
      config,
      ensReader: () => createFixtureEnsReader(),
      sepoliaBlocks: () => mockSepoliaBlocks(fixtureTimeline()),
      publisher: () => new MockResultsPublisher({ store: fileStore(publisherFile) }),
    },
  );
  console.log(result.verdict);
  if (result.verdict !== "MATCH") {
    console.error(result);
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
