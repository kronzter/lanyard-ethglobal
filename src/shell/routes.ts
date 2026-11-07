// Route registry for the shell: which folder each route lives in, who owns it, which phase
// fills it, and whether it is a web-only screen (plans/00-README.md › The app, P0.5-R1/R7).

export type RouteInfo = {
  path: string;
  title: string;
  owner: "A" | "B";
  phase: string;
  webOnly: boolean;
  audience: string;
};

export const ROUTES: readonly RouteInfo[] = [
  {
    path: "/organizer/judging",
    title: "Judging desk",
    owner: "B",
    phase: "B4.1",
    webOnly: true,
    audience: "organizer, head judge and partners",
  },
  {
    path: "/volunteer",
    title: "Volunteer",
    owner: "B",
    phase: "B3.1",
    webOnly: false,
    audience: "volunteers",
  },
  { path: "/lead", title: "Lead", owner: "B", phase: "B3.1", webOnly: false, audience: "volunteer leads" },
  {
    path: "/tickets",
    title: "Help tickets",
    owner: "B",
    phase: "B3.2",
    webOnly: false,
    audience: "hackers and helpers",
  },
  { path: "/judge", title: "Judge", owner: "B", phase: "B4.2", webOnly: false, audience: "judges" },
  { path: "/team", title: "Team", owner: "B", phase: "B4.1", webOnly: false, audience: "team leads" },
  {
    path: "/organizer",
    title: "Organizer",
    owner: "B",
    phase: "B1.1–B4.4",
    webOnly: true,
    audience: "the organizer",
  },
  {
    path: "/admin/ens",
    title: "ENS consoles",
    owner: "A",
    phase: "A4.3",
    webOnly: true,
    audience: "staff wallets",
  },
  {
    path: "/venue",
    title: "Venue editor",
    owner: "A",
    phase: "A3.1",
    webOnly: true,
    audience: "the organizer",
  },
];

/** True when a screen must show "Open on web" instead of rendering on this platform. */
export const blocksOnPlatform = (route: Pick<RouteInfo, "webOnly">, platformOS: string): boolean =>
  route.webOnly && platformOS !== "web";

export const routeInfo = (path: string): RouteInfo => {
  const r = ROUTES.find((x) => x.path === path);
  if (!r) throw new Error(`unknown route ${path}`);
  return r;
};
