// Pan/zoom math for the real <VenueMap> (A3.3-R3). The map's content view fills its container
// (W × H) and draws the floor-plan image fitted inside it ("meet"). The user's pan and zoom is one
// transform, applied as RN `[translateX, translateY, scale]`, which scales about the view centre:
//
//   screen = centre + t + scale · (local − centre),   local = pad + image · fit
//
// Taps are mapped back through the inverse, so a tap reports the right seat after any pan, zoom or
// rotation (rotation only changes W × H). Functions are worklets so gestures can run them on the UI
// thread; in Node the directive is a plain string.
import type { Venue } from "@/shared/types/venue";
import type { Point } from "./map-geometry";

export type Size = { width: number; height: number };
export type ViewTransform = { scale: number; tx: number; ty: number };

export const IDENTITY: ViewTransform = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

/** How the image sits in the unzoomed view: uniform fit plus centring padding. */
export function fitImage(view: Size, image: Size) {
  "worklet";
  const fit = Math.min(view.width / image.width, view.height / image.height);
  return { fit, padX: (view.width - image.width * fit) / 2, padY: (view.height - image.height * fit) / 2 };
}

export function imageToScreen(p: Point, view: Size, image: Size, t: ViewTransform): Point {
  "worklet";
  const { fit, padX, padY } = fitImage(view, image);
  const cx = view.width / 2;
  const cy = view.height / 2;
  return {
    x: cx + t.tx + t.scale * (padX + p.x * fit - cx),
    y: cy + t.ty + t.scale * (padY + p.y * fit - cy),
  };
}

export function screenToImage(p: Point, view: Size, image: Size, t: ViewTransform): Point {
  "worklet";
  const { fit, padX, padY } = fitImage(view, image);
  const cx = view.width / 2;
  const cy = view.height / 2;
  return {
    x: ((p.x - cx - t.tx) / t.scale + cx - padX) / fit,
    y: ((p.y - cy - t.ty) / t.scale + cy - padY) / fit,
  };
}

/** Keeps at least half the view covered by the map, so it can't be flung off-screen. */
export function clampPan(t: ViewTransform, view: Size): ViewTransform {
  "worklet";
  const maxX = (view.width * t.scale) / 2;
  const maxY = (view.height * t.scale) / 2;
  return {
    scale: t.scale,
    tx: Math.max(-maxX, Math.min(maxX, t.tx)),
    ty: Math.max(-maxY, Math.min(maxY, t.ty)),
  };
}

/** Zooms to `scale` (clamped) keeping the screen point `focal` over the same spot of the map. */
export function zoomAbout(t: ViewTransform, focal: Point, scale: number, view: Size): ViewTransform {
  "worklet";
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const cx = view.width / 2;
  const cy = view.height / 2;
  const k = s / t.scale;
  return clampPan(
    { scale: s, tx: focal.x - cx - k * (focal.x - cx - t.tx), ty: focal.y - cy - k * (focal.y - cy - t.ty) },
    view,
  );
}

/**
 * The seat whose centre is nearest an image point, if it is within `reach` image pixels (default
 * 0.75 cell, so a tap between two neighbouring seats still picks the closer one).
 */
export function seatAt(venue: Venue, p: Point, reach = venue.grid.cellSizePx * 0.75): string | null {
  const { originPx, cellSizePx } = venue.grid;
  let best: string | null = null;
  let bestD = reach * reach;
  for (const s of venue.seats) {
    const dx = originPx.x + (s.cell.x + 0.5) * cellSizePx - p.x;
    const dy = originPx.y + (s.cell.y + 0.5) * cellSizePx - p.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}
