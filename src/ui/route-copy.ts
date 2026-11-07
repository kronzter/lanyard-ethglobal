// Display copy for each app route: tile icon, friendly title and a one-line purpose.
// Navigation and access stay in src/shell/routes.ts and src/shell/roles.ts.
import type { IconName } from "./Icon";

export type RouteCopy = { icon: IconName; title: string; body: string };

export const ROUTE_COPY: Record<string, RouteCopy> = {
  "/volunteer": { icon: "clock", title: "My shift", body: "Your duty status, countdown and next shift" },
  "/lead": { icon: "users", title: "Lead console", body: "Clock volunteers in and manage shifts" },
  "/tickets": { icon: "ticket", title: "Help tickets", body: "Raise a ticket or answer the next one" },
  "/judge": { icon: "gavel", title: "Judging route", body: "Walk your stops and seal your scores" },
  "/team": { icon: "star", title: "My project", body: "Edit your project and seal the submission" },
  "/organizer": { icon: "badge", title: "Organizer desk", body: "Onboarding, venue, judging and records" },
  "/organizer/judging": {
    icon: "gavel",
    title: "Judging desk",
    body: "Rubrics, acceptance and judge assignments",
  },
  "/organizer/leaderboard": {
    icon: "trophy",
    title: "Judging progress",
    body: "Completion now, rankings after freeze",
  },
  "/organizer/faucet": { icon: "drop", title: "Desk faucet", body: "First-time tGLM for Arkiv gas" },
  "/organizer/records": {
    icon: "list",
    title: "Records & verdicts",
    body: "What counts, and why the rest doesn't",
  },
  "/organizer/seats": { icon: "map", title: "Venue & seats", body: "Publish the venue and import seats" },
  "/admin/ens": { icon: "shield", title: "ENS consoles", body: "Badges, leads, judges and permissions" },
  "/venue": { icon: "map", title: "Venue", body: "Floor plan, seats and help desks" },
};

export const routeCopy = (path: string): RouteCopy =>
  ROUTE_COPY[path] ?? { icon: "chevron", title: path, body: "" };
