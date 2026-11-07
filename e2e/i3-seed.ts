// I3 seeding (plans/I3-real-venue.md steps 1–2), run with `pnpm e2e:i3:seed` (plan) or
// `pnpm e2e:i3:seed --apply` (send). Every run re-plans from Rabdi, so a rerun sends nothing new, and
// I4 can run it again on a fresh edition.
//
// 0. Preconditions, read only. Live Sepolia names and permissions the smoke test needs; anything
//    missing is printed as the exact command to run with the right key (never sent from here).
// 1. The organizer publishes fixtures/venue.mumbai.json as a readonly `venue` record (version
//    `mumbai-i3`) unless an identical one exists; its key goes to fixtures/sepolia-venue.json.
// 2. The organizer writes fixtures/seats.mumbai.csv as `seat_assignment` records for that venue.
// 3. Lead Priya schedules north-zone shifts for Ravi and Anita from now, and clocks both in with a duty
//    pass (one batch each), unless the volunteer already has a shift covering now.
//
// Keys come from the environment (ORGANIZER_PRIVATE_KEY and each persona's keyEnv); none is printed.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isHex, keccak256, toHex, type Address, type Hex } from "viem";
import rabdiJson from "../deployments/rabdi.json";
import venueMumbai from "../fixtures/venue.mumbai.json";
import { createArkivReader, createKeyWriter } from "../src/arkiv/client";
import type { ArkivValue } from "@arkiv-network/sdk";
import type { StoredEntity } from "../src/arkiv/api";
import { scanKind } from "../src/arkiv/readers";
import { parseSeatCsv } from "../src/arkiv/seat-import";
import { buildCreate, type WriteContext } from "../src/arkiv/writers";
import { createCliProviders } from "../cli/providers";
import { parseRabdiDeployment, requireLive } from "../src/shared/deployments/load";
import { sepoliaEventConfig as config } from "../src/shared/live-event.config";
import { privateKeyFromEnv } from "../scripts/ens/safety";
import { SEPOLIA_PERSONAS_FILE, parseSepoliaPersonas } from "./i1-cast";
import { SEATS_FILE, SEPOLIA_VENUE_FILE, VENUE_VERSION, mumbaiVenue } from "./i3-venue";

const ROOT = resolve(import.meta.dirname, "..");
const SHIFT_ZONE = "north";
const SHIFT_VOLUNTEERS = ["ravi", "anita"] as const;
const SHIFT_HOURS = BigInt(process.env.I3_SHIFT_HOURS ?? "12");
const STAFF = { partner: "arkiv", sub: "staff", label: "sam" } as const;

const apply = process.argv.includes("--apply");
const lower = (a: string) => a.toLowerCase();

const str = (value: string) => ({ type: "str", value }) as ArkivValue;

/** The raw payload bytes of a stored record, as hex. */
const payloadHex = (e: StoredEntity | null): Hex | null => {
  const v = e?.attributes.payload?.value.value as unknown;
  if (typeof v === "string" && isHex(v)) return v.toLowerCase() as Hex;
  if (v instanceof Uint8Array) return toHex(v);
  return null;
};

