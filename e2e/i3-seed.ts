// I3 seeding (plans/I3-real-venue.md steps 1–2), run with `pnpm e2e:i3:seed` (plan) or
// `pnpm e2e:i3:seed --apply` (send). Every run re-plans from Rabdi, so a rerun sends nothing new, and
// I4 can run it again on a fresh edition.
//
// 0. Preconditions, read only. Live Sepolia names and permissions the smoke test needs; anything
//    missing is printed as the exact command to run with the right key (never sent from here).
// 1. The organizer publishes fixtures/venue.mumbai.json as a readonly `venue` record (version
//    `mumbai-i3`) unless an identical one exists; its key goes to fixtures/sepolia-venue.json.
// 2. The organizer seats team chainchat in the north zone (`seat_assignment` records for that venue).
// 3. Lead Meera schedules north-zone shifts for Dev and Anita from now and clocks Anita in with a duty
//    pass; Dev is checked in live in the demo. A volunteer with a shift covering now is skipped.
// 4. Judging: an Arkiv-track rubric, chainchat's submission and acceptance, and partner judge Ana's
//    assignment. Ana writes her own scores from her phone.
//
// Run `pnpm e2e:demo:names` first: it creates the demo cast's wallets, names and tGLM.
//
// Keys come from the environment (ORGANIZER_PRIVATE_KEY and each persona's keyEnv); none is printed.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isHex, keccak256, toHex, type Address, type Hex } from "viem";
import rabdiJson from "../deployments/rabdi.json";
import teamPages from "../fixtures/team-pages.json";
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
import { SEPOLIA_VENUE_FILE, VENUE_VERSION, mumbaiVenue } from "./i3-venue";

