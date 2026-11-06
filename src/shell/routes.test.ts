import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, blocksOnPlatform, routeInfo } from "./routes";

const root = path.resolve(import.meta.dirname, "../..");

describe("route registry", () => {
  it("has a screen in app/ for every route", () => {
    for (const r of ROUTES)
      expect(
        existsSync(path.join(root, "app", r.path, "index.tsx")) ||
          existsSync(path.join(root, "app", r.path + ".tsx")),
        r.path,
      ).toBe(true);
  });

  it("wraps every web-only route folder in the WebOnly layout", () => {
    for (const r of ROUTES.filter((x) => x.webOnly)) {
      const segments = r.path.split("/").filter(Boolean);
      expect(
        segments.some((_, i) =>
          existsSync(path.join(root, "app", ...segments.slice(0, i + 1), "_layout.tsx")),
        ),
        r.path,
      ).toBe(true);
    }
  });

  it("marks organizer, ENS consoles and venue editor as web-only, field screens as not", () => {
    expect(ROUTES.filter((r) => r.webOnly).map((r) => r.path)).toEqual([
      "/organizer/judging",
      "/organizer",
      "/admin/ens",
      "/venue",
    ]);
    expect(routeInfo("/volunteer").webOnly).toBe(false);
  });

  it("shows Open on web on Android but renders on web", () => {
    expect(blocksOnPlatform(routeInfo("/organizer"), "android")).toBe(true);
    expect(blocksOnPlatform(routeInfo("/organizer"), "ios")).toBe(true);
    expect(blocksOnPlatform(routeInfo("/organizer"), "web")).toBe(false);
    expect(blocksOnPlatform(routeInfo("/tickets"), "android")).toBe(false);
  });
});
