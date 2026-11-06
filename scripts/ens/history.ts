// Local record of each revoke/revive and the Sepolia block it landed in, so I2 can replay them (A2.3-R3).
// Live runs append to fixtures/sepolia-history.json (a JSON array, oldest first), which is committed on
// the I2 integration branch, never on a phase branch. Fork runs write .lanyard/sepolia-history-fork.json
// (git-ignored) so a rehearsal never pollutes the real record.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendHistory, type HistoryEvent } from "../../src/ens/revive-plan";
import { ROOT } from "./connect";

export function historyPath(fork: boolean): string {
  return resolve(ROOT, fork ? ".lanyard/sepolia-history-fork.json" : "fixtures/sepolia-history.json");
}

export function recordHistory(fork: boolean, event: HistoryEvent): string {
  const path = historyPath(fork);
  const existing: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(appendHistory(existing, event), null, 2)}\n`);
  return path;
}
