// /tickets (B3.2): hackers raise and confirm help tickets; on-duty helpers get the best next
// ticket from where they stand, claim it, walk the drawn path and resolve it.
//
// Screens use only the Router interface and <VenueMap> props from providers (B3.2-R6). Ticket
// state comes from the rules at the observed head's block time; the router gets that explicit time.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import type { CurrentEvaluation } from "@/arkiv/evaluate-current";
import { clockTime, countdown, describeSubmit, DevClock } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { providers } from "@/providers";
import { staffPartnerOf, str, type TicketView } from "@/rules";
import { ticketCategories, ticketCategory } from "@/shared/config/tickets";
import { DEFAULT_ALPHA_MM_PER_MINUTE } from "@/shared/interfaces/router";
import type { Address, Hex } from "@/shared/types/primitives";
import type { CellRef, Venue } from "@/shared/types/venue";
import { styles } from "@/shell/styles";

type Writer = ReturnType<typeof useWriter>;

const STATE_TEXT: Record<TicketView["state"]["state"], string> = {
  open: "Waiting for a helper",
  claimed: "A helper is on the way",
  resolved: "Marked fixed — please confirm",
  confirmed: "Fixed and confirmed",
  closed: "Closed (4 h passed)",
  "over-capacity": "Queued: you already have 3 open tickets",
  unverifiable: "Unverifiable (evidence missing)",
};

export default function Tickets() {
  const live = useEvaluation();
  const writer = useWriter();
  const { evaluation, error, mode, advance } = live;
  const header = (
    <>
      <Text style={styles.h2}>Help tickets</Text>
      {mode === "fake" && advance && (
        <DevClock now={evaluation?.head.timestamp ?? null} onAdvance={advance} />
      )}
    </>
  );
  const label = writer.byLabel;
  const body = !label ? (
    <Text style={styles.muted}>Connect and choose your hackers or volunteer badge.</Text>
  ) : !evaluation ? (
    <Text style={styles.muted}>{error ?? "Reading tickets…"}</Text>
  ) : label.endsWith(".hackers") ? (
    <Hacker evaluation={evaluation} writer={writer} refresh={live.refresh} />
  ) : (
    <Helper evaluation={evaluation} writer={writer} refresh={live.refresh} />
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {header}
      {body}
    </ScrollView>
  );
}

type Props = { evaluation: CurrentEvaluation; writer: Writer; refresh: () => void };

