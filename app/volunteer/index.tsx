// /volunteer (B3.1-R4, R7): my status, countdown, zone, next shift, and "Start shift".
//
// Everything shown comes from the rules over current Arkiv observations at the observed head's
// block time; the countdown ticks locally from that block time. A self-start writes one `clock in`
// inside [starts_at-60 min, starts_at+15 min]; outside it the screen says "Ask a lead".
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { PENDING_CLOCK_IN } from "@/arkiv/batches";
import { clockTime, countdown, describeSubmit, DevClock } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { SELF_START_AFTER, SELF_START_BEFORE, type ShiftView } from "@/rules";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  IconBubble,
  Pill,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Txt,
  messageTone,
} from "@/ui";

/** Seconds since the evaluation was read, so the countdown follows block time between refreshes. */
function useElapsed(stamp: unknown): bigint {
  const [elapsed, setElapsed] = useState(0n);
  useEffect(() => {
    setElapsed(0n);
    const started = Date.now();
    const id = setInterval(() => setElapsed(BigInt(Math.floor((Date.now() - started) / 1000))), 1000);
    return () => clearInterval(id);
  }, [stamp]);
  return elapsed;
}

export default function Volunteer() {
  const { evaluation, error, mode, advance, refresh } = useEvaluation();
  const { byLabel, queue, context } = useWriter();
  const elapsed = useElapsed(evaluation);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const header =
    mode === "fake" && advance ? (
      <DevClock now={evaluation?.head.timestamp ?? null} onAdvance={advance} />
    ) : null;
  if (!byLabel?.endsWith(".volunteers"))
    return (
      <Screen title="My shift">
        {header}
        <Card>
          <EmptyState
            icon="badge"
            title="Choose a volunteer badge"
            body="Connect and choose a volunteer badge to see your shifts."
          />
        </Card>
      </Screen>
    );
  if (!evaluation)
    return (
      <Screen title="My shift">
        {header}
        <Banner tone={error ? "danger" : "neutral"} icon={error ? "alert" : "refresh"}>
          {error ?? "Reading your shifts…"}
        </Banner>
      </Screen>
    );

  const { view, head } = evaluation;
  const now = view.now;
  const shifts = view.shiftsOf(byLabel);
  const sessions = view.sessionsOf(byLabel);
  const active = sessions[0];
  const upcoming = shifts
    .filter((s) => s.effectiveEnd > now && !s.sessions.some((x) => x.end > now))
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const next = upcoming[0];
  // Clocked in early: the session exists but duty starts with the shift.
  const early = shifts.flatMap((s) => s.sessions).find((x) => x.start > now && x.end > now);
  // A replacement that cut a session and has no clock-in of its own yet (confirmed-sequential gap).
  const pending = shifts.find(
    (s) =>
      s.supersedes !== undefined &&
      s.sessions.length === 0 &&
      s.effectiveEnd > now &&
      shifts.some((old) => old.record.key === s.supersedes && old.sessions.length > 0),
  );
  const canSelfStart = (s: ShiftView) =>
    now >= s.startsAt - SELF_START_BEFORE && now <= s.startsAt + SELF_START_AFTER && now < s.effectiveEnd;

  const start = async (s: ShiftView) => {
    const ctx = context(head);
    if (!queue || !ctx) return;
    setBusy(true);
    setMessage(null);
    const r = await queue.submit("Start my shift", {
      creates: [buildCreate("clock", ctx, { volunteer: byLabel, shift: s.record.key, action: "in" })],
    });
    setMessage(describeSubmit(r));
    setBusy(false);
    refresh();
  };

  const hasPass = active ? !!shifts.find((s) => s.record.key === active.shift.record.key)?.pass : false;
  const left = active ? active.end - now - elapsed : 0n;
  const total = active ? active.end - active.start : 0n;
  const progress = active && total > 0n ? 1 - Number(left) / Number(total) : 0;

  return (
    <Screen title="My shift" subtitle={byLabel}>
      {header}
      <Card tone={active ? "success" : "neutral"} testID="volunteer-status">
        <Row justify="space-between">
          <Pill
            label={active ? `On duty · ${active.shift.zone}` : "Off duty"}
            tone={active ? "success" : "muted"}
            dot
          />
          {active ? (
            <Pill label={hasPass ? "Lead pass" : "Self-started"} tone="neutral" icon="badge" />
          ) : null}
        </Row>
        {active ? (
          <Stackv gap={6}>
            <Txt variant="display" num style={{ fontSize: 48 }}>
              {countdown(left)}
            </Txt>
            <Txt tone="muted">
              until {clockTime(active.end)} · {hasPass ? "lead pass issued" : "self-started (no lead pass)"}
            </Txt>
            <ProgressBar value={progress} tone="success" />
          </Stackv>
        ) : (
          <Txt tone="muted">You are not clocked in right now.</Txt>
        )}
        {!active && early && (
          <Banner tone="warning" icon="clock">
            {`Clocked in for ${early.shift.zone}; duty starts at ${clockTime(early.start)}.`}
          </Banner>
        )}
        {pending && <Banner tone="warning">{PENDING_CLOCK_IN}</Banner>}
      </Card>

      {next && (
        <Card>
          <SectionHeader title="Next shift" icon="clock" />
          <Row wrap={false} gap={12}>
            <IconBubble name="pin" />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h2">{next.zone}</Txt>
              <Txt tone="muted" num>
                {clockTime(next.startsAt)} – {clockTime(next.effectiveEnd)}
              </Txt>
            </View>
          </Row>
          {canSelfStart(next) ? (
            <Button
              testID="volunteer-start"
              accessibilityRole="button"
              disabled={busy}
              variant="primary"
              size="lg"
              full
              icon="check"
              label={busy ? "Starting…" : "Start shift"}
              onPress={() => void start(next)}
            />
          ) : (
            <Banner icon="info">
              {now < next.startsAt - SELF_START_BEFORE
                ? `You can start from ${clockTime(next.startsAt - SELF_START_BEFORE)}.`
                : "Ask a lead to clock you in."}
            </Banner>
          )}
        </Card>
      )}
      {!active && !next && (
        <Card>
          <EmptyState icon="clock" title="No upcoming shifts" body="Your lead will add one for you." />
        </Card>
      )}
      {message && <Banner tone={messageTone(message)}>{message}</Banner>}
    </Screen>
  );
}
