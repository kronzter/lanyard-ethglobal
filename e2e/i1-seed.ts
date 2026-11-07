// I1 seeding (plans/I1-names-meet-records.md steps 1–2), run with `pnpm e2e:i1:seed`.
//
// A small live cast: team `zkpay` (Person A–D, each with a `hackers` badge; A also owns `zkpay`) and two
// volunteers (lead Priya, Ravi). Global judges are issued only by the head judge's wallet, which this
// machine does not hold, so none is seeded here.
//
// 1. Each persona gets a fresh wallet. A missing key is generated into the git-ignored .env under the
//    persona's `keyEnv`; keys are never printed.
// 2. Names are issued on live Sepolia through A1's own operator scripts (issue-badge / register-team,
//    organizer key). Both re-plan from chain state, so a rerun sends nothing new.
// 3. Every persona and the organizer get first-time tGLM through B1's desk drip (`lanyard drip`), which
//    refuses an address that already has a desk-wallet `drip` record.
// 4. Addresses and transactions go to fixtures/sepolia-personas.json (public data only).
import { spawn } from "node:child_process";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { parsePersonas, type Persona } from "../src/shared/fixtures/personas";
import { sepoliaEventConfig } from "../src/shared/live-event.config";
import { privateKeyFromEnv } from "../scripts/ens/safety";
import {
  I1_CAST,
  SEPOLIA_PERSONAS_FILE,
  parseSepoliaPersonas,
  type SepoliaPersona,
  type SepoliaPersonas,
} from "./i1-cast";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(ROOT, ".env");
const TX = /0x[0-9a-f]{64}/i;

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString();
      process.stderr.write(d);
    });
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, out }));
  });
}

/** Fill `KEY=` lines (or append) for personas without a usable key. Writes .env atomically, same mode. */
function ensureKeys(cast: Persona[]): void {
  const missing = cast.filter((p) => {
    try {
      privateKeyFromEnv(process.env[p.keyEnv] ?? "", p.keyEnv);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length === 0) return;
  let text = readFileSync(ENV_FILE, "utf8");
  for (const p of missing) {
    const key = generatePrivateKey();
    const line = new RegExp(`^${p.keyEnv}=.*$`, "m");
    text = line.test(text)
      ? text.replace(line, `${p.keyEnv}=${key}`)
      : `${text.replace(/\n?$/, "\n")}${p.keyEnv}=${key}\n`;
    process.env[p.keyEnv] = key;
    console.log(`generated a wallet for ${p.id} into .env (${p.keyEnv})`);
  }
  const tmp = `${ENV_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: statSync(ENV_FILE).mode & 0o777 });
  renameSync(tmp, ENV_FILE);
}

function previous(): SepoliaPersonas | null {
  try {
    return parseSepoliaPersonas(JSON.parse(readFileSync(resolve(ROOT, SEPOLIA_PERSONAS_FILE), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function main(): Promise<void> {
  const all = parsePersonas(
    JSON.parse(readFileSync(resolve(ROOT, "fixtures/personas.json"), "utf8")),
  ).personas;
  const cast = I1_CAST.map((id) => {
    const p = all.find((x) => x.id === id);
    if (!p) throw new Error(`persona ${id} is not in fixtures/personas.json`);
    return p;
  });
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is not set");
  const organizer = privateKeyToAccount(
    privateKeyFromEnv(process.env.ORGANIZER_PRIVATE_KEY ?? "", "ORGANIZER_PRIVATE_KEY"),
  ).address.toLowerCase() as Hex;
  if (organizer !== sepoliaEventConfig.authorities.organizer)
    throw new Error("ORGANIZER_PRIVATE_KEY is not the live organizer in src/shared/live-event.config.ts");

  ensureKeys(cast);
  const pc = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const before = previous();
  const out: SepoliaPersona[] = [];

  for (const p of cast) {
    const address = privateKeyToAccount(
      privateKeyFromEnv(process.env[p.keyEnv]!, p.keyEnv),
    ).address.toLowerCase() as Hex;
    const earlier = before?.personas.find((x) => x.id === p.id && x.address === address);
    const names: SepoliaPersona["names"] = [];
    for (const label of p.labels) {
      const parts = label.split(".");
      // Partner badges are issued by the partner's own wallet (scripts/ens/issue-partner-badge.ts), never
      // the organizer: record one only once it exists for this persona.
      if (parts.at(-1) === "partners") {
        const kept = earlier?.names.find((n) => n.label === label);
        if (kept) names.push(kept);
        else console.log(`${label}: issued by the partner wallet; see pnpm e2e:i3:seed`);
        continue;
      }
      const args =
        parts.length === 1
          ? ["scripts/ens/register-team.ts", "--label", label, "--lead", address]
          : ["scripts/ens/issue-badge.ts", "--book", parts[1]!, "--label", parts[0]!, "--owner", address];
      const r = await run(args);
      if (r.code !== 0) throw new Error(`issuing ${label} for ${p.id} failed`);
      const tx = r.out.match(TX)?.[0]?.toLowerCase() as Hex | undefined;
      const kept = earlier?.names.find((n) => n.label === label);
      if (tx) {
        const receipt = await pc.getTransactionReceipt({ hash: tx });
        names.push({ label, tx, block: receipt.blockNumber.toString() });
      } else if (kept) names.push(kept);
      else names.push({ label, tx: null, block: null }); // issued earlier by another run
    }
    out.push({ id: p.id, by: p.by, keyEnv: p.keyEnv, address, names, drip: earlier?.drip ?? null });
  }

  // Funding: every persona plus the organizer (for the venue record).
  const recipients: { id: string; address: Hex }[] = [
    ...out.map((p) => ({ id: p.id, address: p.address })),
    { id: "organizer", address: organizer },
  ];
  const drips: Record<string, SepoliaPersona["drip"]> = Object.fromEntries(out.map((p) => [p.id, p.drip]));
  drips.organizer = before?.organizerDrip ?? null;
  for (const r of recipients) {
    const res = await run(["cli/index.ts", "drip", r.address]);
    const json = res.out.match(/^\{$[\s\S]*?^\}$/m)?.[0];
    if (!json) throw new Error(`drip to ${r.id} printed no outcome`);
    const outcome = JSON.parse(json) as {
      status: string;
      txHash?: Hex;
      recordKey?: Hex;
      reason?: string;
      detail?: string;
    };
    if (outcome.status === "sent") drips[r.id] = { tx: outcome.txHash!, record: outcome.recordKey! };
    else if (outcome.status === "refused" && outcome.reason === "already-dripped") {
      // Funded by an earlier run: keep its transaction, else at least the drip record it names.
      const record = outcome.detail?.match(TX)?.[0]?.toLowerCase() as Hex | undefined;
      drips[r.id] ??= record ? { tx: null, record } : null;
    } else throw new Error(`drip to ${r.id} ended ${outcome.status}`);
  }

  const file: SepoliaPersonas = {
    schemaVersion: 1,
    network: "sepolia",
    edition: sepoliaEventConfig.edition,
    organizer,
    organizerDrip: drips.organizer ?? null,
    personas: out.map((p) => ({ ...p, drip: drips[p.id] ?? null })),
  };
  parseSepoliaPersonas(file);
  writeFileSync(resolve(ROOT, SEPOLIA_PERSONAS_FILE), JSON.stringify(file, null, 2) + "\n");
  console.log(`wrote ${SEPOLIA_PERSONAS_FILE}`);
}

main().catch((err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  console.error(`i1-seed: ${text.replace(/(?:https?|wss?):\/\/\S+/gi, "<rpc-url>")}`);
  process.exitCode = 1;
});
