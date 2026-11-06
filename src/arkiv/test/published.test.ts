import { expect, it } from "vitest";
import { publishedBundle } from "../published";
import { eventConfig } from "@/shared/event.config";
import { createFixtureEnsReader } from "@/shared/mocks/fixtures";
it("does not expose a committed bundle before atomic publication lock", async () => {
  const ens = createFixtureEnsReader();
  ens.text = async (_label, key) => (key === "lanyard.bundle-hash" ? `0x${"11".repeat(32)}` : null);
  let fetched = false;
  expect(
    await publishedBundle(eventConfig, ens, async () => {
      fetched = true;
      throw new Error("must not fetch before lock");
    }),
  ).toBeNull();
  expect(fetched).toBe(false);
});
