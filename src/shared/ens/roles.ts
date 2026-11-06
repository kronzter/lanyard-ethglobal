// What a label's position in the namespace means. Shared by every IdentityDirectory so the mock
// and A2's real directory name roles identically. Leads are volunteers whose lanyard.perms note
// grants shift-manager; that is a permission check, not a label role.
import { BOOKS } from "../labels";
import type { Label } from "../types/primitives";

export type LabelRole =
  | "edition-owner"
  | `book-owner:${string}`
  | "team-lead"
  | `team-member:${string}`
  | `winner:${string}`
  | "hacker"
  | "volunteer"
  | "global-judge"
  | `partner:${string}`
  | `partner-sub-book-owner:${string}`
  | `partner-judge:${string}`
  | `partner-staff:${string}`
  | "unknown";

export function roleOfLabel(label: Label): LabelRole {
  if (label === "") return "edition-owner";
  const s = label.split(".");
  const [first, second, third, fourth] = s;
  switch (s.length) {
    case 1:
      return (BOOKS as readonly string[]).includes(first!) ? `book-owner:${first}` : "team-lead";
    case 2:
      if (second === "hackers") return "hacker";
      if (second === "volunteers") return "volunteer";
      if (second === "judges") return "global-judge";
      if (second === "partners") return `partner:${first}`;
      if ((BOOKS as readonly string[]).includes(second!)) return "unknown";
      return first === "winner" ? `winner:${second}` : `team-member:${second}`;
    case 3:
      return third === "partners" && (first === "judges" || first === "staff")
        ? `partner-sub-book-owner:${first}.${second}`
        : "unknown";
    case 4:
      if (fourth === "partners" && second === "judges") return `partner-judge:${third}`;
      if (fourth === "partners" && second === "staff") return `partner-staff:${third}`;
      return "unknown";
    default:
      return "unknown";
  }
}
