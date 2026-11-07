// Demo ENS setup in one short command (`pnpm demo:ens`), so nothing long has to be pasted:
// 1. the coordinator (the organizer key here) makes Meera a lead;
// 2. the Arkiv partner wallet issues Sam's staff badge and Ana's judge badge.
// Keys come from .env (ORGANIZER_PRIVATE_KEY, PARTNER_ARKIV_PRIVATE_KEY) and are never printed. Each
// script re-plans from chain, so rerunning sends nothing new.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEPOLIA_PERSONAS_FILE, parseSepoliaPersonas } from "./i1-cast";

const ROOT = resolve(import.meta.dirname, "..");
const cast = parseSepoliaPersonas(JSON.parse(readFileSync(resolve(ROOT, SEPOLIA_PERSONAS_FILE), "utf8")));
const address = (id: string) => {
  const p = cast.personas.find((x) => x.id === id);
  if (!p) throw new Error(`${id} has no live wallet yet: run pnpm e2e:demo:names first`);
  return p.address;
};

function run(signerEnv: string, args: string[]): void {
  const key = process.env[signerEnv];
  if (!key) throw new Error(`${signerEnv} is not set in .env`);
  const r = spawnSync(process.execPath, ["--import", "tsx", ...args], {
    cwd: ROOT,
    env: { ...process.env, SIGNER_PRIVATE_KEY: key },
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`${args[0]} failed`);
}

try {
  run("ORGANIZER_PRIVATE_KEY", ["scripts/ens/set-perms.ts", "--volunteer", "meera", "--make"]);
  for (const [sub, label] of [
    ["staff", "sam"],
    ["judges", "ana"],
  ] as const)
    run("PARTNER_ARKIV_PRIVATE_KEY", [
      "scripts/ens/issue-partner-badge.ts",
      "--partner",
      "arkiv",
      "--sub",
      sub,
      "--label",
      label,
      "--owner",
      address(label),
    ]);
} catch (err) {
  console.error(`demo-ens: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