function useSubmit(writer: Writer, evaluation: CurrentEvaluation, refresh: () => void) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (
    label: string,
    build: (ctx: NonNullable<ReturnType<Writer["context"]>>) => unknown,
  ) => {
    const ctx = writer.context(evaluation.head);
    if (!writer.queue || !ctx) return setMessage("Connect your wallet first.");
    setBusy(true);
    setMessage(null);
    try {
      const r = await writer.queue.submit(label, { creates: [build(ctx) as never] });
      setMessage(describeSubmit(r));
    } catch (e) {
      setMessage((e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return { message, busy, submit };
}

// ── Hacker ───────────────────────────────────────────────────────────────────────────────────

function Hacker({ evaluation, writer, refresh }: Props) {
  const { view, output } = evaluation;
  const VenueMap = providers.venueMap();
  const venue = view.venueAt();
  const address = writer.address!.toLowerCase() as Address;
  const assigned = view.seatOf(address);
  const [seat, setSeat] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [safety, setSafety] = useState(false);
  const { message, busy, submit } = useSubmit(writer, evaluation, refresh);
  const chosenSeat = seat ?? (assigned ? str(assigned, "seat")! : null);
  const mine = view.ticketsAt().filter((t) => t.record.creator.toLowerCase() === address);
  const rejected = output.verdicts.filter(
    (v) =>
      v.kind === "ticket" &&
      !v.counts &&
      view.records("ticket").some((r) => r.key === v.key && r.creator.toLowerCase() === address),
  );
  const help = providers.config.help;

  if (!venue) return <Text style={styles.muted}>The organizer has not published the venue yet.</Text>;
  return (
    <>
      <Pressable style={[styles.chip, safety ? styles.chipOn : undefined]} onPress={() => setSafety(!safety)}>
        <Text>Medical or safety issue?</Text>
      </Pressable>
      {safety && (
        <View style={styles.card} testID="tickets-safety">
          <Text style={styles.h3}>This is not a ticket. Get help now:</Text>
          <Text style={{ fontSize: 20 }}>{help.staffPhone}</Text>
          <Text>{help.deskLocation}</Text>
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.h3}>Raise a ticket</Text>
        <Text style={styles.muted} testID="tickets-privacy">
          This form never asks for personal or medical details, and you should not add any.
        </Text>
        <View style={styles.wrap}>
          {ticketCategories(providers.config).map((c) => (
            <Pressable
              key={c.id}
              style={[styles.chip, category === c.id ? styles.chipOn : undefined]}
              onPress={() => setCategory(c.id)}
            >
              <Text>{c.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text>
          Seat: {chosenSeat ?? "tap your seat on the map"}
          {assigned && seat === null ? " (your assigned seat)" : ""}
        </Text>
        <VenueMap venue={venue.venue} highlight={chosenSeat ? [chosenSeat] : []} onSeatTap={setSeat} />
        <Pressable
          style={styles.chip}
          disabled={busy || !category || !chosenSeat}
          onPress={() =>
            void submit("Raise a help ticket", (ctx) =>
              buildCreate("ticket", ctx, { seat: chosenSeat!, venue: venue.record.key, category: category! }),
            )
          }
        >
          <Text>{busy ? "Sending…" : "Raise ticket"}</Text>
        </Pressable>
        {message && <Text>{message}</Text>}
      </View>

      <Text style={styles.h3}>My tickets</Text>
      {mine.length === 0 && rejected.length === 0 && <Text style={styles.muted}>None yet.</Text>}
      {mine.map((t) => (
        <View key={t.record.key} style={styles.row} testID="tickets-mine">
          <Text>
            {ticketCategory(providers.config, t.category)?.name ?? t.category} · seat {t.seat} ·{" "}
            {clockTime(t.record.obs.createdAtTimestamp)}
          </Text>
          <Text style={styles.muted}>{STATE_TEXT[t.state.state]}</Text>
          {t.state.state === "resolved" && (
            <Pressable
              style={styles.chip}
              disabled={busy}
              onPress={() =>
                void submit("Confirm the fix", (ctx) =>
                  buildCreate("ticket_confirmation", ctx, {
                    ticket: t.record.key,
                    resolution: (t.state as { resolution: { key: Hex } }).resolution.key,
                  }),
                )
              }
            >
              <Text>Confirm fixed</Text>
            </Pressable>
          )}
        </View>
      ))}
      {rejected.map((v) => (
        <View key={v.key} style={[styles.row, { opacity: 0.5 }]}>
          <Text>✗ ticket {v.key.slice(0, 10)}…</Text>
          <Text>{v.reason}</Text>
        </View>
      ))}
    </>
  );
}

// ── Helper ───────────────────────────────────────────────────────────────────────────────────

const seatCell = (venue: Venue, seat: string): CellRef | undefined =>
  venue.seats.find((s) => s.id === seat)?.cell;

/**
 * The helper's position on this device: their zone's help desk at each new clock-in (B3.2-R7),
 * then the seat of each ticket they resolve. An application estimate, not tracking.
 */
function usePosition(
  store: Writer["store"],
  label: string,
  sessionKey: string | undefined,
  start: CellRef | undefined,
) {
  const [pos, setPos] = useState<CellRef | null>(null);
  const k = `pos:${providers.config.edition}:${label}`;
  useEffect(() => {
    void (async () => {
      const saved = JSON.parse((await store.get(k)) ?? "null") as { session: string; cell: CellRef } | null;
      if (saved && saved.session === sessionKey) setPos(saved.cell);
      else if (sessionKey && start) {
        setPos(start);
        await store.set(k, JSON.stringify({ session: sessionKey, cell: start }));
      } else setPos(null);
    })();
  }, [k, sessionKey, start, store]);
  const moveTo = (cell: CellRef) => {
    setPos(cell);
    if (sessionKey) void store.set(k, JSON.stringify({ session: sessionKey, cell }));
  };
  return { pos, moveTo };
}

function Helper({ evaluation, writer, refresh }: Props) {
  const { view, output } = evaluation;
  const label = writer.byLabel!;
  const me = writer.address!.toLowerCase();
  const router = providers.router();
  const VenueMap = providers.venueMap();
  const now = view.now;
  // Partner staff answer their partner's tickets anywhere, without shifts (B3.3-R3).
  const partner = staffPartnerOf(label);
  const sessions = partner ? [] : view.sessionsOf(label);
  const zones = new Set(sessions.map((s) => s.shift.zone));
  const startPoi = view.helperStart(label);
  const { pos, moveTo } = usePosition(
    writer.store,
    label,
    partner ? "staff" : sessions[0]?.clockIn.key,
    startPoi?.cell,
  );
  const { message, busy, submit } = useSubmit(writer, evaluation, refresh);
  const venue = view.venueAt()?.venue;
  const tickets = view.ticketsAt();

  const mineActive = tickets.find(
    (t) => t.state.state === "claimed" && t.state.claim.creator.toLowerCase() === me,
  );
  const lost = output.verdicts.filter(
    (v) =>
      v.kind === "ticket_claim" &&
      !v.counts &&
      view.records("ticket_claim").some((r) => r.key === v.key && r.creator.toLowerCase() === me),
  );
  const offer = useMemo(() => {
    if (!venue || !pos) return null;
    const open = tickets.flatMap((t) => {
      // Volunteers take general tickets in their zones; staff take their partner's, anywhere.
      const forPartner = ticketCategory(providers.config, t.category)?.partner ?? null;
      const mine = partner ? forPartner === partner : forPartner === null && zones.has(t.zone);
      if (t.state.state !== "open" || !mine) return [];
      const cell = seatCell(t.venue.venue, t.seat);
      return cell ? [{ key: t.record.key, cell, createdAtSeconds: t.record.obs.createdAtTimestamp }] : [];
    });
    const best = router.nextTicket(venue, pos, open, now, DEFAULT_ALPHA_MM_PER_MINUTE);
    return best ? tickets.find((t) => t.record.key === best.key)! : null;
  }, [venue, pos, tickets, zones, router, now, partner]);

  if (!partner && sessions.length === 0)
    return <Text style={styles.muted}>You are off duty. Clock in (or ask a lead) to see tickets.</Text>;
  if (!venue || !pos) return <Text style={styles.muted}>Finding your position…</Text>;

  const target = mineActive ?? offer;
  const targetCell = target ? seatCell(target.venue.venue, target.seat) : undefined;
  const path = targetCell ? router.path(venue, pos, targetCell) : null;
  const resolve = (t: TicketView) => {
    const claim = (t.state as { claim: { key: Hex } }).claim.key;
    void submit("Resolve the ticket", (ctx) =>
      buildCreate("ticket_resolution", ctx, { ticket: t.record.key, claim, seat: t.seat }),
    ).then(() => {
      const cell = seatCell(t.venue.venue, t.seat);
      if (cell) moveTo(cell);
    });
  };

  return (
    <>
      <Text style={styles.muted}>
        {partner ? `${partner} staff` : `On duty in ${[...zones].join(", ")}`} · you are at ({pos.x}, {pos.y})
        {startPoi ? `, starting from ${startPoi.name}` : ""}
      </Text>
      <VenueMap venue={venue} highlight={target ? [target.seat] : []} path={path} />
      {mineActive && mineActive.state.state === "claimed" ? (
        <View style={[styles.card, styles.rowOn]} testID="tickets-claimed">
          <Text style={styles.h3}>
            Go to seat {mineActive.seat} ·{" "}
            {ticketCategory(providers.config, mineActive.category)?.name ?? mineActive.category}
          </Text>
          <Text>Lease ends in {countdown(mineActive.state.leaseEnd - now)}</Text>
          <Pressable style={styles.chip} disabled={busy} onPress={() => resolve(mineActive)}>
            <Text>Mark resolved</Text>
          </Pressable>
        </View>
      ) : offer ? (
        <View style={styles.card} testID="tickets-offer">
          <Text style={styles.h3}>
            Next: seat {offer.seat} ·{" "}
            {ticketCategory(providers.config, offer.category)?.name ?? offer.category}
          </Text>
          <Text style={styles.muted}>
            Waiting since {clockTime(offer.record.obs.createdAtTimestamp)} · {path ? path.length - 1 : "?"}{" "}
            cells away
          </Text>
          <Pressable
            style={styles.chip}
            disabled={busy}
            onPress={() =>
              void submit("Claim the ticket", (ctx) =>
                buildCreate("ticket_claim", ctx, { ticket: offer.record.key }),
              )
            }
          >
            <Text>Claim</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>
          {partner ? `No open ${partner} tickets.` : "No open tickets in your zone."}
        </Text>
      )}
      {message && <Text>{message}</Text>}
      {lost.slice(-1).map((v) => (
        <Text key={v.key} style={{ opacity: 0.6 }}>
          Your claim did not count: {v.reason}
        </Text>
      ))}
    </>
  );
}
