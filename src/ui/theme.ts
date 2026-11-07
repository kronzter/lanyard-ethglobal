// Design tokens for the app UI: one light and one dark palette, a spacing/radius/type scale,
// and a hook that picks the palette from the system colour scheme. Display only.
import { useColorScheme } from "react-native";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
};

export const light: Palette = {
  bg: "#F6F6F8",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F1F4",
  border: "#E6E6EB",
  borderStrong: "#D4D4DC",
  text: "#111114",
  muted: "#6B6B76",
  faint: "#A1A1AB",
  accent: "#4F46E5",
  accentText: "#FFFFFF",
  accentSoft: "#EEF0FF",
  success: "#15803D",
  successSoft: "#E8F7EE",
  warning: "#B45309",
  warningSoft: "#FFF5E5",
  danger: "#DC2626",
  dangerSoft: "#FEECEC",
  overlay: "rgba(255,255,255,0.92)",
};

export const dark: Palette = {
  bg: "#0B0B0F",
  surface: "#15151B",
  surfaceAlt: "#1D1D25",
  border: "#26262F",
  borderStrong: "#34343F",
  text: "#F2F2F5",
  muted: "#9A9AA6",
  faint: "#62626E",
  accent: "#8B85FF",
  accentText: "#0B0B0F",
  accentSoft: "#1F1D3A",
  success: "#4ADE80",
  successSoft: "#12261A",
  warning: "#FBBF24",
  warningSoft: "#2A2111",
  danger: "#F87171",
  dangerSoft: "#2C1416",
  overlay: "rgba(21,21,27,0.92)",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const type = {
  display: { fontSize: 34, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: "700" as const },
  h3: { fontSize: 15, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  caption: { fontSize: 13, fontWeight: "400" as const },
  label: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.4 },
};
export const mono = { fontFamily: "monospace" } as const;
export const tabular = { fontVariant: ["tabular-nums" as const] };

export function useTheme(): { c: Palette; dark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return { c: isDark ? dark : light, dark: isDark };
}

/** Foreground and soft background for a tone. */
export function toneColors(c: Palette, tone: Tone): { fg: string; bg: string; border: string } {
  switch (tone) {
    case "accent":
      return { fg: c.accent, bg: c.accentSoft, border: c.accent };
    case "success":
      return { fg: c.success, bg: c.successSoft, border: c.success };
    case "warning":
      return { fg: c.warning, bg: c.warningSoft, border: c.warning };
    case "danger":
      return { fg: c.danger, bg: c.dangerSoft, border: c.danger };
    case "muted":
      return { fg: c.muted, bg: c.surfaceAlt, border: c.border };
    case "neutral":
      return { fg: c.text, bg: c.surface, border: c.border };
  }
}
