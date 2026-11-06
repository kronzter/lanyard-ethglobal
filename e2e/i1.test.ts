// I1 · names meet records (plans/I1-names-meet-records.md), run with `pnpm e2e:i1` after
// `pnpm e2e:i1:seed`. Live, no fork: Sepolia reads go to SEPOLIA_RPC_URL (archive), Rabdi writes are
// real and signed by the seeded persona wallets from .env.
//
// Step 3: every seeded badge/team name is owned by its persona at its issuance block, read directly
//         from the A1 registries (no forward address, no resolver), with every ancestor unexpired.
// Step 4: representative B1 kinds written by those identities. Each record's native creator and flags
//         are read back; its creation timestamp maps to the latest Sepolia block at or before it, where
//         the `by_label` registry owner must equal the creator (the organizer's venue checks the frozen
//         authority instead). One deliberately forged row must be flagged.
// Evidence (retained observations plus each check) goes to .lanyard/i1/ for the later bundle; this is
// not historical Arkiv fetching, and I1 deliberately evaluates no B2/B3/B4 feature verdict.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPublicClient, http, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import rabdiJson from "../deployments/rabdi.json";
import sepoliaJson from "../deployments/sepolia.json";
import venueMumbai from "../fixtures/venue.mumbai.json";
import teamPages from "../fixtures/team-pages.json";
import { createCliProviders } from "../cli/providers";
import { createArkivReader, createKeyWriter } from "../src/arkiv/client";
import { encodeLine, memoryObservationStore, retainObservedEntity } from "../src/arkiv/capture";
import { KINDS, type Kind } from "../src/arkiv/kinds";
import { buildCreate, type WriteContext } from "../src/arkiv/writers";
import type { ArkivWriter, StoredEntity } from "../src/arkiv/api";
import { lanyardRegistrarAbi } from "../src/ens/ensv2-abi";
import { readRegistration } from "../src/ens/registry-read";
import { parseRabdiDeployment, parseSepoliaDeployment, requireLive } from "../src/shared/deployments/load";
import { sepoliaEventConfig } from "../src/shared/live-event.config";
import { GENERAL_TICKET_CATEGORIES } from "../src/shared/config/tickets";
import { privateKeyFromEnv } from "../scripts/ens/safety";
import { parseSepoliaPersonas, SEPOLIA_PERSONAS_FILE, type SepoliaPersona } from "./i1-cast";

const enabled = process.env.LANYARD_I1 === "1";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".lanyard/i1");
const config = sepoliaEventConfig;
const lower = (a: string) => a.toLowerCase();
const h = (s: string) => keccak256(toHex(s));

type Ownership = {
  label: string;
  sepoliaBlock: bigint;
  owner: Address | null;
  status: number;
  expiry: bigint;
  ancestorsValid: boolean;
  timestamp: bigint;
};

function sepoliaClient(): PublicClient {
  const url = process.env.SEPOLIA_RPC_URL;
  if (!url) throw new Error("SEPOLIA_RPC_URL (an archive endpoint) is required for e2e:i1");
  return createPublicClient({ chain: sepolia, transport: http(url) }) as PublicClient;
}

/**
 * Direct A1 traversal: `lanyard` in the ETH registry → `mumbai2026` in the base registry → a book or
 * team label in the edition registry → (badges) the holder label in the book registry. Every hop is
 * read at `block`; ancestors must be registered and unexpired at that block's timestamp.
 */
async function ownershipAt(pc: PublicClient, relLabel: string, block: bigint): Promise<Ownership> {
  const deployment = requireLive(parseSepoliaDeployment(sepoliaJson), config);
  const c = deployment.contracts as Record<string, Address>;
  const chainId = sepolia.id;
  const { timestamp } = await pc.getBlock({ blockNumber: block });
  const read = (registry: Address, label: string) =>
    readRegistration(pc, { chainId, registry, label, blockNumber: block });
  const live = (r: { status: number; expiry: bigint }) => r.status === 2 && r.expiry > timestamp;
  const ancestors = [
    await read(c.ensEthRegistry!, config.baseName.replace(/\.eth$/, "")),
    await read(c.baseRegistry!, config.edition),
  ];
  const parts = relLabel.split(".");
  let target;
  if (parts.length === 1) {
    target = await read(c.editionRegistry!, relLabel);
  } else {
    const [holder, book] = parts as [string, string];
    ancestors.push(await read(c.editionRegistry!, book));
    const registry = await pc.readContract({
      address: c.lanyardRegistrar!,
      abi: lanyardRegistrarAbi,
      functionName: "bookRegistry",
      args: [h(book)],
      blockNumber: block,
    });
    target = await read(registry, holder);
  }
  return {
    label: relLabel,
    sepoliaBlock: block,
    owner: target.owner,
    status: target.status,
    expiry: target.expiry,
    ancestorsValid: ancestors.every(live),
    timestamp,
  };
}

