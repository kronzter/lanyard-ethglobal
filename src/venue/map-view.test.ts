import { describe, expect, it } from "vitest";
import mumbaiJson from "../../fixtures/venue.mumbai.json";
import { fixtureVenue } from "@/shared/mocks/fixtures";
import { parseVenue } from "@/shared/types/venue";
import { cellCenterPx } from "./map-geometry";
import {
  IDENTITY,
  MAX_SCALE,
  type Size,
  type ViewTransform,
  clampPan,
  fitImage,
  imageToScreen,
  screenToImage,
  seatAt,
  zoomAbout,
} from "./map-view";

const mumbai = parseVenue(mumbaiJson);
const small = fixtureVenue();
const img = (v: typeof mumbai): Size => ({ width: v.image.widthPx, height: v.image.heightPx });

// A phone held upright, the same phone rotated, and a desktop browser window.
const LAYOUTS: Size[] = [
  { width: 390, height: 720 },
  { width: 720, height: 390 },
  { width: 1280, height: 800 },
];
const TRANSFORMS: ViewTransform[] = [
  IDENTITY,
  { scale: 2.5, tx: -140, ty: 60 },
  { scale: MAX_SCALE, tx: 900, ty: -700 },
];

describe("fitImage", () => {
  it("fits the whole image and centres it", () => {
    const view = { width: 390, height: 720 };
    const { fit, padX, padY } = fitImage(view, img(mumbai));
    expect(img(mumbai).width * fit).toBeCloseTo(390);
    expect(padX).toBeCloseTo(0);
    expect(padY * 2 + img(mumbai).height * fit).toBeCloseTo(720);
  });
});

describe("screen ↔ image", () => {
  it("are inverses for any layout and transform", () => {
    for (const view of LAYOUTS)
      for (const t of TRANSFORMS) {
        const p = { x: 123.4, y: 567.8 };
        const back = screenToImage(imageToScreen(p, view, img(mumbai), t), view, img(mumbai), t);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
  });

  it("a tap on every Mumbai seat reports that seat, upright, rotated and zoomed (A3.3-R3)", () => {
    for (const view of LAYOUTS)
      for (const t of TRANSFORMS) {
        const wrong = mumbai.seats.filter((s) => {
          const tap = imageToScreen(cellCenterPx(mumbai, s.cell), view, img(mumbai), t);
          return seatAt(mumbai, screenToImage(tap, view, img(mumbai), t)) !== s.id;
        });
        expect(wrong.map((s) => s.id)).toEqual([]);
      }
  });

  it("a slightly-off tap still picks the nearest seat on the small venue", () => {
    const view = LAYOUTS[0]!;
    const t = TRANSFORMS[1]!;
    for (const s of small.seats) {
      const c = cellCenterPx(small, s.cell);
      const off = { x: c.x + small.grid.cellSizePx * 0.3, y: c.y - small.grid.cellSizePx * 0.2 };
      const tap = imageToScreen(off, view, img(small), t);
      expect(seatAt(small, screenToImage(tap, view, img(small), t))).toBe(s.id);
    }
  });

  it("a tap on floor away from any seat reports nothing", () => {
    // The small venue's stage POI cell has no seat within reach.
    const stage = small.pois.find((p) => p.id === "stage")!;
    expect(seatAt(small, cellCenterPx(small, stage.cell))).toBeNull();
  });
});

describe("zoomAbout", () => {
  it("keeps the map point under the fingers fixed", () => {
    const view = LAYOUTS[0]!;
    const focal = { x: 200, y: 300 };
    const before = screenToImage(focal, view, img(mumbai), IDENTITY);
    const t = zoomAbout(IDENTITY, focal, 3, view);
    const after = screenToImage(focal, view, img(mumbai), t);
    expect(t.scale).toBe(3);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps the scale and the pan", () => {
    const view = LAYOUTS[0]!;
    expect(zoomAbout(IDENTITY, { x: 0, y: 0 }, 100, view).scale).toBe(MAX_SCALE);
    expect(zoomAbout(IDENTITY, { x: 0, y: 0 }, 0.1, view).scale).toBe(1);
    expect(clampPan({ scale: 1, tx: 1e6, ty: -1e6 }, view)).toEqual({ scale: 1, tx: 195, ty: -360 });
  });
});
