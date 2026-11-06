// Pure secret scanner used by the pre-commit hook and CI (plans/P0-foundation.md › P0.1-R2).
//
// Lanyard is full of legitimate 32-byte hex values (keccak hashes, registration IDs,
// block hashes, Arkiv entity keys), so a bare 64-hex value is NOT a finding. The scanner
// rejects key material by context instead:
//   - secret-bearing files: .env* (except .env.example), *.pem, *.key, keystores
//   - PEM private-key blocks
//   - a 64-hex value bound to a key-like name (privateKey = 0x…, ORGANIZER_KEY=…)
//   - 12+ consecutive BIP39 words (a mnemonic)
// Public test material (Anvil's keys, the `test … junk` mnemonic) lives in .secretscan-allow.
// A line containing `secret-scan: allow` is skipped.
import { wordlist } from "@scure/bip39/wordlists/english.js";

const BIP39 = new Set(wordlist);
const MNEMONIC_MIN_WORDS = 12;
const PRAGMA = "secret-scan: allow";

const SECRET_FILE_RULES = [
  { re: /(^|\/)\.env(\.[^/]+)?$/, except: /(^|\/)\.env\.example$/, rule: "env-file" },
  { re: /\.(pem|key|p12|pfx|keystore)$/i, rule: "key-file" },
  { re: /(^|\/)(id_rsa|id_ecdsa|id_ed25519)$/, rule: "ssh-key-file" },
  { re: /(^|\/)UTC--[^/]*--[0-9a-fA-F]{40}(\.json)?$/, rule: "keystore-file" },
];

const PEM = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const HEX64 = "(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])";
const SEP = "[\\s\"'`:=(,\\[{]*";
const KEYED_HEX = [
  // privateKey, secret_key, mnemonicSeed, signingKey, decryptionKey, privateKeyToAccount(…
  new RegExp(`(?:private|secret|mnemonic|seed|passphrase|signing|decrypt)[\\w-]*${SEP}${HEX64}`, "gi"),
  // ORGANIZER_KEY=…, DEPLOYER_PK: …, API_SECRET="…"
  new RegExp(`\\b[A-Z][A-Z0-9_]*_(?:KEY|PK|SECRET)\\b${SEP}${HEX64}`, "g"),
];

/** Normalize a candidate secret so allowlist comparison is format-independent. */
export function normalizeSecret(value) {
  const v = value.trim().toLowerCase();
  if (/^(0x)?[0-9a-f]{64}$/.test(v)) return v.replace(/^0x/, "");
  return v.split(/\s+/).join(" ");
}

/** Parse .secretscan-allow: one value per line, `#` comments. */
export function parseAllowlist(text) {
  const allow = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line) allow.add(normalizeSecret(line));
  }
  return allow;
}

/** Findings for the path alone (secret-bearing file types). */
export function scanPath(path) {
  return SECRET_FILE_RULES.filter(({ re, except }) => re.test(path) && !(except && except.test(path))).map(
    ({ rule }) => ({ path, line: 0, rule, value: null }),
  );
}

function mnemonicRuns(text) {
  // Walk word/separator tokens; whitespace keeps a run going, anything else breaks it.
  const runs = [];
  let words = [];
  let start = 0;
  const flush = () => {
    if (words.length >= MNEMONIC_MIN_WORDS) runs.push({ index: start, phrase: words.join(" ") });
    words = [];
  };
  for (const m of text.matchAll(/[a-z]+|[^a-z]+/g)) {
    const tok = m[0];
    if (/^[a-z]+$/.test(tok)) {
      if (BIP39.has(tok)) {
        if (words.length === 0) start = m.index;
        words.push(tok);
      } else flush();
    } else if (!/^[ \t\r\n]+$/.test(tok)) flush();
  }
  flush();
  return runs;
}

/** Scan text content. Returns findings with the secret value (callers must redact before printing). */
export function scanText(path, text, allow = new Set()) {
  if (text.includes("\u0000")) return []; // binary
  const findings = [];
  const seen = new Set();
  const lines = text.split("\n");
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const allowedLine = (n) => lines[n - 1]?.includes(PRAGMA) ?? false;
  const push = (index, rule, value) => {
    const line = lineOf(index);
    if (allowedLine(line)) return;
    if (value !== null && allow.has(normalizeSecret(value))) return;
    const id = `${line}:${rule}:${value}`;
    if (seen.has(id)) return; // several patterns can match the same secret
    seen.add(id);
    findings.push({ path, line, rule, value });
  };

  const pem = PEM.exec(text);
  if (pem) push(pem.index, "pem-private-key", null);
  for (const re of KEYED_HEX) {
    for (const m of text.matchAll(re)) push(m.index, "keyed-hex-secret", m[1]);
  }
  for (const run of mnemonicRuns(text)) push(run.index, "bip39-mnemonic", run.phrase);
  return findings;
}

/** Redact a finding's value for display: never print a secret. */
export function redact(value) {
  if (value === null) return "";
  if (value.includes(" ")) return `${value.split(" ").length} words`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
