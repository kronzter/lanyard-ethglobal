// /lead (B3.1-R3, R5, R6): volunteers by zone with status; clock in (with a duty pass, one
// approval), clock out, extend an active shift, write a shift.
//
// Extension follows the frozen confirmed-sequential profile: the replacement shift is confirmed
// first, then clock-in + pass are batched. Between the two the replacement is saved but inactive
// ("Replacement saved; clock-in pending"), also after a restart; resume runs only the missing step.
import { useCallback, useEffect, useState } from "react";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { clockInWithPass, PENDING_CLOCK_IN, replacementState, replaceShift } from "@/arkiv/batches";
import { clockTime, describeSubmit, DevClock } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { providers } from "@/providers";
import { str, u64, type ShiftView } from "@/rules";
import { grantsPermission, PERMS_TEXT_KEY, SHIFT_MANAGER } from "@/shared/ens/permission-envelope";
import type { Hex } from "@/shared/types/primitives";
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  Disclosure,
  Divider,
  EmptyState,
  Field,
  ListRow,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stackv,
  Txt,
  firstLabel,
  initial,
  messageTone,
} from "@/ui";

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

  const header =
    mode === "fake" && advance ? (
      <DevClock now={evaluation?.head.timestamp ?? null} onAdvance={advance} />
    ) : null;
  if (!byLabel?.endsWith(".volunteers"))
    return (
      <Screen title="Lead console">
        {header}
        <Card>
          <EmptyState
            icon="badge"
            title="Choose your volunteer badge"
            body="Connect and choose your volunteer badge."
          />
        </Card>
      </Screen>
    );
  if (!evaluation)
    return (
      <Screen title="Lead console">
        {header}
        <Banner tone={error ? "danger" : "neutral"} icon={error ? "alert" : "refresh"}>
          {error ?? "Reading shifts…"}
        </Banner>
      </Screen>
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

  const inZone = (zone: string) => volunteers.filter((v) => currentShift(v)?.zone === zone);

  return (
    <Screen
      title="Lead console"
      subtitle={byLabel}
      right={isLead ? <Pill label="Shift manager" tone="accent" icon="shield" /> : null}
    >
      {header}
      {isLead === false && (
        <Banner tone="danger" testID="lead-not-lead" title="Not a lead">
          {`${byLabel} has no shift-manager note bound to its current registration, so nothing you write here will count.`}
        </Banner>
      )}
      {message && (
        <Banner testID="lead-message" tone={messageTone(message)}>
          {message}
        </Banner>
      )}

      {zones.map((zone) => {
        const people = inZone(zone);
        const onDutyCount = people.filter((v) => view.onDuty(v, now, zone)).length;
        return (
          <Stackv key={zone} gap={10}>
            <SectionHeader
              title={zone}
              icon="pin"
              right={
                <Pill
                  label={`${onDutyCount}/${people.length} on duty`}
                  tone={onDutyCount ? "success" : "muted"}
                />
              }
            />
            {people.length === 0 && (
              <Txt variant="caption" tone="muted">
                No volunteers scheduled in this zone.
              </Txt>
            )}
            {people.map((v) => {
              const s = currentShift(v)!;
              const onDuty = view.onDuty(v, now, zone);
              const covering = s.startsAt <= now;
              const resumeTo = pending[s.record.key];
              return (
                <ListRow
                  key={v}
                  testID="lead-volunteer"
                  tone={onDuty ? "success" : "neutral"}
                  left={<Avatar letter={initial(v)} tone={onDuty ? "success" : "muted"} />}
                  title={firstLabel(v)}
                  subtitle={
                    <Row gap={6}>
                      <Txt variant="caption" tone="muted" num>
                        {clockTime(s.startsAt)}–{clockTime(s.effectiveEnd)}
                      </Txt>
                      {s.pass ? <Pill label="pass issued" tone="accent" /> : null}
                    </Row>
                  }
                  right={
                    <Pill label={onDuty ? "On duty" : "Off duty"} tone={onDuty ? "success" : "muted"} dot />
                  }
                >
                  {s.sessions.map((x) => {
                    const stated = u64(x.clockIn, "stated_at");
                    return (
                      <Txt key={x.clockIn.key} variant="caption" tone="muted">
                        clocked in at block time {clockTime(x.clockIn.obs.createdAtTimestamp)}
                        {stated !== undefined ? ` (stated ${clockTime(stated)})` : ""}
                      </Txt>
                    );
                  })}
                  <Row gap={8}>
                    {resumeTo ? (
                      <>
                        <Txt variant="caption" tone="warning">
                          {PENDING_CLOCK_IN}
                        </Txt>
                        <Button
                          variant="warning"
                          size="sm"
                          label="Resume"
                          disabled={busy}
                          onPress={() => void extend(v, s)}
                        />
                      </>
                    ) : onDuty ? (
                      <>
                        <Button
                          size="sm"
                          label="Clock out"
                          disabled={busy}
                          onPress={() => void clockOut(v, s)}
                        />
                        <Button
                          size="sm"
                          icon="plus"
                          label="Extend 1 h"
                          disabled={busy}
                          onPress={() => setConfirmExtend(s.record.key)}
                        />
                      </>
                    ) : (
                      covering && (
                        <Button
                          variant="primary"
                          icon="check"
                          label="Clock in"
                          disabled={busy}
                          onPress={() => void clockIn(v, s)}
                        />
                      )
                    )}
                  </Row>
                  {confirmExtend === s.record.key && (
                    <Card tone="warning">
                      <Txt>
                        Extending takes two approvals. The first saves a replacement shift and ends the
                        current session at once; the second clocks {v} into the replacement with a new pass.
                        Until the second lands, {v} shows as off duty.
                      </Txt>
                      <Row gap={8}>
                        <Button
                          variant="primary"
                          size="sm"
                          label="Continue"
                          onPress={() => {
                            setConfirmExtend(null);
                            void extend(v, s);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          label="Cancel"
                          onPress={() => setConfirmExtend(null)}
                        />
                      </Row>
                    </Card>
                  )}
                </ListRow>
              );
            })}
          </Stackv>
        );
      })}

      <Disclosure title="Lead tools" icon="list">
        <Field
          label="Late clock-in"
          hint="Stated minutes ago, recorded on the next clock-in."
          value={statedMinutesAgo}
          onChangeText={setStatedMinutesAgo}
          placeholder="e.g. 10"
          keyboardType="numeric"
          suffix="min"
        />
        <Divider />
        <Txt variant="h2">Write a shift</Txt>
        <Field
          label="Volunteer"
          value={form.volunteer}
          onChangeText={(volunteer) => setForm({ ...form, volunteer })}
          placeholder="volunteer label, e.g. ravi.volunteers"
          autoCapitalize="none"
        />
        <Txt variant="h3">Zone</Txt>
        <Row gap={6}>
          {zones.map((z) => (
            <Chip
              key={z}
              label={z}
              selected={form.zone === z}
              onPress={() => setForm({ ...form, zone: z })}
            />
          ))}
        </Row>
        <Row gap={12} wrap={false}>
          <Field
            label="Starts in"
            style={{ flex: 1 }}
            value={form.startsIn}
            onChangeText={(startsIn) => setForm({ ...form, startsIn })}
            keyboardType="numeric"
            suffix="min"
          />
          <Field
            label="Length"
            style={{ flex: 1 }}
            value={form.hours}
            onChangeText={(hours) => setForm({ ...form, hours })}
            keyboardType="numeric"
            suffix="h"
          />
        </Row>
        <Button
          variant="primary"
          full
          label="Write shift"
          disabled={busy || !form.volunteer || !form.zone}
          onPress={() => void writeShift()}
        />
      </Disclosure>
    </Screen>
  );
}
