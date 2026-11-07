import { StyleSheet } from "react-native";
import { light as c, radius } from "@/ui/theme";

// Static light-theme styles for screens that have not moved to the src/ui primitives.
export const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  h2: { fontSize: 18, fontWeight: "700", color: c.text },
  h3: { fontSize: 15, fontWeight: "600", marginTop: 8, color: c.text },
  muted: { color: c.muted },
  mono: { fontFamily: "monospace", fontSize: 13, color: c.text },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
  row: {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: 12,
    gap: 2,
  },
  rowOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceAlt,
    color: c.text,
    borderRadius: radius.sm,
    padding: 10,
    minWidth: 320,
  },
  link: { fontSize: 16, color: c.accent, paddingVertical: 4, fontWeight: "500" },
});
