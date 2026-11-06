// Writes fixtures/venue.mumbai.json from src/venue/layouts/mumbai.ts (pnpm venue:mumbai).
// src/venue/layouts/mumbai.test.ts fails when the committed file and the layout disagree.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { parseVenue } from "../src/shared/types/venue";
import { buildVenue } from "../src/venue/layout";
import { mumbaiLayout } from "../src/venue/layouts/mumbai";

const out = fileURLToPath(new URL("../fixtures/venue.mumbai.json", import.meta.url));
const venue = parseVenue(buildVenue(mumbaiLayout));
const options = (await prettier.resolveConfig(out)) ?? {};
writeFileSync(out, await prettier.format(JSON.stringify(venue), { ...options, filepath: out }));
console.log(
  `wrote ${out}: ${venue.grid.cols}×${venue.grid.rows}, ${venue.seats.length} seats, ${venue.pois.length} POIs`,
);
