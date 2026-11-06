// Pure guards for the ENS operator scripts, kept apart from connect.ts so they test without a network.

/** Hosts a fork endpoint may use: the key in a fork run is a throwaway, so never send it anywhere else. */
export function assertLoopbackUrl(url: string, what = "FORK_RPC_URL"): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`${what} is not a valid URL`);
  }
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!loopback) throw new Error(`${what} must point at localhost, 127.0.0.1 or ::1 (got host ${host})`);
}

/** Removes every known RPC URL and anything that looks like an http(s)/ws(s) URL from an error message. */
export function redactUrls(text: string, known: readonly string[] = []): string {
  let out = text;
  for (const url of known) if (url) out = out.split(url).join("<rpc-url>");
  return out.replace(/(?:https?|wss?):\/\/\S+/gi, "<rpc-url>");
}
