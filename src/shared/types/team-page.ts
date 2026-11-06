// Public team pages (plans/01-evidence-and-interfaces.md §3a, P0-foundation.md › P0.2-R6).
// Every registered team has a page at `publicAppOrigin + '/teams/' + teamLabel`; the team's
// ENS `url` text record points there. The ETHGlobal showcase is a button on the page, never
// the ENS website target. Descriptions render as text, never HTML.
import { z } from "zod";
import { isTeamLabel } from "../labels";
import { isAppOrigin, parseWebUrl, utf8Length } from "../url";
import type { Label } from "./primitives";

export const ETHGLOBAL_HOSTS = ["ethglobal.com", "www.ethglobal.com"] as const;
export const TEAM_PAGE_LIMITS = {
  title: 120,
  description: 4000,
  members: 4,
  memberName: 80,
  urlBytes: 2048,
} as const;

export type TeamPageLinks = { ethglobal?: string; repository?: string; demo?: string; video?: string };
export type TeamPageContent = { title: string; description: string; members: string[]; links: TeamPageLinks };

export class TeamPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamPageError";
  }
}

const chars = (s: string) => [...s].length;

/** An absolute https URL, no credentials, at most 2,048 UTF-8 bytes. Rejects script/data URLs by construction. */
export function isSafeLink(url: string): boolean {
  if (utf8Length(url) > TEAM_PAGE_LIMITS.urlBytes) return false;
  const u = parseWebUrl(url);
  return u !== null && u.scheme === "https";
}

export const isEthglobalLink = (url: string): boolean => {
  const u = parseWebUrl(url);
  return (
    isSafeLink(url) &&
    u !== null &&
    u.port === null &&
    (ETHGLOBAL_HOSTS as readonly string[]).includes(u.host)
  );
};

const link = z
  .string()
  .refine(isSafeLink, "links must be absolute https URLs without credentials, ≤ 2048 bytes");

export const TeamPageContentSchema = z
  .object({
    title: z
      .string()
      .refine(
        (s) => chars(s.trim()) >= 1 && chars(s) <= TEAM_PAGE_LIMITS.title,
        "title must be 1–120 characters",
      ),
    description: z
      .string()
      .refine((s) => chars(s) <= TEAM_PAGE_LIMITS.description, "description is at most 4,000 characters"),
    members: z
      .array(
        z
          .string()
          .refine(
            (s) => chars(s.trim()) >= 1 && chars(s) <= TEAM_PAGE_LIMITS.memberName,
            "member names are 1–80 characters",
          ),
      )
      .max(TEAM_PAGE_LIMITS.members, "at most four members"),
    links: z
      .object({
        ethglobal: link
          .refine(isEthglobalLink, "the ETHGlobal link must be on ethglobal.com or www.ethglobal.com")
          .optional(),
        repository: link.optional(),
        demo: link.optional(),
        video: link.optional(),
      })
      .strict(),
  })
  .strict();

export function validateTeamPageContent(value: unknown): TeamPageContent {
  const r = TeamPageContentSchema.safeParse(value);
  if (!r.success)
    throw new TeamPageError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

/** Sealing a submission requires the ETHGlobal showcase link; drafts and registration do not. */
export function requireEthglobalForSeal(content: TeamPageContent): TeamPageContent {
  if (content.links.ethglobal === undefined)
    throw new TeamPageError("an ETHGlobal showcase link is required to seal a submission");
  return content;
}

/** The deterministic public page URL written to the team's ENS `url` record. */
export function teamPageUrl(teamLabel: Label, publicAppOrigin: string): string {
  if (!isTeamLabel(teamLabel)) throw new TeamPageError(`${JSON.stringify(teamLabel)} is not a team label`);
  if (!isAppOrigin(publicAppOrigin, { allowLocalhost: true })) {
    throw new TeamPageError(`${JSON.stringify(publicAppOrigin)} is not an app origin`);
  }
  return `${publicAppOrigin}/teams/${teamLabel}`;
}

/**
 * What the public page shows. Loading, awaiting submission, unknown team and unavailable
 * evidence are distinct: an error must never look like an empty team.
 */
export type TeamPageState =
  | { status: "loading"; team: Label }
  | { status: "awaiting-submission"; team: Label }
  | {
      status: "published";
      team: Label;
      track: string;
      content: TeamPageContent;
      winner: { prizes: string[] } | null;
    }
  | { status: "unknown-team"; team: Label }
  | { status: "unavailable"; team: Label; reason: string };

const teamLabel = z.string().refine(isTeamLabel, "expected a team label");
export const TeamPageStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("loading"), team: teamLabel }).strict(),
  z.object({ status: z.literal("awaiting-submission"), team: teamLabel }).strict(),
  z
    .object({
      status: z.literal("published"),
      team: teamLabel,
      track: z.string().min(1),
      content: TeamPageContentSchema,
      winner: z
        .object({ prizes: z.array(z.string().min(1)).min(1) })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ status: z.literal("unknown-team"), team: teamLabel }).strict(),
  z.object({ status: z.literal("unavailable"), team: teamLabel, reason: z.string().min(1) }).strict(),
]);
