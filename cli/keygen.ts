// Operator key generation shared by `lanyard score-keygen` and `lanyard desk-keygen`.
// A secret is written exactly once to `.lanyard/secrets/<name>.<edition>.hex` (git-ignored,
// directory 0700, file 0600) and never printed. The operator moves it into .env and deletes the
// file; commands print only public material (a public key or an address).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export class KeyExistsError extends Error {
  constructor(readonly file: string) {
    super(`${file} already exists; refusing to overwrite a key`);
    this.name = "KeyExistsError";
  }
}

/** Write `secret` to `.lanyard/secrets/<name>.<edition>.hex`; returns the repo-relative path. */
export function writeSecretOnce(root: string, name: string, edition: string, secret: string): string {
  const dir = path.join(root, ".lanyard", "secrets");
  const file = path.join(dir, `${name}.${edition}.hex`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    // "wx": fail if the file exists; 0600: readable by its owner only.
    writeFileSync(file, `${secret}\n`, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new KeyExistsError(path.relative(root, file));
    throw e;
  }
  return path.relative(root, file);
}

/** Run a keygen command: print its public lines, or refuse cleanly if the key already exists. */
export function runKeygen(command: string, make: () => string[]): number {
  try {
    for (const line of make()) console.log(line);
    return 0;
  } catch (e) {
    if (e instanceof KeyExistsError) {
      console.error(`lanyard ${command}: ${e.message}.`);
      return 1;
    }
    throw e;
  }
}
