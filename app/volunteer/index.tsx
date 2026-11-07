// /volunteer (B3.1-R4, R7): my status, countdown, zone, next shift, and "Start shift".
//
// Everything shown comes from the rules over current Arkiv observations at the observed head's
// block time; the countdown ticks locally from that block time. A self-start writes one `clock in`
// inside [starts_at-60 min, starts_at+15 min]; outside it the screen says "Ask a lead".
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { PENDING_CLOCK_IN } from "@/arkiv/batches";
import { clockTime, countdown, describeSubmit, DevClock } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { SELF_START_AFTER, SELF_START_BEFORE, type ShiftView } from "@/rules";
import { styles } from "@/shell/styles";

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

  const header = (
    <>
      <Text style={styles.h2}>My shift</Text>
      {mode === "fake" && advance && (
        <DevClock now={evaluation?.head.timestamp ?? null} onAdvance={advance} />
      )}
    </>
  );
  if (!byLabel?.endsWith(".volunteers"))
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {header}
        <Text style={styles.muted}>Connect and choose a volunteer badge to see your shifts.</Text>
      </ScrollView>
    );
  if (!evaluation)
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {header}
        <Text style={styles.muted}>{error ?? "Reading your shifts…"}</Text>
      </ScrollView>
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

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {header}
      <View style={[styles.card, active ? styles.rowOn : undefined]} testID="volunteer-status">
        <Text style={styles.h3}>{active ? `On duty · ${active.shift.zone}` : "Off duty"}</Text>
        {active && (
          <>
            <Text style={{ fontSize: 28 }}>{countdown(active.end - now - elapsed)}</Text>
            <Text style={styles.muted}>
              until {clockTime(active.end)} ·{" "}
              {shifts.find((s) => s.record.key === active.shift.record.key)?.pass
                ? "lead pass issued"
                : "self-started (no lead pass)"}
            </Text>
          </>
        )}
        {!active && early && (
          <Text>
            Clocked in for {early.shift.zone}; duty starts at {clockTime(early.start)}.
          </Text>
        )}
        {pending && <Text>{PENDING_CLOCK_IN}</Text>}
      </View>

      {next && (
        <View style={styles.card}>
          <Text style={styles.h3}>Next shift · {next.zone}</Text>
          <Text>
            {clockTime(next.startsAt)}–{clockTime(next.effectiveEnd)}
          </Text>
          {canSelfStart(next) ? (
            <Pressable
              testID="volunteer-start"
              accessibilityRole="button"
              disabled={busy}
              style={styles.chip}
              onPress={() => void start(next)}
            >
              <Text>{busy ? "Starting…" : "Start shift"}</Text>
            </Pressable>
          ) : (
            <Text style={styles.muted}>
              {now < next.startsAt - SELF_START_BEFORE
                ? `You can start from ${clockTime(next.startsAt - SELF_START_BEFORE)}.`
                : "Ask a lead to clock you in."}
            </Text>
          )}
        </View>
      )}
      {!active && !next && <Text style={styles.muted}>No upcoming shifts.</Text>}
      {message && <Text>{message}</Text>}
    </ScrollView>
  );
}
