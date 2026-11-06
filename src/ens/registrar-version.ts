import {
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  parseAbi,
  RpcRequestError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
  type Address,
  type PublicClient,
} from "viem";

const versionAbi = parseAbi(["function version() view returns (string)"]);
export const EXPECTED_REGISTRAR_VERSION = "lanyard.registrar/2";

function isRpcTransportFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    // Reverts are returned through JSON-RPC too; viem's decoded contract cause takes precedence.
    if (current instanceof ContractFunctionRevertedError || current instanceof ContractFunctionZeroDataError)
      return false;
    if (
      current instanceof HttpRequestError ||
      current instanceof RpcRequestError ||
      current instanceof SocketClosedError ||
      current instanceof TimeoutError ||
      current instanceof WebSocketRequestError
    )
      return true;
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return false;
}

/** Reject stale or incompatible deployments before their state can be resumed. */
export async function assertRegistrarVersion(
  client: Pick<PublicClient, "readContract">,
  address: Address,
): Promise<void> {
  let version: string;
  try {
    version = await client.readContract({ address, abi: versionAbi, functionName: "version" });
  } catch (error) {
    // Preserve infrastructure failures so an RPC outage never gets mistaken for an obsolete deployment.
    if (isRpcTransportFailure(error)) throw error;
    throw new Error(`recorded registrar ${address} is obsolete or incompatible: version() is unavailable`, {
      cause: error,
    });
  }
  if (version !== EXPECTED_REGISTRAR_VERSION) {
    throw new Error(
      `recorded registrar ${address} is obsolete or incompatible: version ${JSON.stringify(version)}, expected ${EXPECTED_REGISTRAR_VERSION}`,
    );
  }
}
