import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { operatorKeyMatches, scoreKeyId } from "../src/shared/crypto/score-cipher";
import type { Hex } from "../src/shared/types/primitives";
import { deskKeygen } from "./desk-keygen";
import { KeyExistsError } from "./keygen";
import { scoreKeygen } from "./score-keygen";

const roots: string[] = [];
const freshRoot = () => {
  const r = mkdtempSync(path.join(tmpdir(), "lanyard-keygen-"));
  roots.push(r);
  return r;
};
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("lanyard score-keygen", () => {
  it("writes an owner-only secret matching the printed public key and key ID", () => {
    const root = freshRoot();
    const out = scoreKeygen(root, "testedition");
    expect(out.file).toBe(path.join(".lanyard", "secrets", "score-key.testedition.hex"));
    const file = path.join(root, out.file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const scalar = readFileSync(file, "utf8").trim() as Hex;
    expect(operatorKeyMatches(scalar, out.publicKey)).toBe(true);
    expect(out.keyId).toBe(scoreKeyId(out.publicKey));
  });

  it("refuses to overwrite an existing key", () => {
    const root = freshRoot();
    scoreKeygen(root, "testedition");
    expect(() => scoreKeygen(root, "testedition")).toThrow(KeyExistsError);
  });
});

describe("lanyard desk-keygen", () => {
  it("writes an owner-only private key whose address is the one printed", () => {
    const root = freshRoot();
    const out = deskKeygen(root, "testedition");
    const file = path.join(root, out.file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const key = readFileSync(file, "utf8").trim() as Hex;
    expect(privateKeyToAddress(key).toLowerCase()).toBe(out.address);
    expect(() => deskKeygen(root, "testedition")).toThrow(KeyExistsError);
  });
});