function writeJsonAtomic(rel: string, value: unknown): void {
  const file = resolve(ROOT, rel);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

async function main(): Promise<void> {
  const cast = parseSepoliaPersonas(JSON.parse(readFileSync(resolve(ROOT, SEPOLIA_PERSONAS_FILE), "utf8")));
  const persona = (id: string) => {
    const p = cast.personas.find((x) => x.id === id);
    if (!p)
      throw new Error(`${id} is not in ${SEPOLIA_PERSONAS_FILE}; add it to I1_CAST and run pnpm e2e:i1:seed`);
    return p;
  };
  const access = { rpcUrl: process.env.RABDI_RPC_URL, accessKey: process.env.RABDI_ACCESS_KEY };
  const arkiv = createArkivReader(access);
  requireLive(parseRabdiDeployment(rabdiJson), config);
  const ens = createCliProviders({ env: { ...process.env, LANYARD_ENS: "sepolia" } }).ensReader();
  const writer = (keyEnv: string) =>
    createKeyWriter(privateKeyFromEnv(process.env[keyEnv] ?? "", keyEnv), access);

  // 0. Preconditions on live Sepolia.
  const at = { sepoliaBlock: await ens.headBlock() };
  const todo: string[] = [];
  const priya = persona("priya");
  const perms = await ens.text(priya.by, "lanyard.perms", at);
  if (!perms?.includes("shift-manager"))
    todo.push(
      `${priya.by} is not a lead: SIGNER_PRIVATE_KEY=<coordinator> pnpm exec tsx scripts/ens/set-perms.ts --volunteer priya --make`,
    );
  for (const id of SHIFT_VOLUNTEERS) {
    const p = cast.personas.find((x) => x.id === id);
    if (!p) todo.push(`${id} has no live wallet yet: pnpm e2e:i1:seed`);
    else if (lower((await ens.owner(p.by, at)) ?? "") !== lower(p.address))
      todo.push(`${p.by} is not held by ${p.address}: pnpm e2e:i1:seed`);
  }
  const staffLabel = `${STAFF.label}.${STAFF.sub}.${STAFF.partner}.partners`;
  const staff = cast.personas.find((p) => p.id === STAFF.label);
  if (!(await ens.owner(`${STAFF.partner}.partners`, at)))
    todo.push(
      `${STAFF.partner}.partners is not onboarded: pnpm exec tsx scripts/ens/grant-roles.ts --partners ${STAFF.partner}=<partner wallet>`,
    );
  if (!staff || lower((await ens.owner(staffLabel, at)) ?? "") !== lower(staff.address))
    todo.push(
      `${staffLabel} is missing: SIGNER_PRIVATE_KEY=<partner wallet> pnpm exec tsx scripts/ens/issue-partner-badge.ts --partner ${STAFF.partner} --sub ${STAFF.sub} --label ${STAFF.label} --owner <sam's wallet>`,
    );

  // 1. Venue.
  const { venue, bytes, hash } = mumbaiVenue();
  const organizer = config.authorities.organizer;
  const venues = await scanKind(
    arkiv,
    config.edition,
    "venue",
    { version: str(VENUE_VERSION) },
    { creator: organizer },
  );
  let venueKey: Hex | undefined;
  for (const r of venues.records) {
    const p = payloadHex(await arkiv.get(r.key));
    if (p && keccak256(p) === hash) venueKey = r.key;
  }
  console.log(
    `venue ${VENUE_VERSION}: ${bytes.length} bytes, hash ${hash}, ${venueKey ? `published ${venueKey}` : "to publish"}`,
  );

  // 2. Seats (only once the venue exists; a plan lists all of them).
  const { rows, errors } = parseSeatCsv(readFileSync(resolve(ROOT, SEATS_FILE), "utf8"), venue);
  if (errors.length) throw new Error(`${SEATS_FILE}:\n${errors.join("\n")}`);
  const seated = venueKey
    ? new Set(
        (await scanKind(arkiv, config.edition, "seat_assignment", {}, { creator: organizer })).records
          .filter((r) => lower(String(r.values.venue)) === lower(venueKey!))
          .map((r) => String(r.values.hacker_label)),
      )
    : new Set<string>();
  const seatsTodo = rows.filter((r) => !seated.has(r.hackerLabel));
  console.log(`seats: ${rows.length - seatsTodo.length} written, ${seatsTodo.length} to write`);

  // 3. Shifts covering now.
  const head = await arkiv.head();
  const now = head.timestamp;
  const shifts = (
    await scanKind(
      arkiv,
      config.edition,
      "shift",
      { zone: str(SHIFT_ZONE) },
      { creator: priya.address as Address },
    )
  ).records;
  const covered = (by: string) =>
    shifts.some(
      (r) =>
        r.values.volunteer === by && BigInt(r.values.starts_at!) <= now && now < BigInt(r.values.ends_at!),
    );
  const shiftsTodo = cast.personas
    .filter((p) => (SHIFT_VOLUNTEERS as readonly string[]).includes(p.id))
    .filter((p) => !covered(p.by));
  console.log(
    `shifts (${SHIFT_ZONE}): ${shiftsTodo.length ? `to schedule for ${shiftsTodo.map((p) => p.id).join(", ")}` : "on duty"}`,
  );

  if (todo.length)
    console.log(`\nlive ENS steps still needed (run these, then rerun):\n- ${todo.join("\n- ")}`);
  if (!apply) {
    console.log("\nplan only: rerun with --apply to send the Arkiv writes");
    return;
  }

  const ctx = (byLabel: string): WriteContext => ({
    edition: config.edition,
    byLabel,
    times: config.times,
    head,
  });
  const org = writer("ORGANIZER_PRIVATE_KEY");
  if (lower(org.account) !== lower(organizer))
    throw new Error("ORGANIZER_PRIVATE_KEY is not the live organizer");
  if (!venueKey) {
    const res = await org.write({
      creates: [buildCreate("venue", ctx("organizer"), { version: VENUE_VERSION, venue: venueMumbai })],
    });
    venueKey = res.created[0]!;
    console.log(`published venue ${venueKey}  ${res.txHash}`);
  }
  const stored = await arkiv.get(venueKey);
  if (!stored || keccak256(payloadHex(stored) ?? "0x") !== hash)
    throw new Error("the venue record does not read back identical");
  writeJsonAtomic(SEPOLIA_VENUE_FILE, {
    schemaVersion: 1,
    network: { chainId: config.chains.rabdi.chainId, resetId: config.chains.rabdi.resetId },
    edition: config.edition,
    version: VENUE_VERSION,
    key: venueKey,
    createdAtBlock: stored.createdAt.toString(),
    canonicalHash: hash,
    bytes: bytes.length,
  });

  for (let i = 0; i < seatsTodo.length; i += 20) {
    const batch = seatsTodo.slice(i, i + 20);
    const res = await org.write({
      creates: batch.map((r) => buildCreate("seat_assignment", ctx("organizer"), { ...r, venue: venueKey! })),
    });
    console.log(`seated ${batch.map((r) => `${r.hackerLabel}@${r.seat}`).join(", ")}  ${res.txHash}`);
  }

  if (shiftsTodo.length) {
    if (todo.some((t) => t.startsWith(priya.by)))
      throw new Error(`${priya.by} must be a lead before scheduling shifts`);
    const lead = writer(priya.keyEnv);
    const endsAt = now + SHIFT_HOURS * 3_600n;
    for (const v of shiftsTodo) {
      const [shift] = (
        await lead.write({
          creates: [
            buildCreate("shift", ctx(priya.by), { volunteer: v.by, zone: SHIFT_ZONE, startsAt: now, endsAt }),
          ],
        })
      ).created;
      const res = await lead.write({
        creates: [
          buildCreate("clock", ctx(priya.by), { volunteer: v.by, shift: shift!, action: "in" }),
          buildCreate("duty_pass", ctx(priya.by), { volunteer: v.by, shift: shift!, endsAt }),
        ],
      });
      console.log(`${v.by} on duty in ${SHIFT_ZONE} until ${endsAt}  ${res.txHash}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(`i3-seed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
