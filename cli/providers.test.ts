import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { samplePublication } from "@/shared/testing";
import { CliFlagError, parseCliFlags } from "./flags";
import { createCliProviders } from "./providers";

const tempFile = async () =>
  path.join(await mkdtemp(path.join(tmpdir(), "lanyard-cli-")), "nested", "publisher.json");

describe("CLI flags", () => {
  it("default to Sepolia ENS and mock results and reject unknown values", () => {
    expect(parseCliFlags({})).toEqual({ ens: "sepolia", results: "mock" });
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
    const first = createCliProviders({ env: { LANYARD_ENS: "mock" }, publisherFile });
    const tx = await first.resultsPublisher().setEventResults(samplePublication);
    const restarted = createCliProviders({ env: { LANYARD_ENS: "mock" }, publisherFile }); // a new process, same file
    expect((await restarted.resultsPublisher().state()).eventResults).toEqual(samplePublication);
    expect(await restarted.resultsPublisher().reconcile(tx.txHash)).toEqual(tx);
    expect(await readFile(publisherFile, "utf8")).toContain('"bundleUri"');
  });

  it("serve the fixture ENS reader in mock mode", async () => {
    expect(
      await createCliProviders({ env: { LANYARD_ENS: "mock" } })
        .ensReader()
        .headBlock(),
    ).toBeGreaterThan(0n);
  });

  it("require a live ENS RPC and keep results gated until I4", () => {
    const live = createCliProviders({ env: { LANYARD_ENS: "sepolia", LANYARD_RESULTS: "sepolia" } });
    expect(() => live.ensReader()).toThrow(/SEPOLIA_RPC_URL is required/);
    expect(() => live.sepoliaBlocks()).toThrow(/SEPOLIA_RPC_URL is required/);
    expect(() => live.resultsPublisher()).toThrow(/A4\.2, switched on at I4/);
  });
});

it("memoizes live ENS and canonical block providers", () => {
  const p = createCliProviders({ env: { SEPOLIA_RPC_URL: "http://127.0.0.1:8545" } });
  expect(p.config.authorities.organizer).toBe("0x36b7c556c584d65bd44ae57656b64b68bb88e2cf");
  expect(p.ensReader()).toBe(p.ensReader());
  expect(p.sepoliaBlocks()).toBe(p.sepoliaBlocks());
});
