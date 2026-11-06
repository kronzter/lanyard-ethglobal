#!/usr/bin/env node
// Lanyard operator CLI (Node only). Run with `pnpm lanyard <command>`.
// Signing and decryption keys come only from the local .env, never from the app.
// The app (app/, src/) must never import this folder (enforced by lanyard/boundaries).
import path from "node:path";
import { runScoreKeygen } from "./score-keygen";

const commands: Record<string, string> = {
  verify: "B2.3 · reproduce a signed evidence bundle and print a scoped MATCH",
  hash: "B2.3 · print the canonical output hash of a bundle",
  capture: "B1.3 · retain observed readonly Arkiv records for an event",
  freeze: "B4.4 · resumable freeze pipeline: capture → rules → bundle → publish → lock",
  "score-keygen": "P0.6-S11 · create the edition score keypair (secret to .lanyard/secrets, never printed)",
};

const implemented: Record<string, () => number> = {
  "score-keygen": () => runScoreKeygen(path.resolve(import.meta.dirname, "..")),
};

const [command] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log("usage: lanyard <command>\n");
  for (const [name, summary] of Object.entries(commands)) console.log(`  ${name.padEnd(12)} ${summary}`);
  process.exit(0);
}

if (command in implemented) process.exit(implemented[command]!());

if (command in commands) {
  console.error(`lanyard ${command}: not implemented yet (${commands[command]}).`);
  process.exit(2);
}

console.error(`lanyard: unknown command '${command}'. Run 'pnpm lanyard --help'.`);
process.exit(1);
