// /organizer/seats (web-only, B3.3-R1, R4, R6): publish a venue.json as a readonly `venue` record
// and import seat assignments from a CSV, both signed by the organizer wallet. Everything is
// checked first: zones, help desks and partner tables for the venue; label shape, seat IDs from the
// current venue and duplicates for the CSV. The rules decide again what counts.
import { useState } from "react";
import { Platform } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { parseSeatCsv, venueProblems } from "@/arkiv/seat-import";
import { describeSubmit } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { providers } from "@/providers";
import { parseJsonStrict } from "@/shared/canonical";
import { Banner, Button, Card, Field, Icon, Pill, Row, Screen, Step, Txt, messageTone, useTheme } from "@/ui";

/** Seat rows per batch: one wallet approval each. */
const SEATS_PER_BATCH = 20;

function pickFile(onText: (text: string) => void) {
  if (Platform.OS !== "web") return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.csv,text/csv,application/json";
  input.onchange = () => void input.files?.[0]?.text().then(onText);
  input.click();
}

export default function Seats() {
  const { evaluation, error, refresh } = useEvaluation();
  const { queue, context, byLabel } = useWriter();
  const [venueText, setVenueText] = useState("");
  const [version, setVersion] = useState("");
  const [csv, setCsv] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const current = evaluation?.view.venueAt();
  const { c } = useTheme();

  let parsedVenue: ReturnType<typeof venueProblems> | null = null;
  if (venueText.trim() !== "") {
    try {
      parsedVenue = venueProblems(parseJsonStrict(venueText), providers.config);
    } catch (e) {
      parsedVenue = { problems: [`not JSON: ${(e as Error).message}`] };
    }
  }
  const seatCheck = current && csv.trim() !== "" ? parseSeatCsv(csv, current.venue) : null;

  const write = async (label: string, creates: unknown[]) => {
    const ctx = context(evaluation?.head);
    if (!queue || !ctx) return "Connect the organizer wallet first.";
    return describeSubmit(await queue.submit(label, { creates: creates as never }));
  };
  const run = async (f: () => Promise<string[]>) => {
    setBusy(true);
    setLog([]);
    try {
      setLog(await f());
    } catch (e) {
      setLog([(e as Error).message.split("\n")[0]!]);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const publishVenue = () =>
    run(async () => {
      const ctx = context(evaluation?.head)!;
      return [
        await write(`Publish venue ${version}`, [
          buildCreate("venue", ctx, { version, venue: parsedVenue!.venue }),
        ]),
      ];
    });
  const importSeats = () =>
    run(async () => {
      const ctx = context(evaluation?.head)!;
      const rows = seatCheck!.rows;
      const out: string[] = [];
      for (let i = 0; i < rows.length; i += SEATS_PER_BATCH) {
        const chunk = rows.slice(i, i + SEATS_PER_BATCH);
        const creates = chunk.map((r) =>
          buildCreate("seat_assignment", ctx, { ...r, venue: current!.record.key }),
        );
        out.push(
          `Seats ${i + 1}–${i + chunk.length}: ${await write(`Seats ${i + 1}–${i + chunk.length}`, creates)}`,
        );
      }
      return out;
    });

  return (
    <Screen title="Venue & seats" subtitle="Publish the floor plan, then import everyone's assigned seat.">
      {byLabel !== "organizer" && (
        <Banner tone="warning" title="Organizer only">
          Connect the organizer wallet and act as Organizer (configured authority wallet) to publish.
        </Banner>
      )}
      <Banner tone={error ? "danger" : current ? "success" : "neutral"} icon={current ? "map" : "info"}>
        {error ??
          (current
            ? `Current venue: ${current.venue.name} (${String(current.record.attrs.get("version")?.value ?? "")}), ${current.venue.seats.length} seats`
            : "No venue published yet.")}
      </Banner>

      <Card>
        <Step
          n={1}
          title="Publish venue.json"
          right={<Pill label={current ? "Published" : "Not yet"} tone={current ? "success" : "muted"} dot />}
        />
        <Button icon="plus" label="Choose venue.json…" onPress={() => pickFile(setVenueText)} />
        <Field
          value={venueText}
          onChangeText={setVenueText}
          placeholder="…or paste venue.json"
          multiline
          mono
        />
        <Field
          label="Version"
          value={version}
          onChangeText={setVersion}
          placeholder="version, e.g. mumbai-v2"
        />
        {parsedVenue?.problems.map((p) => (
          <Row key={p} gap={6} wrap={false}>
            <Icon name="x" size={14} color={c.danger} />
            <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
              {p}
            </Txt>
          </Row>
        ))}
        <Button
          variant="primary"
          icon="map"
          label="Publish venue"
          disabled={busy || !parsedVenue?.venue || parsedVenue.problems.length > 0 || version.trim() === ""}
          onPress={() => void publishVenue()}
        />
      </Card>

      <Card>
        <Step n={2} title="Import seat assignments" />
        <Txt variant="caption" tone="muted">
          CSV columns: hacker_address, hacker_label, seat (IDs from the current venue).
        </Txt>
        <Button icon="plus" label="Choose CSV…" onPress={() => pickFile(setCsv)} />
        <Field value={csv} onChangeText={setCsv} placeholder="…or paste CSV rows" multiline mono />
        {!current && csv.trim() !== "" && <Banner tone="warning">Publish a venue first.</Banner>}
        {seatCheck?.errors.map((e) => (
          <Row key={e} gap={6} wrap={false}>
            <Icon name="x" size={14} color={c.danger} />
            <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
              {e}
            </Txt>
          </Row>
        ))}
        {seatCheck && seatCheck.errors.length === 0 && (
          <Pill
            tone="success"
            icon="check"
            label={`${seatCheck.rows.length} rows ready (${Math.ceil(seatCheck.rows.length / SEATS_PER_BATCH)} approvals)`}
          />
        )}
        <Button
          variant="primary"
          icon="users"
          label="Write seat assignments"
          disabled={busy || !seatCheck || seatCheck.errors.length > 0 || seatCheck.rows.length === 0}
          onPress={() => void importSeats()}
        />
      </Card>
      {log.map((l) => (
        <Banner key={l} tone={messageTone(l)}>
          {l}
        </Banner>
      ))}
    </Screen>
  );
}
