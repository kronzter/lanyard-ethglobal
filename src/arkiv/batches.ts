// Batch helpers for writes that belong together (B1.3-R3), under P0-S12's frozen
// shiftWriteProfile = confirmed-sequential.
//
// - Clock-in + duty pass for an existing shift is one executeBatch: one wallet approval.
// - Replacing an active shift is two confirmed steps: the replacement shift first (its key is
//   read from the confirmed receipt and persisted), then clock-in + pass referencing that key.
//   Between the two, the replacement is saved but inactive: "Replacement saved; clock-in pending".
//   Resuming runs only the missing step and never creates a second shift.
import type { Hex } from "@/shared/types/primitives";
import type { WriteQueue, SubmitResult } from "./queue";
import type { KeyValueStore } from "./store";
import { buildCreate, type WriteContext } from "./writers";

export const PENDING_CLOCK_IN = "Replacement saved; clock-in pending";

export type ClockInInput = { volunteer: string; shift: Hex; endsAt: bigint; statedAt?: bigint };

/** Clock a volunteer in and write their duty pass: one batch, one approval, keys in order. */
export function clockInWithPass(
  queue: WriteQueue,
  ctx: WriteContext,
  input: ClockInInput,
): Promise<SubmitResult> {
  return queue.submit(`Clock ${input.volunteer} in`, {
    creates: [
      buildCreate("clock", ctx, {
        volunteer: input.volunteer,
        shift: input.shift,
        action: "in",
        ...(input.statedAt !== undefined ? { statedAt: input.statedAt } : {}),
      }),
      buildCreate("duty_pass", ctx, { volunteer: input.volunteer, shift: input.shift, endsAt: input.endsAt }),
    ],
  });
}

export type ReplacementInput = {
  oldShift: Hex;
  volunteer: string;
  zone: string;
  startsAt: bigint;
  endsAt: bigint;
  /** Clock the volunteer into the replacement (an active-shift extension). */
  clockIn: boolean;
};

type ReplacementState = { status: "shift-confirmed" | "complete"; newShift: Hex };

export type ReplacementOutcome =
  | { status: "complete"; newShift: Hex; resumed: boolean }
  | { status: "pending-clock-in"; newShift: Hex; message: typeof PENDING_CLOCK_IN; cause?: SubmitResult }
  | { status: "not-started"; cause: SubmitResult };

const stateKey = (edition: string, oldShift: Hex) => `replace:${edition}:${oldShift.toLowerCase()}`;

/** Where an interrupted replacement stands, for the volunteer and lead screens after a restart. */
export async function replacementState(store: KeyValueStore, edition: string, oldShift: Hex) {
  const raw = await store.get(stateKey(edition, oldShift));
  return raw ? (JSON.parse(raw) as ReplacementState) : null;
}

export async function replaceShift(
  queue: WriteQueue,
  store: KeyValueStore,
  ctx: WriteContext,
  input: ReplacementInput,
): Promise<ReplacementOutcome> {
  const key = stateKey(ctx.edition, input.oldShift);
  let state = await replacementState(store, ctx.edition, input.oldShift);
  if (state?.status === "complete") return { status: "complete", newShift: state.newShift, resumed: true };
  const resumed = state !== null;

  if (!state) {
    const step1 = await queue.submit(`Replace ${input.volunteer}'s shift`, {
      creates: [
        buildCreate("shift", ctx, {
          volunteer: input.volunteer,
          zone: input.zone,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          supersedes: input.oldShift,
        }),
      ],
    });
    if (step1.status !== "verified" && step1.status !== "confirmed")
      return { status: "not-started", cause: step1 };
    state = { status: "shift-confirmed", newShift: step1.created[0]! };
    await store.set(key, JSON.stringify(state));
  }

  if (!input.clockIn) {
    await store.set(key, JSON.stringify({ ...state, status: "complete" }));
    return { status: "complete", newShift: state.newShift, resumed };
  }
  const step2 = await clockInWithPass(queue, ctx, {
    volunteer: input.volunteer,
    shift: state.newShift,
    endsAt: input.endsAt,
  });
  if (step2.status !== "verified" && step2.status !== "confirmed")
    return { status: "pending-clock-in", newShift: state.newShift, message: PENDING_CLOCK_IN, cause: step2 };
  await store.set(key, JSON.stringify({ ...state, status: "complete" }));
  return { status: "complete", newShift: state.newShift, resumed };
}
