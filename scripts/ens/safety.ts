// Pure guards for the ENS operator scripts, kept apart from connect.ts so they test without a network.
import { getAddress, isAddress, type Address } from "viem";

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

const lower = (a: string): string => a.toLowerCase();

/**
 * Which wallet a run acts as. A fork run accepts any key. A live run must use the organizer named in
 * src/shared/event.config.ts, unless LANYARD_LIVE_ORGANIZER names the live organizer explicitly: the
 * shared config still holds the mock organizer until it is updated together with Track B (its rules
 * vectors and fixtures commit to it). The override never widens who may sign: the key must match it.
 */
export function chooseOrganizer(opts: {
  fork: boolean;
  /** Address of ORGANIZER_PRIVATE_KEY, or null for a read-only run. */
  key: string | null;
  /** `authorities.organizer` from the event config. */
  config: string;
  /** LANYARD_LIVE_ORGANIZER, if set. */
  override?: string;
}): { organizer: Address; warning?: string } {
  if (opts.fork) return { organizer: getAddress(opts.key ?? opts.config) };
  if (opts.override === undefined || opts.override === "") {
    if (opts.key && lower(opts.key) !== lower(opts.config))
      throw new Error(
        "ORGANIZER_PRIVATE_KEY does not match authorities.organizer in src/shared/event.config.ts " +
          "(set LANYARD_LIVE_ORGANIZER to the key's address to deploy as the live organizer)",
      );
    return { organizer: getAddress(opts.key ?? opts.config) };
  }
  if (!isAddress(opts.override, { strict: false }))
    throw new Error("LANYARD_LIVE_ORGANIZER is not an address");
  const organizer = getAddress(opts.override);
  if (opts.key && lower(opts.key) !== lower(organizer))
    throw new Error("ORGANIZER_PRIVATE_KEY does not match LANYARD_LIVE_ORGANIZER");
  if (lower(organizer) === lower(opts.config)) return { organizer };
  return {
    organizer,
    warning:
      `live organizer ${organizer} (LANYARD_LIVE_ORGANIZER) differs from authorities.organizer ` +
      `${getAddress(opts.config)} in src/shared/event.config.ts; update the shared config with Track B before I1`,
  };
}

/**
 * The registrar a script acts on: the local `.lanyard/edition-*.json` deploy state when this machine
 * deployed, otherwise (live runs only) the committed live `deployments/sepolia.json`. Operators other
 * than the deployer, such as the I1 seeding on Track B's machine, never need the deployer's state file.
 */
export function registrarFrom(opts: {
  stateText: string | null;
  fork: boolean;
  deployment: { mode: string; contracts?: Record<string, string | undefined> };
}): Address {
  let candidate: unknown;
  if (opts.stateText !== null) {
    try {
      candidate = (JSON.parse(opts.stateText) as { registrar?: unknown }).registrar;
    } catch {
      candidate = undefined;
    }
  } else if (!opts.fork && opts.deployment.mode === "live") {
    candidate = opts.deployment.contracts?.lanyardRegistrar;
  } else {
    throw new Error("no registrar recorded; run deploy-edition.ts first");
  }
  if (
    typeof candidate !== "string" ||
    !isAddress(candidate, { strict: false }) ||
    /^0x0{40}$/i.test(candidate)
  )
    throw new Error("invalid registrar in the deploy state or deployment");
  return getAddress(candidate);
}
