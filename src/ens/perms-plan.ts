// A2.2-R2: make or unmake a volunteer lead by writing a binding-checked `lanyard.perms` envelope.
// The envelope names the badge's current registration ID and holder, so a reissued badge never
// inherits a stale note; unmaking writes an empty permission list for the current binding.
import type { Address, Hex } from "viem";
import { encodePermissionEnvelope, SHIFT_MANAGER } from "../shared/ens/permission-envelope";
import { normalizeLabel } from "../shared/labels";
import { ArgError, parseArgs } from "./cli-args";

export type PermsRequest = { label: string; make: boolean; fork: boolean; dryRun: boolean };

export const PERMS_USAGE = "usage: set-perms.ts --volunteer <label> (--make | --unmake) [--fork] [--dry-run]";

export function parsePermsArgs(argv: readonly string[]): PermsRequest {
  const { flags, values } = parseArgs(argv, {
    flags: ["--make", "--unmake", "--fork", "--dry-run"],
    values: ["--volunteer"],
  });
  const label = values.get("--volunteer");
  if (!label) throw new ArgError("--volunteer is required");
  try {
    normalizeLabel(label);
  } catch (e) {
    throw new ArgError((e as Error).message);
  }
  if (label.includes(".") || label === "") throw new ArgError("--volunteer is one label, e.g. priya");
  if (flags.has("--make") === flags.has("--unmake"))
    throw new ArgError("give exactly one of --make or --unmake");
  return { label, make: flags.has("--make"), fork: flags.has("--fork"), dryRun: flags.has("--dry-run") };
}

export type Binding = { registrationId: Hex | null; owner: Address | null };

export type PermsDecision =
  { action: "write" | "skip"; value: string } | { action: "blocked"; reason: string };

export function decidePerms(o: {
  binding: Binding;
  make: boolean;
  resolver: Address;
  staffResolver: Address;
  current: string | null;
}): PermsDecision {
  if (o.binding.registrationId === null || o.binding.owner === null)
    return { action: "blocked", reason: "the volunteer badge is not live (unregistered or expired)" };
  if (o.resolver.toLowerCase() !== o.staffResolver.toLowerCase())
    return { action: "blocked", reason: `badge resolver is ${o.resolver}, not the staff resolver` };
  const value = encodePermissionEnvelope({
    schemaVersion: 1,
    registrationId: o.binding.registrationId.toLowerCase() as Hex,
    holder: o.binding.owner.toLowerCase() as Address,
    permissions: o.make ? [SHIFT_MANAGER] : [],
  });
  return { action: o.current === value ? "skip" : "write", value };
}

/** After the receipt: the note only counts if the badge still has the binding it names. */
export function bindingChanged(before: Binding, after: Binding): boolean {
  return (
    before.registrationId?.toLowerCase() !== after.registrationId?.toLowerCase() ||
    before.owner?.toLowerCase() !== after.owner?.toLowerCase()
  );
}
