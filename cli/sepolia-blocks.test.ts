import { describe, expect, it } from "vitest";
import { fixtureTimeline } from "../src/shared/mocks/fixtures";
import { createCliProviders } from "./providers";
import { mockBlockHash, mockSepoliaBlocks } from "./sepolia-blocks";

const timeline = fixtureTimeline();

describe("mock Sepolia block identity", () => {
  it("gives each fixture block a stable hash and its timeline timestamp", async () => {
    const blocks = mockSepoliaBlocks(timeline);
    const ref = await blocks.blockRef(timeline.times.results.block);
    expect(ref).toEqual({
      number: timeline.times.results.block,
      hash: mockBlockHash(timeline.chainId, timeline.times.results.block),
      timestamp: timeline.times.results.timestamp,
    });
    expect((await blocks.blockRef(ref.number + 1n)).hash).not.toBe(ref.hash);
  });

  it("can simulate a reorg and refuses blocks outside the mock chain", async () => {
    const reorged = mockSepoliaBlocks(timeline, { override: () => `0x${"bb".repeat(32)}` });
    expect((await reorged.blockRef(timeline.head)).hash).toBe(`0x${"bb".repeat(32)}`);
    await expect(mockSepoliaBlocks(timeline).blockRef(timeline.head + 1n)).rejects.toThrow(/outside/);
  });

  it("follows the ENS flag in the CLI composition root", () => {
    expect(createCliProviders({ env: {} }).sepoliaBlocks()).toBeTruthy();
    expect(() => createCliProviders({ env: { LANYARD_ENS: "sepolia" } }).sepoliaBlocks()).toThrow(/I2/);
  });
});
