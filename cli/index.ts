#!/usr/bin/env node
// Lanyard operator CLI (Node only). Run with `pnpm lanyard <command>`.
// Signing and decryption keys come only from the local .env, never from the app.
// The app (app/, src/) must never import this folder (enforced by lanyard/boundaries).
import path from "node:path";
import { runCapture } from "./capture";
import { runDeskKeygen } from "./desk-keygen";
import { runDrip } from "./drip";
import { createCliProviders } from "./providers";
import { runScoreKeygen } from "./score-keygen";
import { runHash, runVerify } from "./verify";

const commands: Record<string, string> = {
  verify: "B2.3 · reproduce a signed evidence bundle: verify <event> [--bundle <path>] [--offline]",
  hash: "B2.3 · print the canonical rules output hash: hash <event> --bundle <path>",
  capture: "B1.3 · retain observed readonly Arkiv records: capture [--every <s>] [--max-pages <n>]",
  freeze: "B4.4 · resumable freeze pipeline: capture → rules → bundle → publish → lock",
  "score-keygen": "P0.6-S11 · create the edition score keypair (secret to .lanyard/secrets, never printed)",
  "desk-keygen": "B1.1 · create the desk wallet key (secret to .lanyard/secrets, never printed)",
  drip: "B1.1 · send first-time tGLM from the desk wallet and record it: drip <address>",
};

const root = path.resolve(import.meta.dirname, "..");
const implemented: Record<string, (args: string[]) => number | Promise<number>> = {
  "score-keygen": () => runScoreKeygen(root),
  "desk-keygen": () => runDeskKeygen(root),
  drip: (args) => runDrip(root, args),
  capture: (args) => runCapture(root, args),
  hash: (args) => runHash(args),
  verify: (args) => {
    const p = createCliProviders({ publisherFile: path.join(root, ".lanyard/mock-publisher.json") });
    return runVerify(args, {
      config: p.config,
      ensReader: p.ensReader,
      publisher: p.resultsPublisher,
      sepoliaBlocks: p.sepoliaBlocks,
      fetchText: async (uri) => {
        const res = await fetch(uri);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
    });
  },
};

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log("usage: lanyard <command>\n");
  for (const [name, summary] of Object.entries(commands)) console.log(`  ${name.padEnd(12)} ${summary}`);
  process.exit(0);
}

if (command in implemented) {
  // The CLI runs as CommonJS under tsx, so no top-level await: settle the promise explicitly.
  Promise.resolve()
    .then(() => implemented[command]!(rest))
    .then(
      (code) => process.exit(code),
      (e: unknown) => {
        console.error(`lanyard ${command}: ${(e as Error).message}`);
        process.exit(1);
      },
    );
} else if (command in commands) {
  console.error(`lanyard ${command}: not implemented yet (${commands[command]}).`);
  process.exit(2);
} else {
  console.error(`lanyard: unknown command '${command}'. Run 'pnpm lanyard --help'.`);
  process.exit(1);
}