const counts = (o: Ownership, creator: Address) =>
  o.owner !== null &&
  lower(o.owner) === lower(creator) &&
  o.status === 2 &&
  o.expiry > o.timestamp &&
  o.ancestorsValid;

async function loadCast() {
  const file = parseSepoliaPersonas(JSON.parse(await readFile(resolve(ROOT, SEPOLIA_PERSONAS_FILE), "utf8")));
  const byId = (id: string): SepoliaPersona => {
    const p = file.personas.find((x) => x.id === id);
    if (!p) throw new Error(`${id} was not seeded; run pnpm e2e:i1:seed`);
    return p;
  };
  return { file, byId };
}

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x), 2) + "\n";

describe.skipIf(!enabled)("I1 · names meet records (live Sepolia + Rabdi)", () => {
  it("step 3: A1 badge and team creators match direct historical registry ownership", async () => {
    const pc = sepoliaClient();
    const { file } = await loadCast();
    const c = requireLive(parseSepoliaDeployment(sepoliaJson), config).contracts as Record<string, Address>;
    const reg = (functionName: "organizer" | "edition" | "phase") =>
      pc.readContract({ address: c.lanyardRegistrar!, abi: lanyardRegistrarAbi, functionName });
    expect(lower(String(await reg("organizer")))).toBe(config.authorities.organizer);
    expect(lower(String(await reg("edition")))).toBe(lower(c.editionRegistry!));
    expect(await reg("phase")).toBe(2);
    expect(file.organizer).toBe(config.authorities.organizer);

    const checks: Ownership[] = [];
    const ens = createCliProviders({ env: { ...process.env, LANYARD_ENS: "sepolia" } }).ensReader();
    for (const p of file.personas) {
      for (const n of p.names) {
        expect(n.block, `${n.label} has no recorded issuance block`).not.toBeNull();
        const issued = BigInt(n.block!);
        const head = await pc.getBlockNumber();
        for (const block of [issued, head]) {
          const o = await ownershipAt(pc, n.label, block);
          checks.push(o);
          expect(counts(o, p.address), `${n.label} at ${block}`).toBe(true);
          // A2's reader (wired through the CLI composition root) agrees with the direct traversal.
          expect(await ens.owner(n.label, { sepoliaBlock: block })).toBe(lower(p.address));
        }
        // One block before issuance the name was not yet this persona's.
        const prior = await ownershipAt(pc, n.label, issued - 1n);
        expect(counts(prior, p.address), `${n.label} before issuance`).toBe(false);
        if (!n.label.includes(".")) {
          const lead = await pc.readContract({
            address: c.lanyardRegistrar!,
            abi: lanyardRegistrarAbi,
            functionName: "teamLead",
            args: [h(n.label)],
          });
          expect(lower(lead)).toBe(lower(p.address));
        }
      }
    }
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, "ownership.json"), json(checks));
  }, 300_000);

  it("step 4: representative B1 kinds written by A1 identities match registry owners", async () => {
    const pc = sepoliaClient();
    const { file, byId } = await loadCast();
    const access = { rpcUrl: process.env.RABDI_RPC_URL, accessKey: process.env.RABDI_ACCESS_KEY };
    const arkiv = createArkivReader(access);
    const ens = createCliProviders({ env: { ...process.env, LANYARD_ENS: "sepolia" } }).ensReader();
    const rabdi = requireLive(parseRabdiDeployment(rabdiJson), config);
    const network = { chainId: rabdi.chainId, resetId: rabdi.resetId };

    const writerFor = (keyEnv: string): ArkivWriter => {
      const key = privateKeyFromEnv(process.env[keyEnv] ?? "", keyEnv);
      return createKeyWriter(key, access);
    };
    const organizer = writerFor("ORGANIZER_PRIVATE_KEY");
    expect(organizer.account).toBe(file.organizer);
    const persona = (id: string) => {
      const p = byId(id);
      const w = writerFor(p.keyEnv);
      expect(w.account).toBe(p.address);
      expect(lower(privateKeyToAccount(privateKeyFromEnv(process.env[p.keyEnv]!, p.keyEnv)).address)).toBe(
        p.address,
      );
      return { p, w };
    };
    const head = await arkiv.head();
    const ctx = (byLabel: string): WriteContext => ({
      edition: config.edition,
      byLabel,
      times: config.times,
      head,
    });
    for (const w of [organizer]) {
      if ((await arkiv.balance(w.account)) === 0n) throw new Error(`${w.account} has no tGLM; run the seed`);
    }

    type Written = { kind: Kind; key: Hex; writer: Address; byLabel: string; forged?: boolean };
    const written: Written[] = [];
    const write = async (
      w: ArkivWriter,
      rows: { kind: Kind; byLabel: string; create: unknown; forged?: boolean }[],
    ) => {
      if ((await arkiv.balance(w.account)) === 0n)
        throw new Error(`${w.account} has no tGLM; run pnpm e2e:i1:seed`);
      const res = await w.write({ creates: rows.map((r) => r.create) as never });
      expect(res.created).toHaveLength(rows.length);
      rows.forEach((r, i) =>
        written.push({
          kind: r.kind,
          key: res.created[i]!,
          writer: w.account,
          byLabel: r.byLabel,
          forged: r.forged,
        }),
      );
      return res.created;
    };

    // Organizer authority: the real Mumbai venue (A3.1) as a readonly `venue` record.
    const [venueKey] = await write(organizer, [
      {
        kind: "venue",
        byLabel: "organizer",
        create: buildCreate("venue", ctx("organizer"), { version: "mumbai-1", venue: venueMumbai }),
      },
    ]);

    // Volunteer lead writes a shift for Ravi; Ravi clocks in. Ravi's batch also carries a duty pass
    // that claims to be Priya's: B1 does not stop it (B2's job), the ownership check must flag it.
    const priya = persona("priya");
    const ravi = persona("ravi");
    const startsAt = head.timestamp + 600n;
    const [shiftKey] = await write(priya.w, [
      {
        kind: "shift",
        byLabel: priya.p.by,
        create: buildCreate("shift", ctx(priya.p.by), {
          volunteer: ravi.p.by,
          zone: "west",
          startsAt,
          endsAt: startsAt + 7200n,
        }),
      },
    ]);
    await write(ravi.w, [
      {
        kind: "clock",
        byLabel: ravi.p.by,
        create: buildCreate("clock", ctx(ravi.p.by), {
          volunteer: ravi.p.by,
          shift: shiftKey!,
          action: "in",
        }),
      },
      {
        kind: "duty_pass",
        byLabel: priya.p.by,
        forged: true,
        create: buildCreate("duty_pass", ctx(priya.p.by), {
          volunteer: ravi.p.by,
          shift: shiftKey!,
          endsAt: startsAt + 7200n,
        }),
      },
    ]);

    // A hacker raises a ticket from a west seat of that venue.
    const hacker = persona("zkpay-b");
    await write(hacker.w, [
      {
        kind: "ticket",
        byLabel: hacker.p.by,
        create: buildCreate("ticket", ctx(hacker.p.by), {
          seat: "s232",
          venue: venueKey!,
          category: GENERAL_TICKET_CATEGORIES[0]!.id,
        }),
      },
    ]);

    // The team lead drafts the team's project (a mutable draft; no submission, so I1 never becomes
    // the team's earliest valid submission in the live event).
    const lead = persona("zkpay-a");
    await write(lead.w, [
      {
        kind: "project",
        byLabel: lead.p.by,
        create: buildCreate("project", ctx(lead.p.by), {
          team: "zkpay",
          track: "main",
          content: { page: { ...teamPages.populated.content } as never },
        }),
      },
    ]);

    // Read every record back and check it against A1 ownership at its creation time.
    const store = memoryObservationStore();
    const evidence: unknown[] = [];
    for (const r of written) {
      const e = (await arkiv.get(r.key)) as StoredEntity;
      expect(e, r.key).not.toBeNull();
      expect(e.creator).toBe(lower(r.writer));
      expect(e.owner).toBe(lower(r.writer));
      expect(e.flags).toEqual({ permissionlessExtension: false, ...KINDS[r.kind].flags });
      for (const [name, value] of Object.entries({
        app: "lanyard",
        event: config.edition,
        kind: r.kind,
        by_label: r.byLabel,
      }))
        expect(e.attributes[name]?.value.value, name).toBe(value);
      const created = await arkiv.block(e.createdAt);
      const sepoliaBlock = await ens.sepoliaBlockAt(created.timestamp);
      const sepoliaTs = (await pc.getBlock({ blockNumber: sepoliaBlock })).timestamp;
      expect(sepoliaTs <= created.timestamp).toBe(true);
      let ok: boolean;
      let ownership: Ownership | null = null;
      if (r.byLabel === "organizer") ok = e.creator === config.authorities.organizer;
      else {
        ownership = await ownershipAt(pc, r.byLabel, sepoliaBlock);
        ok = counts(ownership, e.creator);
      }
      expect(ok, `${r.kind} by ${r.byLabel}`).toBe(!r.forged);
      await retainObservedEntity(arkiv, store, e, network);
      evidence.push({
        kind: r.kind,
        key: r.key,
        creator: e.creator,
        byLabel: r.byLabel,
        arkivCreatedAtBlock: e.createdAt,
        arkivCreatedAtTimestamp: created.timestamp,
        sepoliaBlock,
        ownership,
        counts: ok,
        forged: r.forged ?? false,
      });
    }
    const { observations } = await store.load();
    // Readonly kinds are retained; the mutable project draft is not evidence.
    expect(observations.map((o) => o.kind).sort()).toEqual([
      "clock",
      "duty_pass",
      "shift",
      "ticket",
      "venue",
    ]);
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, "records.json"), json(evidence));
    await writeFile(
      resolve(OUT, "observations.jsonl"),
      observations.map((observation) => encodeLine({ type: "observation", observation })).join("\n") + "\n",
    );
  }, 600_000);
});