const ROOT = resolve(import.meta.dirname, "..");
const SHIFT_ZONE = "north";
const LEAD = "meera";
const SHIFT_VOLUNTEERS = ["dev", "anita"] as const;
/** Team chainchat sits in the north zone; Person A raises the demo ticket from s014. */
const SEATS: Record<string, string> = { "chainchat-a": "s014", "chainchat-b": "s015" };
const SHIFT_HOURS = BigInt(process.env.I3_SHIFT_HOURS ?? "12");
const STAFF = { partner: "arkiv", sub: "staff", label: "sam" } as const;
/** Clocked in by the seed so tickets have a helper at once; Dev is clocked in live by Meera (demo 2). */
const PRE_CLOCKED = new Set(["anita"]);
/** Demo 3: team chainchat submits to the Arkiv track and partner judge Ana is assigned to score it. */
const JUDGE = { partner: "arkiv", sub: "judges", label: "ana", track: "arkiv", team: "chainchat" } as const;

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
      throw new Error(
        `${id} is not in ${SEPOLIA_PERSONAS_FILE}; add it to DEMO_CAST and run pnpm e2e:demo:names`,
      );
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
  const leadP = cast.personas.find((p) => p.id === LEAD);
  if (!leadP) throw new Error(`${LEAD} has no live wallet yet: run pnpm e2e:demo:names first`);
  const perms = await ens.text(leadP.by, "lanyard.perms", at);
  if (!perms?.includes("shift-manager"))
    todo.push(
      `${leadP.by} is not a lead: SIGNER_PRIVATE_KEY=<coordinator> pnpm exec tsx scripts/ens/set-perms.ts --volunteer ${LEAD} --make`,
    );
  for (const id of SHIFT_VOLUNTEERS) {
    const p = cast.personas.find((x) => x.id === id);
    if (!p) todo.push(`${id} has no live wallet yet: pnpm e2e:demo:names`);
    else if (lower((await ens.owner(p.by, at)) ?? "") !== lower(p.address))
      todo.push(`${p.by} is not held by ${p.address}: pnpm e2e:demo:names`);
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

  const judgeLabel = `${JUDGE.label}.${JUDGE.sub}.${JUDGE.partner}.partners`;
  const judge = cast.personas.find((p) => p.id === JUDGE.label);
  const judgeReady = !!judge && lower((await ens.owner(judgeLabel, at)) ?? "") === lower(judge.address);
  if (!judgeReady)
    todo.push(
      `${judgeLabel} is missing: SIGNER_PRIVATE_KEY=<partner wallet> pnpm exec tsx scripts/ens/issue-partner-badge.ts --partner ${JUDGE.partner} --sub ${JUDGE.sub} --label ${JUDGE.label} --owner ${judge?.address ?? "<ana's wallet; run pnpm e2e:demo:names first>"}`,
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
  // Built from the live cast, then checked exactly as the organizer screen checks an imported CSV.
  const csv = [
    "hacker_address,hacker_label,seat",
    ...Object.entries(SEATS)
      .filter(([id]) => cast.personas.some((p) => p.id === id))
      .map(([id, seat]) => `${persona(id).address},${persona(id).by},${seat}`),
  ].join("\n");
  const { rows, errors } = parseSeatCsv(csv, venue);
  if (errors.length) throw new Error(`seat assignments:\n${errors.join("\n")}`);
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
      { creator: leadP.address as Address },
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

  // 4. Judging: rubric, project, submission, acceptance, Ana's assignment (each once).
  const lead = persona(`${JUDGE.team}-a`);
  const mine = async (
    kind: "rubric" | "project" | "submission" | "acceptance" | "judge_assignment",
    creator: string,
  ) => (await scanKind(arkiv, config.edition, kind, {}, { creator: creator as Address })).records;
  // Team records are written as the team label (the lead holds it), never the lead's hackers badge.
  const rubric = (await mine("rubric", organizer)).find((r) => r.values.track === JUDGE.track);
  const project = (await mine("project", lead.address)).find(
    (r) => r.values.team === JUDGE.team && r.byLabel === JUDGE.team,
  );
  const submission = (await mine("submission", lead.address)).find(
    (r) => r.values.team === JUDGE.team && r.byLabel === JUDGE.team,
  );
  const accepted =
    !!submission &&
    (await mine("acceptance", organizer)).some(
      (r) => lower(String(r.values.submission)) === lower(submission.key),
    );
  const assigned =
    !!submission &&
    (await mine("judge_assignment", organizer)).some(
      (r) => r.values.judge === judgeLabel && lower(String(r.values.submission)) === lower(submission.key),
    );
  console.log(
    `judging (${JUDGE.track}): rubric ${rubric ? "set" : "to write"}, submission ${submission ? "made" : "to make"}, ` +
      `acceptance ${accepted ? "done" : "to write"}, ${judgeLabel} ${assigned ? "assigned" : judgeReady ? "to assign" : "waits for the badge"}`,
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
    if (todo.some((t) => t.startsWith(leadP.by)))
      throw new Error(`${leadP.by} must be a lead before scheduling shifts`);
    const leadW = writer(leadP.keyEnv);
    const endsAt = now + SHIFT_HOURS * 3_600n;
    for (const v of shiftsTodo) {
      const [shift] = (
        await leadW.write({
          creates: [
            buildCreate("shift", ctx(leadP.by), { volunteer: v.by, zone: SHIFT_ZONE, startsAt: now, endsAt }),
          ],
        })
      ).created;
      if (!PRE_CLOCKED.has(v.id)) {
        console.log(`${v.by} scheduled in ${SHIFT_ZONE} until ${endsAt}; ${LEAD} clocks them in live`);
        continue;
      }
      const res = await leadW.write({
        creates: [
          buildCreate("clock", ctx(leadP.by), { volunteer: v.by, shift: shift!, action: "in" }),
          buildCreate("duty_pass", ctx(leadP.by), { volunteer: v.by, shift: shift!, endsAt }),
        ],
      });
      console.log(`${v.by} on duty in ${SHIFT_ZONE} until ${endsAt}  ${res.txHash}`);
    }
  }

  // 4. Judging writes, organizer and team lead only; scores are Ana's own, written from her phone.
  let rubricKey = rubric?.key;
  if (!rubricKey) {
    const res = await org.write({
      creates: [
        buildCreate("rubric", ctx("organizer"), {
          track: JUDGE.track,
          rubric: {
            criteria: [
              { id: "impact", name: "Impact", weight: 2 },
              { id: "execution", name: "Execution", weight: 1 },
            ],
            scale: 10,
          },
        }),
      ],
    });
    rubricKey = res.created[0]!;
    console.log(`rubric for ${JUDGE.track}  ${res.txHash}`);
  }
  let submissionKey = submission?.key;
  if (!submissionKey) {
    const teamW = writer(lead.keyEnv);
    const content = { page: { ...teamPages.populated.content } as never };
    const projectKey =
      project?.key ??
      (
        await teamW.write({
          creates: [
            buildCreate("project", ctx(JUDGE.team), { team: JUDGE.team, track: JUDGE.track, content }),
          ],
        })
      ).created[0]!;
    const res = await teamW.write({
      creates: [
        buildCreate("submission", ctx(JUDGE.team), {
          project: projectKey,
          team: JUDGE.team,
          track: JUDGE.track,
          lead: lead.address as Address,
          content,
        }),
      ],
    });
    submissionKey = res.created[0]!;
    console.log(`${JUDGE.team} submitted to ${JUDGE.track}  ${res.txHash}`);
  }
  if (!accepted) {
    const res = await org.write({
      creates: [
        buildCreate("acceptance", ctx("organizer"), { submission: submissionKey, track: JUDGE.track }),
      ],
    });
    console.log(`accepted ${JUDGE.team}  ${res.txHash}`);
  }
  if (!assigned) {
    if (!judgeReady) {
      console.log(`${judgeLabel} has no badge yet: issue it, then rerun to assign`);
      return;
    }
    const res = await org.write({
      creates: [
        buildCreate("judge_assignment", ctx("organizer"), {
          judge: judgeLabel,
          submission: submissionKey,
          rubric: rubricKey,
        }),
      ],
    });
    console.log(`assigned ${judgeLabel} to ${JUDGE.team}  ${res.txHash}`);
  }
}

main().catch((err: unknown) => {
  console.error(`i3-seed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
