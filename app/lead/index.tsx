// /lead (B3.1-R3, R5, R6): volunteers by zone with status; clock in (with a duty pass, one
// approval), clock out, extend an active shift, write a shift.
//
// Extension follows the frozen confirmed-sequential profile: the replacement shift is confirmed
// first, then clock-in + pass are batched. Between the two the replacement is saved but inactive
// ("Replacement saved; clock-in pending"), also after a restart; resume runs only the missing step.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { clockInWithPass, PENDING_CLOCK_IN, replacementState, replaceShift } from "@/arkiv/batches";
import { clockTime, describeSubmit, DevClock } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { providers } from "@/providers";
import { str, u64, type ShiftView } from "@/rules";
import { grantsPermission, PERMS_TEXT_KEY, SHIFT_MANAGER } from "@/shared/ens/permission-envelope";
import type { Hex } from "@/shared/types/primitives";
import { styles } from "@/shell/styles";

const HOUR = 3_600n;

/** Whether this badge holds a registration-bound shift-manager note at the evaluated Sepolia block. */
function useIsLead(label: string | null, sepoliaBlock: bigint | undefined) {
  const [lead, setLead] = useState<boolean | null>(null);
  useEffect(() => {
    if (!label || sepoliaBlock === undefined) return;
    const ens = providers.ensReader();
    const at = { sepoliaBlock };
    let live = true;
    void Promise.all([
      ens.text(label, PERMS_TEXT_KEY, at),
      ens.registrationId(label, at),
      ens.owner(label, at),
    ])
      .then(([note, registrationId, owner]) => {
        if (live) setLead(grantsPermission(note, { registrationId, owner }, SHIFT_MANAGER));
      })
      .catch(() => live && setLead(null));
    return () => {
      live = false;
    };
  }, [label, sepoliaBlock]);
  return lead;
}

