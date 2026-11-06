// /organizer/seats (web-only, B3.3-R1, R4, R6): publish a venue.json as a readonly `venue` record
// and import seat assignments from a CSV, both signed by the organizer wallet. Everything is
// checked first: zones, help desks and partner tables for the venue; label shape, seat IDs from the
// current venue and duplicates for the CSV. The rules decide again what counts.
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useEvaluation, useWriter } from "@/arkiv/app-hooks";
import { parseSeatCsv, venueProblems } from "@/arkiv/seat-import";
import { describeSubmit } from "@/arkiv/ui";
import { buildCreate } from "@/arkiv/writers";
import { providers } from "@/providers";
import { parseJsonStrict } from "@/shared/canonical";
import { styles } from "@/shell/styles";

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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={styles.h2}>Venue and seats</Text>
      {byLabel !== "organizer" && (
        <Text>
          Connect the organizer wallet and act as Organizer (configured authority wallet) to publish.
        </Text>
      )}
      <Text style={styles.muted}>
        {error ??
          (current
            ? `Current venue: ${current.venue.name} (${String(current.record.attrs.get("version")?.value ?? "")}), ${current.venue.seats.length} seats`
            : "No venue published yet.")}
      </Text>

      <View style={styles.card}>
        <Text style={styles.h3}>Publish venue.json</Text>
        <View style={styles.wrap}>
          <Pressable style={styles.chip} onPress={() => pickFile(setVenueText)}>
            <Text>Choose venue.json…</Text>
          </Pressable>
        </View>
        <TextInput
          value={venueText}
          onChangeText={setVenueText}
          placeholder="…or paste venue.json"
          multiline
          numberOfLines={4}
          style={[styles.input, styles.mono]}
        />
        <TextInput
          value={version}
          onChangeText={setVersion}
          placeholder="version, e.g. mumbai-v2"
          style={styles.input}
        />
        {parsedVenue?.problems.map((p) => (
          <Text key={p}>✗ {p}</Text>
        ))}
        <Pressable
          style={styles.chip}
          disabled={busy || !parsedVenue?.venue || parsedVenue.problems.length > 0 || version.trim() === ""}
          onPress={() => void publishVenue()}
        >
          <Text>Publish venue</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.h3}>Import seat assignments</Text>
        <Text style={styles.muted}>
          CSV columns: hacker_address, hacker_label, seat (IDs from the current venue).
        </Text>
        <View style={styles.wrap}>
          <Pressable style={styles.chip} onPress={() => pickFile(setCsv)}>
            <Text>Choose CSV…</Text>
          </Pressable>
        </View>
        <TextInput
          value={csv}
          onChangeText={setCsv}
          placeholder="…or paste CSV rows"
          multiline
          numberOfLines={4}
          style={[styles.input, styles.mono]}
        />
        {!current && csv.trim() !== "" && <Text>Publish a venue first.</Text>}
        {seatCheck?.errors.map((e) => (
          <Text key={e}>✗ {e}</Text>
        ))}
        {seatCheck && seatCheck.errors.length === 0 && (
          <Text style={styles.muted}>
            {seatCheck.rows.length} rows ready ({Math.ceil(seatCheck.rows.length / SEATS_PER_BATCH)}{" "}
            approvals)
          </Text>
        )}
        <Pressable
          style={styles.chip}
          disabled={busy || !seatCheck || seatCheck.errors.length > 0 || seatCheck.rows.length === 0}
          onPress={() => void importSeats()}
        >
          <Text>Write seat assignments</Text>
        </Pressable>
      </View>
      {log.map((l) => (
        <Text key={l}>{l}</Text>
      ))}
    </ScrollView>
  );
}
