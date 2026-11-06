import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { Circle, Image as SvgImage, Rect } from "react-native-svg";
import mumbaiJson from "../../fixtures/venue.mumbai.json";
import { eventConfig } from "@/shared/event.config";
import { POI_KINDS, type CellRef, type PoiKind, parseVenue } from "@/shared/types/venue";
import {
  type EditorState,
  type History,
  addZone,
  commit,
  createState,
  fromVenue,
  newHistory,
  paintWalkable,
  paintZone,
  placePoi,
  placeSeat,
  removePoiAt,
  removeSeatAt,
  serializeVenue,
  toVenue,
  undo,
  validateVenue,
} from "@/venue/editor";

// The /venue layout wraps this screen in WebOnly, so native shows "Open on web".
// TODO(A3.1): organizer-only gating. No simple session/roles helper exists yet for web consoles.

type Tool = "walk" | "erase" | "seat" | "poi" | "zone" | "delete";
const TOOLS: Tool[] = ["walk", "erase", "seat", "poi", "zone", "delete"];
const MAX_DISPLAY_PX = 1100;

const btn = (on: boolean) => ({
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderWidth: 1,
  borderRadius: 6,
  borderColor: on ? "#2563eb" : "#999",
  backgroundColor: on ? "#dbeafe" : "transparent",
});
const input = { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 6, minWidth: 80 } as const;

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Screen() {
  const [imageUri, setImageUri] = useState("");
  const [widthPx, setWidthPx] = useState("1920");
  const [heightPx, setHeightPx] = useState("1200");
  const [cellPx, setCellPx] = useState("20");
  const [venueId, setVenueId] = useState("venue");
  const [hist, setHist] = useState<History | null>(null);
  const [live, setLive] = useState<EditorState | null>(null);
  const stroke = useRef<EditorState | null>(null);

  const [tool, setTool] = useState<Tool>("walk");
  const [brush, setBrush] = useState(1);
  const [poiKind, setPoiKind] = useState<PoiKind>("help-desk");
  const [partner, setPartner] = useState(eventConfig.partners[0]?.id ?? "");
  const [zoneId, setZoneId] = useState("");
  const [newZone, setNewZone] = useState("");

  const state = live ?? hist?.present ?? null;
  const report = useMemo(() => (state ? validateVenue(toVenue(state), eventConfig) : null), [state]);

  const start = () => {
    const w = Number(widthPx);
    const h = Number(heightPx);
    const c = Number(cellPx);
    if (!(w > 0 && h > 0 && c > 0)) return;
    setHist(
      newHistory(
        createState(
          {
            id: venueId,
            name: venueId,
            image: { uri: imageUri || "venue.png", widthPx: w, heightPx: h },
            cellSizeMm: eventConfig.venue.cellSizeMm,
            cellSizePx: c,
            originPx: { x: 0, y: 0 },
          },
          Math.floor(w / c),
          Math.floor(h / c),
        ),
      ),
    );
  };
  const loadMumbai = () => {
    const v = parseVenue(mumbaiJson);
    setImageUri("");
    setHist(newHistory(fromVenue(v)));
    setZoneId(v.zones[0]?.id ?? "");
  };

  const apply = (s: EditorState, c: CellRef, dragging: boolean): EditorState => {
    switch (tool) {
      case "walk":
        return paintWalkable(s, c, true, brush);
      case "erase":
        return paintWalkable(s, c, false, brush);
      case "zone":
        return paintZone(s, [c], zoneId || null);
      case "seat":
        return dragging ? s : placeSeat(s, c, zoneId || undefined);
      case "poi":
        return dragging
          ? s
          : placePoi(s, c, poiKind, poiKind === "partner-table" ? partner : poiKind, {
              zone: zoneId || undefined,
              partner: poiKind === "partner-table" ? partner : undefined,
            });
      case "delete":
        return removePoiAt(removeSeatAt(s, c), c);
    }
  };

  const scale = state ? Math.min(1, MAX_DISPLAY_PX / state.meta.image.widthPx) : 1;
  const cell = state ? state.meta.cellSizePx * scale : 1;
  const cellAt = (e: { nativeEvent: { offsetX: number; offsetY: number } }): CellRef | null => {
    if (!state) return null;
    const c = { x: Math.floor(e.nativeEvent.offsetX / cell), y: Math.floor(e.nativeEvent.offsetY / cell) };
    return c.x >= 0 && c.y >= 0 && c.x < state.cols && c.y < state.rows ? c : null;
  };
  const down = (e: never) => {
    const c = cellAt(e);
    if (!c || !state) return;
    stroke.current = state;
    setLive(apply(state, c, false));
  };
  const move = (e: never) => {
    const c = cellAt(e);
    if (!c || !stroke.current) return;
    stroke.current = apply(stroke.current, c, true);
    setLive(stroke.current);
  };
  const up = () => {
    if (stroke.current && hist) setHist(commit(hist, stroke.current));
    stroke.current = null;
    setLive(null);
  };
  // Web pointer events; react-native-web forwards these to the DOM.
  const pointer = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerLeave: up } as object;

  const blocked = !report || report.errors.length > 0;
  const walkRects = useMemo(() => {
    if (!state) return [];
    const out: { x: number; y: number; w: number }[] = [];
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        if (!state.mask[y * state.cols + x]) continue;
        let w = 1;
        while (x + w < state.cols && state.mask[y * state.cols + x + w]) w++;
        out.push({ x, y, w });
        x += w - 1;
      }
    }
    return out;
  }, [state]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Venue editor</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <TextInput
          style={{ ...input, minWidth: 260 }}
          placeholder="Floor-plan image URL"
          value={imageUri}
          onChangeText={setImageUri}
        />
        <TextInput style={input} placeholder="Venue id" value={venueId} onChangeText={setVenueId} />
        <TextInput style={input} placeholder="Image width px" value={widthPx} onChangeText={setWidthPx} />
        <TextInput style={input} placeholder="Image height px" value={heightPx} onChangeText={setHeightPx} />
        <TextInput style={input} placeholder="Cell size px" value={cellPx} onChangeText={setCellPx} />
        <Pressable style={btn(false)} onPress={start}>
          <Text>New grid</Text>
        </Pressable>
        <Pressable style={btn(false)} onPress={loadMumbai}>
          <Text>Load Mumbai fixture</Text>
        </Pressable>
      </View>

      {state && hist && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {TOOLS.map((t) => (
              <Pressable key={t} style={btn(tool === t)} onPress={() => setTool(t)}>
                <Text>{t}</Text>
              </Pressable>
            ))}
            <Pressable style={btn(false)} onPress={() => setHist(undo(hist))}>
              <Text>Undo ({hist.past.length})</Text>
            </Pressable>
            <Text>Brush</Text>
            {[1, 3, 5].map((b) => (
              <Pressable key={b} style={btn(brush === b)} onPress={() => setBrush(b)}>
                <Text>{b}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <Text>Zone</Text>
            {state.zones.map((z) => (
              <Pressable key={z.id} style={btn(zoneId === z.id)} onPress={() => setZoneId(z.id)}>
                <Text>{z.id}</Text>
              </Pressable>
            ))}
            <TextInput style={input} placeholder="new-zone-id" value={newZone} onChangeText={setNewZone} />
            <Pressable
              style={btn(false)}
              onPress={() => {
                const id = newZone.trim();
                if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return;
                setHist(commit(hist, addZone(hist.present, { id, name: id })));
                setZoneId(id);
                setNewZone("");
              }}
            >
              <Text>Add zone</Text>
            </Pressable>
            <Text>POI</Text>
            {POI_KINDS.map((k) => (
              <Pressable key={k} style={btn(poiKind === k)} onPress={() => setPoiKind(k)}>
                <Text>{k}</Text>
              </Pressable>
            ))}
            {poiKind === "partner-table" &&
              eventConfig.partners.map((p) => (
                <Pressable key={p.id} style={btn(partner === p.id)} onPress={() => setPartner(p.id)}>
                  <Text>{p.id}</Text>
                </Pressable>
              ))}
          </View>

          <ScrollView horizontal>
            <View
              {...pointer}
              style={
                {
                  width: state.cols * cell,
                  height: state.rows * cell,
                  userSelect: "none",
                  touchAction: "none",
                } as object
              }
            >
              <Svg width={state.cols * cell} height={state.rows * cell}>
                <Rect width={state.cols * cell} height={state.rows * cell} fill="#e5e7eb" />
                {imageUri !== "" && (
                  <SvgImage
                    href={imageUri}
                    width={state.meta.image.widthPx * scale}
                    height={state.meta.image.heightPx * scale}
                    opacity={0.5}
                  />
                )}
                {walkRects.map((r) => (
                  <Rect
                    key={`${r.x},${r.y}`}
                    x={r.x * cell}
                    y={r.y * cell}
                    width={r.w * cell}
                    height={cell}
                    fill="#22c55e"
                    opacity={0.45}
                  />
                ))}
                {state.seats.map((s) => (
                  <Rect
                    key={s.id}
                    x={s.cell.x * cell + cell * 0.2}
                    y={s.cell.y * cell + cell * 0.2}
                    width={cell * 0.6}
                    height={cell * 0.6}
                    fill="#2563eb"
                  />
                ))}
                {state.pois.map((p) => (
                  <Circle
                    key={p.id}
                    cx={p.cell.x * cell + cell / 2}
                    cy={p.cell.y * cell + cell / 2}
                    r={cell * 0.45}
                    fill={
                      p.kind === "help-desk" ? "#dc2626" : p.kind === "partner-table" ? "#9333ea" : "#f59e0b"
                    }
                  />
                ))}
              </Svg>
            </View>
          </ScrollView>

          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: "600" }}>
              Validation ({state.seats.length} seats, {state.pois.length} POIs, {report?.bytes} bytes)
            </Text>
            {report?.errors.map((e, i) => (
              <Text key={`e${i}`} style={{ color: "#b91c1c" }}>
                {e.rule}: {e.message}
              </Text>
            ))}
            {report?.warnings.map((w, i) => (
              <Text key={`w${i}`} style={{ color: "#b45309" }}>
                {w.rule}: {w.message}
              </Text>
            ))}
            {report && report.errors.length === 0 && (
              <Text style={{ color: "#15803d" }}>No blocking errors.</Text>
            )}
          </View>

          <Pressable
            disabled={blocked}
            accessibilityState={{ disabled: blocked }}
            style={{ ...btn(false), opacity: blocked ? 0.4 : 1, alignSelf: "flex-start" }}
            onPress={() => !blocked && download("venue.json", serializeVenue(toVenue(state)))}
          >
            <Text>Export venue.json</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
