import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { samplePublication } from "@/shared/testing";
import { CliFlagError, parseCliFlags } from "./flags";
import { CliProviderNotWiredError, createCliProviders } from "./providers";

const tempFile = async () =>
  path.join(await mkdtemp(path.join(tmpdir(), "lanyard-cli-")), "nested", "publisher.json");

describe("CLI flags", () => {
  it("default to mock and reject unknown values", () => {
    expect(parseCliFlags({})).toEqual({ ens: "mock", results: "mock" });
    expect(parseCliFlags({ LANYARD_ENS: "sepolia", LANYARD_RESULTS: "sepolia" })).toEqual({
      ens: "sepolia",
      results: "sepolia",
    });
    expect(() => parseCliFlags({ LANYARD_RESULTS: "live" })).toThrow(CliFlagError);
  });
});

describe("CLI providers", () => {
  it("keep mock publication state in a file across CLI restarts", async () => {
    const publisherFile = await tempFile();
    const first = createCliProviders({ env: {}, publisherFile });
    const tx = await first.resultsPublisher().setEventResults(samplePublication);
    const restarted = createCliProviders({ env: {}, publisherFile }); // a new process, same file
    expect((await restarted.resultsPublisher().state()).eventResults).toEqual(samplePublication);
    expect(await restarted.resultsPublisher().reconcile(tx.txHash)).toEqual(tx);
    expect(await readFile(publisherFile, "utf8")).toContain('"bundleUri"');
  });

  it("serve the fixture ENS reader in mock mode", async () => {
    expect(await createCliProviders({ env: {} }).ensReader().headBlock()).toBeGreaterThan(0n);
  });

  it("fail loudly for the real implementations until their integration", () => {
    const live = createCliProviders({ env: { LANYARD_ENS: "sepolia", LANYARD_RESULTS: "sepolia" } });
    expect(() => live.ensReader()).toThrow(CliProviderNotWiredError);
    expect(() => live.resultsPublisher()).toThrow(/A4\.2, switched on at I4/);
  });
});