export default function Lead() {
  const { evaluation, error, mode, advance, refresh } = useEvaluation();
  const { byLabel, queue, context, store } = useWriter();
  const isLead = useIsLead(byLabel, evaluation?.context.sepoliaCutoff.number);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statedMinutesAgo, setStatedMinutesAgo] = useState("");
  const [confirmExtend, setConfirmExtend] = useState<Hex | null>(null);
  const [pending, setPending] = useState<Record<string, Hex>>({});
  const [form, setForm] = useState({ volunteer: "", zone: "", startsIn: "0", hours: "4" });

  const shiftKeys =
    evaluation?.view
      .records("shift")
      .map((r) => r.key)
      .join(",") ?? "";
  const loadPending = useCallback(async () => {
    const out: Record<string, Hex> = {};
    for (const key of shiftKeys.split(",").filter(Boolean)) {
      const s = await replacementState(store, providers.config.edition, key as Hex);
      if (s?.status === "shift-confirmed") out[key] = s.newShift;
    }
    setPending(out);
  }, [shiftKeys, store]);
  useEffect(() => void loadPending(), [loadPending]);

  const header = (
    <>
      <Text style={styles.h2}>Lead</Text>
      {mode === "fake" && advance && (
        <DevClock now={evaluation?.head.timestamp ?? null} onAdvance={advance} />
      )}
    </>
  );
  if (!byLabel?.endsWith(".volunteers"))
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {header}
        <Text style={styles.muted}>Connect and choose your volunteer badge.</Text>
      </ScrollView>
    );
  if (!evaluation)
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {header}
        <Text style={styles.muted}>{error ?? "Reading shifts…"}</Text>
      </ScrollView>
    );

  const { view, head } = evaluation;
  const now = view.now;
  const zones = view.venueAt()?.venue.zones.map((z) => z.id) ?? [];
  const volunteers = [
    ...new Set(
      view
        .records("shift")
        .filter((r) => view.verdict(r.key)?.counts)
        .map((r) => str(r, "volunteer")!),
    ),
  ].sort();
  const currentShift = (v: string): ShiftView | undefined => {
    const shifts = view.shiftsOf(v).filter((s) => s.effectiveEnd > now);
    return (
      shifts.find((s) => s.startsAt <= now) ?? shifts.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0]
    );
  };

  const act = async (label: string, run: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(`${label}: ${await run()}`);
    } catch (e) {
      setMessage(`${label}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(false);
      await loadPending();
      refresh();
    }
  };
  const ctx = () => {
    const c = context(head);
    if (!queue || !c) throw new Error("connect your wallet first");
    return { queue, c };
  };

  const clockIn = (v: string, s: ShiftView) =>
    act(`Clock ${v} in`, async () => {
      const { queue, c } = ctx();
      const minutes = statedMinutesAgo.trim() === "" ? null : BigInt(Math.max(0, Number(statedMinutesAgo)));
      const statedAt = minutes === null ? undefined : now - minutes * 60n;
      return describeSubmit(
        await clockInWithPass(queue, c, {
          volunteer: v,
          shift: s.record.key,
          endsAt: s.endsAt,
          ...(statedAt !== undefined ? { statedAt } : {}),
        }),
      );
    });
  const clockOut = (v: string, s: ShiftView) =>
    act(`Clock ${v} out`, async () => {
      const { queue, c } = ctx();
      return describeSubmit(
        await queue.submit(`Clock ${v} out`, {
          creates: [buildCreate("clock", c, { volunteer: v, shift: s.record.key, action: "out" })],
        }),
      );
    });
  const extend = (v: string, s: ShiftView) =>
    act(`Extend ${v}`, async () => {
      const { queue, c } = ctx();
      const r = await replaceShift(queue, store, c, {
        oldShift: s.record.key,
        volunteer: v,
        zone: s.zone,
        startsAt: s.startsAt,
        endsAt: s.endsAt + HOUR,
        clockIn: true,
      });
      return r.status === "complete"
        ? "Extended by 1 h."
        : r.status === "pending-clock-in"
          ? `${r.message}. Tap Resume to send the clock-in.`
          : describeSubmit(r.cause);
    });
  const writeShift = () =>
    act(`Shift for ${form.volunteer}`, async () => {
      const { queue, c } = ctx();
      const startsAt = now + BigInt(Math.round(Number(form.startsIn) * 60));
      const endsAt = startsAt + BigInt(Math.round(Number(form.hours) * 3600));
      return describeSubmit(
        await queue.submit(`Shift for ${form.volunteer}`, {
          creates: [
            buildCreate("shift", c, { volunteer: form.volunteer, zone: form.zone, startsAt, endsAt }),
          ],
        }),
      );
    });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {header}
      {isLead === false && (
        <Text testID="lead-not-lead">
          {byLabel} has no shift-manager note bound to its current registration, so nothing you write here
          will count.
        </Text>
      )}
      <View style={styles.wrap}>
        <Text style={styles.muted}>Late clock-in: stated minutes ago</Text>
        <TextInput
          value={statedMinutesAgo}
          onChangeText={setStatedMinutesAgo}
          placeholder="e.g. 10"
          keyboardType="numeric"
          style={[styles.input, { minWidth: 80 }]}
        />
      </View>
      {message && <Text testID="lead-message">{message}</Text>}

      {zones.map((zone) => (
        <View key={zone} style={{ gap: 8 }}>
          <Text style={styles.h3}>{zone}</Text>
          {volunteers
            .filter((v) => currentShift(v)?.zone === zone)
            .map((v) => {
              const s = currentShift(v)!;
              const onDuty = view.onDuty(v, now, zone);
              const covering = s.startsAt <= now;
              const resumeTo = pending[s.record.key];
              return (
                <View key={v} style={[styles.row, onDuty ? styles.rowOn : undefined]} testID="lead-volunteer">
                  <Text>
                    {onDuty ? "● on duty" : "○ off duty"} · {v}
                  </Text>
                  <Text style={styles.muted}>
                    {clockTime(s.startsAt)}–{clockTime(s.effectiveEnd)}
                    {s.pass ? " · pass issued" : ""}
                  </Text>
                  {s.sessions.map((x) => {
                    const stated = u64(x.clockIn, "stated_at");
                    return (
                      <Text key={x.clockIn.key} style={styles.muted}>
                        clocked in at block time {clockTime(x.clockIn.obs.createdAtTimestamp)}
                        {stated !== undefined ? ` (stated ${clockTime(stated)})` : ""}
                      </Text>
                    );
                  })}
                  <View style={styles.wrap}>
                    {resumeTo ? (
                      <>
                        <Text>{PENDING_CLOCK_IN}</Text>
                        <Pressable style={styles.chip} disabled={busy} onPress={() => void extend(v, s)}>
                          <Text>Resume</Text>
                        </Pressable>
                      </>
                    ) : onDuty ? (
                      <>
                        <Pressable style={styles.chip} disabled={busy} onPress={() => void clockOut(v, s)}>
                          <Text>Clock out</Text>
                        </Pressable>
                        <Pressable
                          style={styles.chip}
                          disabled={busy}
                          onPress={() => setConfirmExtend(s.record.key)}
                        >
                          <Text>Extend 1 h</Text>
                        </Pressable>
                      </>
                    ) : (
                      covering && (
                        <Pressable style={styles.chip} disabled={busy} onPress={() => void clockIn(v, s)}>
                          <Text>Clock in</Text>
                        </Pressable>
                      )
                    )}
                  </View>
                  {confirmExtend === s.record.key && (
                    <View style={styles.card}>
                      <Text>
                        Extending takes two approvals. The first saves a replacement shift and ends the
                        current session at once; the second clocks {v} into the replacement with a new pass.
                        Until the second lands, {v} shows as off duty.
                      </Text>
                      <View style={styles.wrap}>
                        <Pressable
                          style={styles.chip}
                          onPress={() => {
                            setConfirmExtend(null);
                            void extend(v, s);
                          }}
                        >
                          <Text>Continue</Text>
                        </Pressable>
                        <Pressable style={styles.chip} onPress={() => setConfirmExtend(null)}>
                          <Text>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.h3}>Write a shift</Text>
        <TextInput
          value={form.volunteer}
          onChangeText={(volunteer) => setForm({ ...form, volunteer })}
          placeholder="volunteer label, e.g. ravi.volunteers"
          autoCapitalize="none"
          style={styles.input}
        />
        <View style={styles.wrap}>
          {zones.map((z) => (
            <Pressable
              key={z}
              style={[styles.chip, form.zone === z ? styles.chipOn : undefined]}
              onPress={() => setForm({ ...form, zone: z })}
            >
              <Text>{z}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.wrap}>
          <Text style={styles.muted}>Starts in (min)</Text>
          <TextInput
            value={form.startsIn}
            onChangeText={(startsIn) => setForm({ ...form, startsIn })}
            keyboardType="numeric"
            style={[styles.input, { minWidth: 60 }]}
          />
          <Text style={styles.muted}>Length (h)</Text>
          <TextInput
            value={form.hours}
            onChangeText={(hours) => setForm({ ...form, hours })}
            keyboardType="numeric"
            style={[styles.input, { minWidth: 60 }]}
          />
        </View>
        <Pressable
          style={styles.chip}
          disabled={busy || !form.volunteer || !form.zone}
          onPress={() => void writeShift()}
        >
          <Text>Write shift</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
