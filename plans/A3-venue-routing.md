# A3 · Venue grid and routing

**Track:** A · **Branch:** `phase/A3-venue-routing` · **Depends on:** A1–A2, P0 venue types · **Integration:** I3

## Goal

Turn the floor-plan image into a walkable grid, and give Track B a real `Router` that draws paths, finds the best next ticket, and orders a judge's walk.

We have the floor plan as an image and no QR stickers, so the venue is a **grid laid over the image**.

## Out of scope

Publishing the venue to Arkiv and writing seat assignments (Track B, wired in I3). Ticket logic (B3). This phase produces a `venue.json` file, a `Router` and the real `<VenueMap>`.

---

### A3.1 · Venue editor and `venue.json` export

**Editor** (`/venue/editor`, a **web-only** screen, organizer only):
- load the floor-plan image and set a cell size (about 1 m per cell);
- paint walkable cells with a brush (aisles, open floor); everything else is blocked;
- click to place **seats** (auto-numbered `S001…`) and **points of interest** (help desk, stage, partner tables; a `partner-table` POI carries its `partner` ID);
- paint **zones** (`hall-a`, `partner-row`), which tie to volunteer shifts.

**Requirements**
- **A3.1-R1** THE editor SHALL export a `venue.json` in the P0.2 `Venue` shape, with walkable cells run-length encoded.
- **A3.1-R2** WHEN a `venue.json` is exported and loaded back, THE walkable cells, seats, POIs and zones SHALL round-trip exactly.
- **A3.1-R3** WHEN a seat has no walkable cell within 3 cells, THE editor SHALL flag it and block export.
- **A3.1-R4** WHEN the export exceeds 120 KiB, THE editor SHALL warn (Arkiv's payload cap is 128 KiB).
- **A3.1-R5** WHEN seats are renumbered, THE editor SHALL keep existing seat IDs stable and only number new ones.
- **A3.1-R6** WHEN a zone has no `help-desk` POI, THE editor SHALL flag it and block export (helpers start there when they clock in).
- **A3.1-R7** WHEN a partner in `event.config.ts` has no `partner-table` POI with its `partner` ID, or a `partner-table` POI names an unknown partner, THE editor SHALL flag it and block export (partner staff start there, B3.2/B3.3).

**Tasks**
- [ ] Grid model and RLE codec with a round-trip property test
- [ ] Editor canvas: brush, seat tool, POI tool, zone tool, undo
- [ ] Validation panel (R3, R4, R6, R7)
- [ ] Draw the real venue: `fixtures/venue.mumbai.json` with ~60 seats, 3 zones (each with a help desk), 2 partner tables

**Commit:** `feat(venue): A3.1 venue editor and venue.json export`

---

### A3.2 · `GridRouter`

**Requirements**
- **A3.2-R1** THE `path` SHALL use A* in 8 directions with fixed integer costs (1,000 orthogonal, 1,414 diagonal), integer `cellSizeMm`, stable neighbor/tie ordering and no corner-cutting. Smooth for drawing only while preserving walkability; scoring uses unsmoothed costs. Follow `01-evidence-and-interfaces.md`.
- **A3.2-R2** A seat's or POI's cell SHALL be the nearest walkable cell to its point.
- **A3.2-R3** THE `distances` SHALL use one Dijkstra and return integer millimetres under the shared cost rules.
- **A3.2-R4** `nextTicket` SHALL accept caller-filtered tickets, explicit `atSeconds` and `alphaMmPerMinute`, returning the reachable lowest score (distance mm minus alpha × whole minutes waiting), ties by key. Reject future-created inputs; no clock or eligibility/network lookups inside the router.
- **A3.2-R5** `judgeRoute` SHALL accept `LocatedStop[]` from the caller, order nearest-next with key ties and visit each unique project once. Missing locations are caller-reported `unlocated` items; conflicting duplicate cells fail. Project-key strings alone are insufficient routing input.
- **A3.2-R6** THE `GridRouter` SHALL pass `runRouterConformance`.
- **A3.2-R7** WHEN a target is unreachable, THE router SHALL return `null` within 50 ms on the Mumbai venue, on a mid-range Android phone, and never hang.
- **A3.2-R8** THE `packages/venue` code SHALL be pure TypeScript with no Node-only imports, so it runs on Hermes.

**Commit:** `feat(venue): A3.2 GridRouter with a*, dijkstra and ticket scoring`

---

### A3.3 · Real `<VenueMap>`

**Requirements**
- **A3.3-R1** THE `<VenueMap>` SHALL keep the P0.5 props (`venue`, `highlight`, `path`, `onSeatTap`), so Track B's screens don't change.
- **A3.3-R2** THE `<VenueMap>` SHALL be built on `react-native-svg`, `react-native-gesture-handler` and `react-native-reanimated`, and SHALL work the same on Android and web.
- **A3.3-R3** WHEN the map is panned or pinch-zoomed, or the phone is rotated, THE `onSeatTap` SHALL still report the correct seat.
- **A3.3-R4** THE map SHALL draw the path, the helper's position, and highlighted seats or POIs with labels.

**Commit:** `feat(app): A3.3 VenueMap with pan, zoom and path drawing`

---

## Phase bug hunt

- [ ] A seat walled in on all sides: the editor flags it; the router returns `null` quickly
- [ ] A zone without a help desk: export is blocked
- [ ] A configured partner without a `partner-table` POI, or a POI naming an unknown partner: export is blocked
- [ ] A path never crosses a blocked cell or cuts a blocked corner (randomized maps, 1,000 runs)
- [ ] Start equals target: a path of length one, distance zero
- [ ] Two tickets with equal scores: the lowest key wins on every run
- [ ] α = 0 and a very large α both behave sensibly
- [ ] Located-stop duplicates visit once, conflicting locations fail, and missing locations are shown separately by the caller
- [ ] Explicit age/time and mm costs yield identical ticket/judge order on Hermes and Node; no hidden project lookup
- [ ] A very large floor plan (200×200 cells): `venue.json` stays under 128 KiB, or the editor warns
- [ ] Rotate the phone and zoom: seat taps land on the right cell, on Android and on web
- [ ] Re-export after adding one seat: old seat IDs are unchanged
- [ ] Opening `/venue/editor` on Android shows "Open on web"
- [ ] Set `EXPO_PUBLIC_LANYARD_ROUTER=grid` locally: B's stub-based screens still render (props unchanged)

## Phase done when

- [ ] A3.1–A3.3 marked done in `TRACKER.md`
- [ ] `GridRouter` passes conformance
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] Merged into `main`
