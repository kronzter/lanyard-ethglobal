// Relative labels ↔ full ENS names (plans/P0-foundation.md › P0.2-R4).
//
// Labels in code are relative to the edition: `priya.volunteers`, `zkpay`,
// `ana.judges.arkiv.partners`. The empty label `""` denotes the edition itself
// (plans/01-evidence-and-interfaces.md §3), and is the only empty-label exception.
//
// Policy: ENSIP-15 normalization first, then Lanyard's stricter canonical policy.
// The input must already equal its normalized form (so `Judges` and `judges ` are
// rejected rather than silently fixed), and every segment must be `[a-z0-9]` with
// inner hyphens only. ENSIP-15 allows many emoji; this application does not.
import { ens_normalize } from "@adraffy/ens-normalize";
import type { Label } from "./types/primitives";

export class LabelError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`invalid label ${JSON.stringify(input)}: ${reason}`);
    this.name = "LabelError";
  }
}

const SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The book names under the edition, plus the reserved winner label. */
export const BOOKS = ["hackers", "judges", "volunteers", "partners"] as const;
export type Book = (typeof BOOKS)[number];
export const RESERVED_LABELS: readonly string[] = [...BOOKS, "winner"];

export type Names = { edition: string; baseName: string };

/** Return `label` if it is canonical; throw {@link LabelError} otherwise. */
export function normalizeLabel(label: string): Label {
  if (label === "") return "";
  let normalized: string;
  try {
    normalized = ens_normalize(label);
  } catch (e) {
    throw new LabelError(label, `ENSIP-15: ${(e as Error).message}`);
  }
  if (normalized !== label)
    throw new LabelError(label, `not canonical (normalizes to ${JSON.stringify(normalized)})`);
  for (const segment of label.split(".")) {
    if (!SEGMENT.test(segment)) {
      throw new LabelError(label, `segment ${JSON.stringify(segment)} must be [a-z0-9] with inner hyphens`);
    }
  }
  return label;
}

export function isCanonicalLabel(label: string): boolean {
  try {
    normalizeLabel(label);
    return true;
  } catch {
    return false;
  }
}

/** The edition's own full name, e.g. `mumbai2026.lanyard.eth`. */
export const editionName = (names: Names): string => `${normalizeLabel(names.edition)}.${names.baseName}`;

/** `priya.volunteers` → `priya.volunteers.mumbai2026.lanyard.eth`; `""` → the edition name. */
export function toFullName(label: Label, names: Names): string {
  const edition = editionName(names);
  const canonical = normalizeLabel(label);
  return canonical === "" ? edition : `${canonical}.${edition}`;
}

/** `priya.volunteers.mumbai2026.lanyard.eth` → `priya.volunteers`; the edition name → `""`. */
export function toRelativeLabel(fullName: string, names: Names): Label {
  const edition = editionName(names);
  if (fullName === edition) return "";
  const suffix = `.${edition}`;
  if (!fullName.endsWith(suffix)) throw new LabelError(fullName, `not under ${edition}`);
  return normalizeLabel(fullName.slice(0, -suffix.length));
}

/** A team label: one canonical segment that is not a book or a reserved name. */
export function isTeamLabel(label: string): boolean {
  return isCanonicalLabel(label) && label !== "" && !label.includes(".") && !RESERVED_LABELS.includes(label);
}
