// Runtime-independent URL checks. React Native's URL polyfill is incomplete on Hermes, so
// Lanyard parses the few URL shapes it accepts by hand instead of relying on `new URL()`.

export type WebUrl = { scheme: "https" | "http"; host: string; port: number | null; rest: string };

/** Whitespace, control characters (C0, DEL) and backslashes are never valid in a stored URL. */
function hasUnsafeChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x5c || c === 0xa0 || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Parse an absolute http(s) URL; null if malformed, if it embeds credentials or has odd characters. */
export function parseWebUrl(input: string): WebUrl | null {
  if (hasUnsafeChar(input)) return null;
  const m = /^(https?):\/\/([^/?#]*)([/?#].*)?$/i.exec(input);
  if (!m) return null;
  const [, scheme, authority = "", rest = ""] = m;
  if (authority.includes("@")) return null; // embedded credentials
  const hp = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(authority.toLowerCase());
  if (!hp || !HOST.test(hp[1]!)) return null;
  const port = hp[2] === undefined ? null : Number(hp[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { scheme: scheme!.toLowerCase() as "https" | "http", host: hp[1]!, port, rest };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * An app origin: `https://host[:port]` with no path, query or fragment. With `allowLocalhost`
 * (mock deployments only), `http://localhost[:port]` and `http://127.0.0.1[:port]` are accepted.
 */
export function isAppOrigin(input: string, opts: { allowLocalhost: boolean }): boolean {
  const u = parseWebUrl(input);
  if (!u || u.rest !== "") return false;
  if (u.scheme === "https") return true;
  return opts.allowLocalhost && LOCAL_HOSTS.has(u.host);
}

/** UTF-8 byte length without TextEncoder (strings must be well-formed). */
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}
