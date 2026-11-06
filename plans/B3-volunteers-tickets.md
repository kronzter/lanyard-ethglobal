# B3 · Volunteers and help tickets

**Track:** B · **Branch:** `phase/B3-volunteers-tickets` · **Depends on:** B1–B2, P0 `StubRouter` + `venue.small.json` · **Integration:** I3

## Goal

Volunteers work only while on duty, and any authorised lead can start, extend or end a shift. Hackers raise help tickets from their seat; the best on-duty helper gets one, walks there, resolves it, and is offered the best next ticket from where they now stand.

Built against `StubRouter` and the small fixture venue. The real grid router and the Mumbai venue arrive at I3. The volunteer, lead and ticket screens are phone screens; the organizer screens are web-only.

## Out of scope

Making someone a lead (an ENS write: the A4.3 coordinator console; seeds use A2.2's script through fixtures). The venue editor (A3.1).

## How on-duty works

- **Badge (ENS):** `priya.volunteers.mumbai2026.lanyard.eth`, valid for the whole event.
- **Lead (ENS):** a volunteer whose canonical `lanyard.perms` envelope grants `shift-manager` and matches the badge's current registration ID and holder. There can be several leads at once; a stale note from an earlier registration grants nothing.
- **Shift (Arkiv):** a lead writes `shift {volunteer, zone, starts_at, ends_at}`. Changes are new shifts with `supersedes`.
- **Clock (Arkiv):** `clock {volunteer, shift, action}`, written by a lead, or a self `in` within 60 minutes before that shift starts. Effective action time is creation block time; `stated_at` is display only.
- **Duty pass (Arkiv):** lead-written display evidence with a logical `ends_at` equal to shift end, physically retained until event end + 7 d. Self clock-ins derive the same countdown from the shift; no lead-owned pass is forged by the volunteer. Retention extension cannot extend duty.

**On duty at T** = badge valid at T **and** at least one valid current shift covering T whose latest valid clock action for that exact shift before or at T is `in`. A scheduled shift alone does not activate duty. A clock-in before shift start is accepted only in the self-start window but does not activate duty until the start. An unmatched clock-out is ignored; each session ends at shift end even without a clock-out. For a zone query, only covering sessions in that zone count. Order equal-time clocks by creation block then key and apply in that order.

A `supersedes` replacement must reference an earlier shift for the same volunteer and takes effect no earlier than its own creation timestamp. It never changes past duty or validates backdated actions. For competing replacements of one shift, choose the latest created block, then lowest key; reject cycles and cross-volunteer references. P0-S12's `linked-create` profile creates replacement, clock-in and pass in one batch. Under `confirmed-sequential`, confirmation of the replacement closes the old session prospectively; the new shift stays inactive until the second clock/pass transaction lands. Show "Replacement saved; clock-in pending" during that interval, including after restart. Other independently covering sessions still count. End/shorten a session with an explicit clock-out; extending retention is not a shift extension.

---

### B3.1 · On-duty rules, shifts and clocks

**Requirements**
- **B3.1-R1** THE rules SHALL register these kinds using explicit evaluation/action context and `EnsReader.owner`. A lead needs a volunteer badge and a valid `shift-manager` note bound to that registration ID and holder at creation. Stale, malformed and legacy comma-list notes grant nothing. A self clock is `in`, references that volunteer's valid shift and occurs in `[starts_at-3600, starts_at]`, with no open session for that shift. A lead may clock in during a covering shift; no action can make duty effective before creation.
- **B3.1-R2** THE rules SHALL export `onDuty(volunteer, at, zone?)`.
- **B3.1-R3** WHEN a lead clocks a volunteer in, THE app SHALL write `clock in` and a new `duty_pass` in one batch (one wallet approval).
- **B3.1-R4** WHEN a volunteer taps "Start shift" within 60 min before a shift, THE app SHALL write a self `clock in`. Outside that window, it SHALL show "Ask a lead".
- **B3.1-R5** An active shift extension SHALL follow the selected B1/P0-S12 profile: one linked batch only with proven prediction/custody, otherwise a confirmed replacement followed by the clock/pass batch. The UI SHALL explain two approvals and the inactive interval before starting the sequential flow. Persist the replacement key and resume only the missing step after reconciliation; rejected or uncertain second writes never activate the replacement. Historical rows stay visible, supersession acts prospectively.
- **B3.1-R6** WHEN a lead enters a late clock-in with a stated time, THE app SHALL show both the stated time and the real block time.
- **B3.1-R7** THE volunteer screen SHALL show status/countdown from the valid bounded session and its shift end, with a matching lead pass when present. Self-started sessions show the same deadline without a fabricated pass; sync the displayed time to observed block time.

**Screens:** `/volunteer` (status, countdown, zone, next shift, Start shift) · `/lead` (volunteers by zone with status, clock in/out, extend, write shift).

**Tasks**
- [ ] Shift, clock and duty-pass rules; `onDuty` as the union of overlapping shifts
- [ ] Volunteer and lead screens
- [ ] Seed four leads, ten volunteers, two zones

**Commit:** `feat(rules): B3.1 on-duty rules with volunteer and lead screens`

---

### B3.2 · Help tickets

**Categories:** Wi-Fi, power, hardware, furniture, food, lost item, other → on-duty volunteers in that zone. **Medical or safety: not a ticket.** The app shows the staff phone number and the help-desk location instead.

**Flow**
1. **Raise.** The hacker writes readonly `ticket {seat, category}`. Logical close is creation time + 4 h; physical retention is event end + 7 d.
2. **See.** The caller filters eligibility, maps seats to cells and supplies explicit chain-derived time to `router.nextTicket`. General helpers start at their zone help desk; partner staff start at their partner-table POI (or its configured help-desk fallback). Position is an application estimate, not live tracking.
3. **Claim.** The helper writes readonly `ticket_claim {ticket}`, retained through event end + 7 d. The earliest eligible claim starts a 15 min logical lease; equal-block ties use lowest key. Claims created during that winning lease are losers permanently, not queued future winners. After its deadline, only a newly created claim can start the next attempt. Losers get a derived next offer after receipt/reconciliation.
4. **Walk.** `router.path` from the helper's position to the seat.
5. **Resolve.** The winning helper writes readonly `ticket_resolution {ticket, claim, seat}` before both lease and ticket close. The hacker confirms with a separate readonly `ticket_confirmation {ticket, resolution}`; no mutable status changes history. A valid resolution closes the ticket even after that claim's logical lease ends.
6. **Next.** The resolved seat becomes the helper's position; offer `router.nextTicket` from there.
7. **Reopen.** A lease ending without a timely valid resolution leaves an otherwise live ticket open. Missing known claim/resolution evidence is `unverifiable`, never automatic proof of no resolution. Deletion before observation is a disclosed limitation of current/captured state.

**Score:** integer walking millimetres minus `5_000 × floor(minutes waiting)`, using the router's explicit `atSeconds`. Lowest wins; this is equivalent to a 5 m/min waiting discount without float-dependent ordering.

**Requirements**
- **B3.2-R1** THE rules SHALL register tickets, claims, resolutions and confirmations. At any evaluation time, the earliest three otherwise-valid open tickets per hacker count; later extras are ignored until capacity frees. General claim/resolution creators must be on duty in the ticket zone at each action time; resolutions must belong to the exact winning claim. Confirmations require the ticket's hacker creator. Partner eligibility follows B3.3 instead of the shift requirement.
- **B3.2-R2** WHEN two helpers claim one ticket, THE rules SHALL award it to the earliest claim by block, ties broken by lowest key, identically on every device.
- **B3.2-R3** Logical leases use half-open `[createdAt, createdAt+900)` intervals, and tickets use `[createdAt, createdAt+14400)`. Physical retention/extension never changes those boundaries. Reopening follows the attempt model above.
- **B3.2-R4** WHEN a helper resolves a ticket, THE app SHALL offer the router's next ticket and draw the path to it.
- **B3.2-R5** THE ticket form SHALL never ask for personal or medical details, and SHALL say so.
- **B3.2-R6** THE screens SHALL use only the `Router` interface and the `<VenueMap>` props, never a concrete router.
- **B3.2-R7** WHEN a helper clocks in, THE app SHALL set their position to their zone's `help-desk` POI.

**Commit:** `feat(rules): B3.2 help tickets with claim race and next-ticket offers`

---

### B3.3 · Seats and partner tickets

**Requirements**
- **B3.3-R1** THE organizer screen (web-only) SHALL write readonly `seat_assignment {hacker, seat}` records from a CSV, signed by the organizer's wallet, with seat IDs taken from the current venue.
- **B3.3-R2** WHEN a hacker raises a ticket, THE form SHALL prefill their assigned seat and allow overriding it by tapping the map.
- **B3.3-R3** Partner categories require the same partner's staff badge ownership/expiry at both claim and resolution time. Staff need no shifts; judges/general volunteers cannot substitute. Initial position comes from the partner POI/fallback. Category IDs come from config, not free-text parsing.
- **B3.3-R4** THE organizer screen SHALL publish a `venue.json` file as a readonly `venue` record (used at I3 with the real venue).
- **B3.3-R5** THE partner-help categories SHALL be generated from the `event.config.ts` partner list.
- **B3.3-R6** Venue and seat assignment records SHALL include a venue key/version. At evaluation, choose the latest valid venue and latest assignment per hacker at or before that time, ties by lowest key. Tickets bind their creation venue/seat; later remapping never silently moves an existing ticket. Validate missing zones/seats/partner POIs before publication.

**Commit:** `feat(rules): B3.3 seat assignments, venue publish and partner tickets`

---

## Phase bug hunt

- [ ] A volunteer clocks themselves in 61 minutes early: rejected
- [ ] A non-lead clocks someone else in: rejected
- [ ] Two leads clock the same volunteer in within one block: one "on duty", no errors
- [ ] `clock out` with no prior `clock in`: harmless, ignored
- [ ] Overlapping shifts: on-duty is the union, no crash
- [ ] A lead's note removed at block N: their clock-ins before N count, those after N don't (mock history)
- [ ] Unregister/reissue a lead badge without rewriting its note: the new holder cannot write shifts/clocks until a fresh registration-bound grant
- [ ] Sequential replacement interrupted after shift confirmation: old session closes, new one is pending, and resume creates no duplicate shift; linked profile has no such inter-transaction gap
- [ ] A volunteer's badge revoked while on duty: their later claims are rejected
- [ ] Phone clock set wrong: no effect, block time is used
- [ ] Two helpers claim within the same block, on two Android phones: one winner on both
- [ ] A claim left unresolved for 15 min: the ticket reopens
- [ ] An off-duty volunteer claims: ignored
- [ ] A general volunteer claims a partner ticket: ignored
- [ ] A partner judge (not staff) claims a partner ticket: ignored
- [ ] A hacker raises 5 tickets: only 3 count
- [ ] A ticket from a seat in another zone: that zone's volunteers see it
- [ ] A helper who just clocked in sees tickets ordered from their zone's help desk
- [ ] The screens import nothing from `packages/venue`
- [ ] A scheduled but unclocked shift is off duty; a clock-in cannot outlive shift end or activate an early self-start
- [ ] Self clock-in shows a countdown without a lead-owned pass; clock-out and prospective replacement end the right sessions
- [ ] Extending a claim's physical retention cannot extend its lease; losing claims never become later winners
- [ ] Resolution survives logical claim expiry; deleted known evidence yields `unverifiable` instead of reopening
- [ ] A ticket/claim/resolution at an exact deadline, a revoked partner staff member, and seat reassignment are checked at explicit action times

## Phase done when

- [ ] B3.1–B3.3 marked done in `TRACKER.md`
- [ ] Bug hunt run; Highs fixed with regression tests; Mediums fixed or in Known limitations
- [ ] Merged into `main`
