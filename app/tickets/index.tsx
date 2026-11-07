// /tickets (B3.2): hackers raise and confirm help tickets; on-duty helpers get the best next
// ticket from where they stand, claim it, walk the drawn path and resolve it.
//
// Screens use only the Router interface and <VenueMap> props from providers (B3.2-R6). Ticket
// state comes from the rules at the observed head's block time; the router gets that explicit time.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
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
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconBubble,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  type Tone,
  Txt,
  messageTone,
  shortKey,
  toneColors,
  useTheme,
} from "@/ui";

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

const STATE_TONE: Record<TicketView["state"]["state"], Tone> = {
  open: "warning",
  claimed: "accent",
  resolved: "success",
  confirmed: "success",
  closed: "muted",
  "over-capacity": "muted",
  unverifiable: "muted",
};

export default function Tickets() {
  const live = useEvaluation();
  const writer = useWriter();
  const { evaluation, error, mode, advance } = live;
  const header =
    mode === "fake" && advance ? (
      <DevClock now={evaluation?.head.timestamp ?? null} onAdvance={advance} />
    ) : null;
  const label = writer.byLabel;
  const body = !label ? (
    <Card>
      <EmptyState
        icon="ticket"
        title="Choose your badge"
        body="Connect and choose your hackers or volunteer badge."
      />
    </Card>
  ) : !evaluation ? (
    <Banner tone={error ? "danger" : "neutral"} icon={error ? "alert" : "refresh"}>
      {error ?? "Reading tickets…"}
    </Banner>
  ) : label.endsWith(".hackers") ? (
    <Hacker evaluation={evaluation} writer={writer} refresh={live.refresh} />
  ) : (
    <Helper evaluation={evaluation} writer={writer} refresh={live.refresh} />
  );
  return (
    <Screen title="Help tickets" subtitle={label ?? undefined}>
      {header}
      {body}
    </Screen>
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
  const { c } = useTheme();

  if (!venue)
    return (
      <Card>
        <EmptyState
          icon="map"
          title="Venue not published yet"
          body="The organizer has not published the venue yet."
        />
      </Card>
    );
  return (
    <>
      <Button
        variant={safety ? "danger" : "secondary"}
        icon="alert"
        label="Medical or safety issue?"
        onPress={() => setSafety(!safety)}
      />
      {safety && (
        <Card tone="danger" testID="tickets-safety">
          <Txt variant="h3" tone="danger">
            This is not a ticket. Get help now:
          </Txt>
          <Row gap={10}>
            <Icon name="phone" size={24} color={toneColors(c, "danger").fg} />
            <Txt variant="display" style={{ fontSize: 28 }} selectable>
              {help.staffPhone}
            </Txt>
          </Row>
          <Txt>{help.deskLocation}</Txt>
        </Card>
      )}
      <Card>
        <Txt variant="h2">Raise a ticket</Txt>
        <Row gap={6} wrap={false} align="flex-start">
          <Icon name="lock" size={14} color={c.muted} />
          <Txt variant="caption" tone="muted" testID="tickets-privacy" style={{ flex: 1 }}>
            This form never asks for personal or medical details, and you should not add any.
          </Txt>
        </Row>
        <SectionHeader title="What do you need?" />
        <Row gap={6}>
          {ticketCategories(providers.config).map((cat) => (
            <Chip
              key={cat.id}
              label={cat.name}
              selected={category === cat.id}
              onPress={() => setCategory(cat.id)}
            />
          ))}
        </Row>
        <SectionHeader title="Where are you?" />
        <Row gap={8}>
          <Pill
            icon="pin"
            tone={chosenSeat ? "accent" : "muted"}
            label={chosenSeat ? `Seat ${chosenSeat}` : "Tap your seat on the map"}
          />
          {assigned && seat === null ? (
            <Txt variant="caption" tone="muted">
              your assigned seat
            </Txt>
          ) : null}
        </Row>
        <MapFrame>
          <VenueMap venue={venue.venue} highlight={chosenSeat ? [chosenSeat] : []} onSeatTap={setSeat} />
        </MapFrame>
        <Button
          variant="primary"
          size="lg"
          full
          icon="ticket"
          disabled={busy || !category || !chosenSeat}
          label={busy ? "Sending…" : "Raise ticket"}
          onPress={() =>
            void submit("Raise a help ticket", (ctx) =>
              buildCreate("ticket", ctx, { seat: chosenSeat!, venue: venue.record.key, category: category! }),
            )
          }
        />
        {message && <Banner tone={messageTone(message)}>{message}</Banner>}
      </Card>

      <SectionHeader title="My tickets" icon="ticket" />
      {mine.length === 0 && rejected.length === 0 && (
        <Txt variant="caption" tone="muted">
          None yet.
        </Txt>
      )}
      {mine.map((t) => (
        <ListRow
          key={t.record.key}
          testID="tickets-mine"
          left={<IconBubble name="ticket" tone={STATE_TONE[t.state.state]} size={36} />}
          title={ticketCategory(providers.config, t.category)?.name ?? t.category}
          subtitle={`Seat ${t.seat} · ${clockTime(t.record.obs.createdAtTimestamp)}`}
        >
          <Pill label={STATE_TEXT[t.state.state]} tone={STATE_TONE[t.state.state]} dot />
          {t.state.state === "resolved" && (
            <Button
              variant="success"
              icon="check"
              label="Confirm fixed"
              disabled={busy}
              onPress={() =>
                void submit("Confirm the fix", (ctx) =>
                  buildCreate("ticket_confirmation", ctx, {
                    ticket: t.record.key,
                    resolution: (t.state as { resolution: { key: Hex } }).resolution.key,
                  }),
                )
              }
            />
          )}
        </ListRow>
      ))}
      {rejected.map((v) => (
        <ListRow
          key={v.key}
          dim
          tone="muted"
          left={<IconBubble name="x" tone="muted" size={36} />}
          title={`Ticket ${shortKey(v.key)} did not count`}
          subtitle={v.reason}
        />
      ))}
    </>
  );
}

/** Rounded frame around the venue map. */
function MapFrame({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: c.border }}>
      {children}
    </View>
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
  const { c } = useTheme();
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
    return (
      <Card>
        <EmptyState icon="clock" title="You are off duty" body="Clock in (or ask a lead) to see tickets." />
      </Card>
    );
  if (!venue || !pos) return <Banner icon="pin">Finding your position…</Banner>;

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
      <Card padded={false}>
        <View style={{ padding: 16, gap: 6 }}>
          <Row gap={8}>
            <Pill
              label={partner ? `${partner} staff` : `On duty in ${[...zones].join(", ")}`}
              tone="success"
              dot
            />
            {startPoi ? <Pill label={`From ${startPoi.name}`} tone="neutral" icon="pin" /> : null}
          </Row>
          <Txt variant="caption" tone="faint">
            You are at cell ({pos.x}, {pos.y})
          </Txt>
        </View>
        <VenueMap venue={venue} highlight={target ? [target.seat] : []} path={path} />
      </Card>
      {mineActive && mineActive.state.state === "claimed" ? (
        <Card tone="accent" testID="tickets-claimed">
          <Txt variant="label" tone="accent">
            Your ticket
          </Txt>
          <Txt variant="title">
            Go to seat {mineActive.seat} ·{" "}
            {ticketCategory(providers.config, mineActive.category)?.name ?? mineActive.category}
          </Txt>
          <Row gap={6}>
            <Icon name="clock" size={16} color={c.accent} />
            <Txt num>Lease ends in {countdown(mineActive.state.leaseEnd - now)}</Txt>
          </Row>
          <Button
            variant="success"
            size="lg"
            full
            icon="check"
            label="Mark resolved"
            disabled={busy}
            onPress={() => resolve(mineActive)}
          />
        </Card>
      ) : offer ? (
        <Card testID="tickets-offer">
          <Txt variant="label" tone="muted">
            Next best ticket
          </Txt>
          <Row gap={8}>
            <Txt variant="title">
              Next: seat {offer.seat} ·{" "}
              {ticketCategory(providers.config, offer.category)?.name ?? offer.category}
            </Txt>
          </Row>
          <Txt tone="muted" num>
            Waiting since {clockTime(offer.record.obs.createdAtTimestamp)} · {path ? path.length - 1 : "?"}{" "}
            cells away
          </Txt>
          <Button
            variant="primary"
            size="lg"
            full
            icon="ticket"
            label="Claim"
            disabled={busy}
            onPress={() =>
              void submit("Claim the ticket", (ctx) =>
                buildCreate("ticket_claim", ctx, { ticket: offer.record.key }),
              )
            }
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="check"
            tone="success"
            title="All clear"
            body={partner ? `No open ${partner} tickets.` : "No open tickets in your zone."}
          />
        </Card>
      )}
      {message && <Banner tone={messageTone(message)}>{message}</Banner>}
      {lost.slice(-1).map((v) => (
        <Banner key={v.key} tone="muted" icon="x">
          {`Your claim did not count: ${v.reason}`}
        </Banner>
      ))}
    </>
  );
}
