import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it } from "vitest";
import { normalizeSecret, parseAllowlist, redact, scanPath, scanText } from "./scan.mjs";

// Fake secrets are built at runtime so this file never contains a literal one.
const fakeKey = "0x" + "4f".repeat(31) + "a1";
const fakeHash = "0x" + "9c".repeat(32);
const fakeMnemonic = Array.from({ length: 12 }, (_, i) => wordlist[(i * 97 + 13) % 2048]).join(" ");
const repoAllow = parseAllowlist(
  readFileSync(path.join(import.meta.dirname, "../../.secretscan-allow"), "utf8"),
);
const anvilKey0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const rules = (text: string, allow = new Set<string>()) => scanText("x.ts", text, allow).map((f) => f.rule);

describe("scanText", () => {
  it("rejects a 64-hex value bound to a private-key name", () => {
    expect(rules(`const privateKey = "${fakeKey}";`)).toEqual(["keyed-hex-secret"]);
    expect(rules(`const account = privateKeyToAccount("${fakeKey}");`)).toEqual(["keyed-hex-secret"]);
    expect(rules(`{ "decryptionKey": "${fakeKey.slice(2)}" }`)).toEqual(["keyed-hex-secret"]);
  });

  it("rejects env-style _KEY / _PK / _SECRET assignments", () => {
    expect(rules(`ORGANIZER_KEY=${fakeKey}`)).toEqual(["keyed-hex-secret"]);
    expect(rules(`DEPLOYER_PK: '${fakeKey}'`)).toEqual(["keyed-hex-secret"]);
  });

  it("accepts bare hashes, registration IDs and Arkiv entity keys", () => {
    expect(
      rules(`bundleHash: "${fakeHash}",\nregistrationId: "${fakeHash}",\nresultsKey: "${fakeHash}"`),
    ).toEqual([]);
    expect(rules(`const blockHash = ${fakeHash};`)).toEqual([]);
  });

  it("accepts empty .env.example style names", () => {
    expect(rules("ORGANIZER_KEY=\nRESULTS_KEY=\n")).toEqual([]);
  });

  it("rejects PEM private keys", () => {
    expect(
      rules(["-----BEGIN EC", "PRIVATE KEY-----"].join(" ") + "\nMHcC\n-----END EC PRIVATE KEY-----"),
    ).toEqual(["pem-private-key"]);
  });

  it("rejects a BIP39 mnemonic but not ordinary prose", () => {
    expect(rules(`const words = "${fakeMnemonic}";`)).toEqual(["bip39-mnemonic"]);
    expect(
      rules("The volunteer claims the nearest open ticket and walks the drawn path to the seat."),
    ).toEqual([]);
  });

  it("allows public test material from .secretscan-allow", () => {
    expect(rules(`PRIVATE_KEY=${anvilKey0}`, repoAllow)).toEqual([]);
    expect(
      rules('mnemonic: "test test test test test test test test test test test junk"', repoAllow),
    ).toEqual([]);
    expect(rules(`PRIVATE_KEY=${fakeKey}`, repoAllow)).toEqual(["keyed-hex-secret"]);
  });

  it("honours the inline pragma", () => {
    expect(rules(`const seedFixture = "${fakeHash}"; // secret-scan: allow`)).toEqual([]);
  });

  it("skips binary content", () => {
    expect(rules(`\u0000privateKey=${fakeKey}`)).toEqual([]);
  });
});

describe("scanPath", () => {
  it("rejects secret-bearing files but not .env.example", () => {
    expect(scanPath(".env").map((f) => f.rule)).toEqual(["env-file"]);
    expect(scanPath("cli/.env.local").map((f) => f.rule)).toEqual(["env-file"]);
    expect(scanPath("deploy/organizer.pem").map((f) => f.rule)).toEqual(["key-file"]);
    expect(scanPath(".env.example")).toEqual([]);
    expect(scanPath("src/shared/env.ts")).toEqual([]);
  });
});

describe("helpers", () => {
  it("normalizes hex case and prefix, and mnemonic whitespace", () => {
    expect(normalizeSecret("0xABCD" + "0".repeat(60))).toBe("abcd" + "0".repeat(60));
    expect(normalizeSecret("  test   test\njunk ")).toBe("test test junk");
  });

  it("never prints a full secret", () => {
    expect(redact(fakeKey)).not.toContain(fakeKey.slice(6, -4));
    expect(redact(fakeMnemonic)).toBe("12 words");
  });
});

describe("cli --staged (end to end)", () => {
  const cli = path.join(import.meta.dirname, "cli.mjs");
  const repo = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lanyard-secret-scan-"));
    spawnSync("git", ["init", "-q"], { cwd: dir });
    return dir;
  };
  const run = (dir: string) => spawnSync(process.execPath, [cli, "--staged"], { cwd: dir, encoding: "utf8" });

  it("rejects a staged fake private key without printing it", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "deploy.ts"), `export const privateKey = "${fakeKey}";\n`);
    spawnSync("git", ["add", "deploy.ts"], { cwd: dir });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy.ts:1  keyed-hex-secret");
    expect(result.stderr + result.stdout).not.toContain(fakeKey.slice(2));
  });

  it("rejects a staged .env file", () => {
    const dir = repo();
    writeFileSync(path.join(dir, ".env"), "RPC_URL=https://example.invalid\n");
    spawnSync("git", ["add", "-f", ".env"], { cwd: dir });
    expect(run(dir).status).toBe(1);
  });

  it("scans the index, not the working tree", () => {
    const dir = repo();
    const file = path.join(dir, "config.ts");
    writeFileSync(file, `export const privateKey = "${fakeKey}";\n`);
    spawnSync("git", ["add", "config.ts"], { cwd: dir });
    writeFileSync(file, "export const clean = true;\n"); // unstaged fix must not hide the staged secret
    expect(run(dir).status).toBe(1);
  });

  it("passes a clean staged hash", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "hashes.ts"), `export const bundleHash = "${fakeHash}";\n`);
    spawnSync("git", ["add", "hashes.ts"], { cwd: dir });
    expect(run(dir).status).toBe(0);
  });
});
