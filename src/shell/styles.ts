import { StyleSheet } from "react-native";

// Plain shell styles; the real look arrives with each phase's screens.
export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#d4d4d8", borderRadius: 8, padding: 16, gap: 8 },
  h2: { fontSize: 18, fontWeight: "600" },
  h3: { fontSize: 15, fontWeight: "600", marginTop: 8 },
  muted: { color: "#52525b" },
  mono: { fontFamily: "monospace" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#a1a1aa",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipOn: { backgroundColor: "#dbeafe", borderColor: "#2563eb" },
  row: { borderWidth: 1, borderColor: "#d4d4d8", borderRadius: 8, padding: 12, gap: 2 },
  rowOn: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  input: { borderWidth: 1, borderColor: "#a1a1aa", borderRadius: 6, padding: 8, minWidth: 320 },
  link: { fontSize: 16, color: "#2563eb", paddingVertical: 4 },
});
