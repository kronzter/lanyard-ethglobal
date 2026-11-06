import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  custom,
  encodeFunctionResult,
  HttpRequestError,
  RpcRequestError,
  parseAbi,
  type Address,
} from "viem";
import { assertRegistrarVersion, EXPECTED_REGISTRAR_VERSION } from "./registrar-version";

const address = "0x0000000000000000000000000000000000000001" as Address;
const abi = parseAbi(["function version() view returns (string)"]);

function clientFor(result: `0x${string}` | Error) {
  return createPublicClient({
    transport: custom({
      async request() {
        if (result instanceof Error) throw result;
        return result;
      },
    }),
  });
}

describe("assertRegistrarVersion", () => {
  it("accepts the exact current registrar version", async () => {
    await expect(
      assertRegistrarVersion(
        clientFor(encodeFunctionResult({ abi, functionName: "version", result: EXPECTED_REGISTRAR_VERSION })),
        address,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["older version", encodeFunctionResult({ abi, functionName: "version", result: "lanyard.registrar/1" })],
    ["wrong version", encodeFunctionResult({ abi, functionName: "version", result: "other" })],
    ["missing getter", "0x"],
    ["reverting getter", new Error("execution reverted")],
  ] as const)("rejects %s with an explicit obsolete registrar error", async (_label, result) => {
    await expect(assertRegistrarVersion(clientFor(result), address)).rejects.toThrow(
      /recorded registrar .* obsolete or incompatible/,
    );
  });

  it("preserves RPC transport failures instead of mislabeling them as obsolete deployments", async () => {
    const error = new HttpRequestError({ url: "https://rpc.invalid", status: 503, details: "unavailable" });
    await expect(assertRegistrarVersion(clientFor(error), address)).rejects.toThrow(/HTTP request failed/);
  });

  it.each([3, -32603])(
    "rejects an execution revert returned as JSON-RPC error %i as an incompatible getter",
    async (code) => {
      const error = new RpcRequestError({
        body: { method: "eth_call" },
        error: { code, message: "execution reverted", data: "0x" },
        url: "http://127.0.0.1:8545",
      });
      await expect(assertRegistrarVersion(clientFor(error), address)).rejects.toThrow(
        /obsolete or incompatible/,
      );
    },
  );
});
