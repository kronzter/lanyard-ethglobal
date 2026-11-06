// The `lanyard.perms` text record (plans/01-evidence-and-interfaces.md §3).
//
// Its value is canonical JSON `{ schemaVersion: 1, registrationId, holder, permissions }` with a
// lowercase holder and sorted, unique permissions. A permission counts only when the envelope's
// registration ID and holder both match the badge at the action block, so a note left behind on
// a reissued badge grants nothing, while renewal of the same registration keeps it valid.
// Anything else (legacy comma lists, other formatting, unknown fields) grants nothing.
import { canonicalJson, parseJsonStrict } from "../canonical";
import { isAddress, isHex, type Address, type Hex } from "../types/primitives";

export const PERMS_TEXT_KEY = "lanyard.perms";
export const SHIFT_MANAGER = "shift-manager";

export type PermissionEnvelope = {
  schemaVersion: 1;
  registrationId: Hex;
  holder: Address;
  permissions: string[];
};

const PERMISSION = /^[a-z][a-z0-9-]*$/;
const lower = (s: string) => s === s.toLowerCase();

function check(e: PermissionEnvelope): void {
  if (e.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!isHex(e.registrationId, 32) || !lower(e.registrationId))
    throw new Error("registrationId must be lowercase 32-byte hex");
  if (!isAddress(e.holder) || !lower(e.holder)) throw new Error("holder must be a lowercase address");
  if (
    !Array.isArray(e.permissions) ||
    e.permissions.some((p) => typeof p !== "string" || !PERMISSION.test(p))
  ) {
    throw new Error("permissions must be lowercase [a-z0-9-] strings");
  }
  const sorted = [...new Set(e.permissions)].sort();
  if (sorted.length !== e.permissions.length || sorted.some((p, i) => p !== e.permissions[i])) {
    throw new Error("permissions must be sorted and unique");
  }
}

/** The exact text to store in `lanyard.perms`. Throws on a malformed envelope. */
export function encodePermissionEnvelope(e: PermissionEnvelope): string {
  check(e);
  return canonicalJson(e);
}

/** Parse a stored note; null unless it is exactly a canonical, well-formed envelope. */
export function parsePermissionEnvelope(text: string | null): PermissionEnvelope | null {
  if (text === null || text === "") return null;
  let value: unknown;
  try {
    value = parseJsonStrict(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "holder,permissions,registrationId,schemaVersion") return null;
  const e = value as PermissionEnvelope;
  try {
    check(e);
    return canonicalJson(e) === text ? e : null;
  } catch {
    return null;
  }
}

/**
 * True when the note grants `permission` to this exact registration and holder. Pass the badge's
 * `registrationId` and `owner` read at the action block; a null on either side grants nothing.
 */
export function grantsPermission(
  text: string | null,
  badge: { registrationId: Hex | null; owner: Address | null },
  permission: string,
): boolean {
  const e = parsePermissionEnvelope(text);
  if (!e || badge.registrationId === null || badge.owner === null) return false;
  return (
    e.registrationId === badge.registrationId.toLowerCase() &&
    e.holder === badge.owner.toLowerCase() &&
    e.permissions.includes(permission)
  );
}
