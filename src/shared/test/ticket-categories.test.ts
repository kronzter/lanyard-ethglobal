import { describe, expect, it } from "vitest";
import { ticketCategories, ticketCategory } from "@/shared/config/tickets";
import { eventConfig } from "@/shared/event.config";

describe("ticket categories", () => {
  it("adds one partner-help category per configured partner, with no medical category", () => {
    const ids = ticketCategories(eventConfig).map((c) => c.id);
    expect(ids).toEqual([
      "wifi",
      "power",
      "hardware",
      "furniture",
      "food",
      "lost-item",
      "other",
      "partner:arkiv",
      "partner:ens",
    ]);
    expect(ticketCategory(eventConfig, "partner:ens")?.partner).toBe("ens");
    expect(ticketCategory(eventConfig, "medical")).toBeUndefined();
  });
});
