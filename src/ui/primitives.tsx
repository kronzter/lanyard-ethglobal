// UI primitives for every screen. They only render: every handler, disabled flag, testID and
// accessibility prop is passed straight through to the underlying React Native element.
import { Link, Stack } from "expo-router";
import { type ReactNode, useState } from "react";
import {
  type AccessibilityRole,
  type AccessibilityState,
  type KeyboardTypeOptions,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  Text,
  TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "./Icon";
import { shortAddress } from "./format";
import { mono, radius, space, tabular, type Tone, toneColors, type, useTheme } from "./theme";

// ── Text ───────────────────────────────────────────────────────────────────────────────────────

export type TxtVariant = "display" | "title" | "h2" | "h3" | "body" | "caption" | "label";
export type TxtTone = "text" | "muted" | "faint" | "accent" | "success" | "warning" | "danger" | "onAccent";

export function Txt({
  variant = "body",
  tone = "text",
  mono: isMono,
  num,
  style,
  children,
  ...rest
}: {
  variant?: TxtVariant;
  tone?: TxtTone;
  mono?: boolean;
  num?: boolean;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
  selectable?: boolean;
  numberOfLines?: number;
  testID?: string;
  accessibilityRole?: AccessibilityRole;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const color =
    tone === "text"
      ? c.text
      : tone === "onAccent"
        ? c.accentText
        : tone === "muted"
          ? c.muted
          : tone === "faint"
            ? c.faint
            : c[tone];
  return (
    <Text
      {...rest}
      style={[
        type[variant],
        { color },
        variant === "label" ? { textTransform: "uppercase" } : null,
        isMono ? [mono, { fontSize: 13 }] : null,
        num ? tabular : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────────────────────────

/** A scrolling page: themed background, centred column on wide screens, optional page header. */
export function Screen({
  title,
  navTitle,
  subtitle,
  right,
  children,
  maxWidth = 720,
  testID,
}: {
  title?: string;
  /** Header bar title; defaults to `title`. */
  navTitle?: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  maxWidth?: number;
  testID?: string;
}) {
  const { c } = useTheme();
  const bar = navTitle ?? title;
  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: space.xxl * 2,
        gap: space.lg,
        maxWidth,
        width: "100%",
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      {bar ? <Stack.Screen options={{ title: bar }} /> : null}
      {(title || subtitle || right) && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            {title ? <Txt variant="title">{title}</Txt> : null}
            {typeof subtitle === "string" ? <Txt tone="muted">{subtitle}</Txt> : subtitle}
          </View>
          {right}
        </View>
      )}
      {children}
    </ScrollView>
  );
}

export function Row({
  children,
  gap = space.sm,
  wrap = true,
  align = "center",
  justify,
  style,
}: {
  children?: ReactNode;
  gap?: number;
  wrap?: boolean;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          flexWrap: wrap ? "wrap" : "nowrap",
          gap,
          alignItems: align,
          justifyContent: justify,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Stackv({
  children,
  gap = space.sm,
  style,
  testID,
}: {
  children?: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View testID={testID} style={[{ gap }, style]}>
      {children}
    </View>
  );
}

export function Card({
  children,
  tone = "neutral",
  style,
  testID,
  padded = true,
  dashed,
}: {
  children?: ReactNode;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  padded?: boolean;
  dashed?: boolean;
}) {
  const { c, dark } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: tone === "neutral" ? c.surface : t.bg,
          borderColor: tone === "neutral" ? c.border : tone === "muted" ? c.border : t.border,
          borderWidth: 1,
          borderStyle: dashed ? "dashed" : "solid",
          borderRadius: radius.lg,
          padding: padded ? space.lg : 0,
          gap: space.md,
          overflow: "hidden",
        },
        !dark && tone === "neutral"
          ? Platform.select({
              web: {
                boxShadow: "0 1px 2px rgba(16,16,24,0.04), 0 4px 16px rgba(16,16,24,0.04)",
              } as ViewStyle,
              default: {},
            })
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.border, alignSelf: "stretch" }} />;
}

// ── Controls ───────────────────────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "warning";

export function Button({
  label,
  onPress,
  variant = "secondary",
  disabled,
  full,
  size = "md",
  icon,
  testID,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  full?: boolean;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const solid =
    variant === "primary" || variant === "success" || variant === "warning" || variant === "danger";
  const base =
    variant === "primary"
      ? c.accent
      : variant === "success"
        ? c.success
        : variant === "warning"
          ? c.warning
          : variant === "danger"
            ? c.danger
            : variant === "secondary"
              ? c.surface
              : "transparent";
  const fg = solid
    ? variant === "primary"
      ? c.accentText
      : "#FFFFFF"
    : variant === "ghost"
      ? c.accent
      : c.text;
  const height = size === "sm" ? 34 : size === "lg" ? 52 : 44;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState ?? (disabled ? { disabled: true } : undefined)}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: size === "sm" ? space.md : space.lg,
          borderRadius: radius.pill,
          backgroundColor: base,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor: c.borderStrong,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          alignSelf: full ? "stretch" : "flex-start",
          opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: size === "sm" ? 13 : 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
  icon,
  testID,
  accessibilityRole,
  accessibilityState,
  accessibilityLabel,
  children,
}: {
  label?: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const { c } = useTheme();
  const fg = selected ? c.accent : c.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? c.accent : c.border,
        backgroundColor: selected ? c.accentSoft : c.surface,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      {label !== undefined ? (
        <Text style={{ color: fg, fontSize: 14, fontWeight: selected ? "600" : "500" }}>{label}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

/** A small status label: optional dot or icon, toned background. */
export function Pill({
  label,
  tone = "muted",
  icon,
  dot,
  testID,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  dot?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        backgroundColor: tone === "neutral" ? c.surfaceAlt : t.bg,
      }}
    >
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.fg }} /> : null}
      {icon ? <Icon name={icon} size={13} color={t.fg} /> : null}
      <Text style={{ color: t.fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Field({
  label,
  hint,
  suffix,
  mono: isMono,
  style,
  inputStyle,
  ...input
}: {
  label?: string;
  hint?: string;
  suffix?: string;
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  editable?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Txt variant="h3">{label}</Txt> : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: focus ? c.accent : c.border,
          backgroundColor: c.surfaceAlt,
          borderRadius: radius.sm,
          paddingHorizontal: space.md,
        }}
      >
        <TextInput
          {...input}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholderTextColor={c.faint}
          style={[
            {
              flex: 1,
              minWidth: 0,
              color: c.text,
              fontSize: 15,
              paddingVertical: 11,
              minHeight: input.multiline ? 88 : 44,
              textAlignVertical: input.multiline ? "top" : "center",
            },
            isMono ? mono : null,
            Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null,
            inputStyle,
          ]}
        />
        {suffix ? <Txt tone="muted">{suffix}</Txt> : null}
      </View>
      {hint ? (
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ── Lists and feedback ─────────────────────────────────────────────────────────────────────────

export function ListRow({
  title,
  subtitle,
  left,
  right,
  children,
  onPress,
  selected,
  tone = "neutral",
  dim,
  chevron,
  testID,
  accessibilityRole,
  accessibilityState,
  accessibilityLabel,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  tone?: Tone;
  dim?: boolean;
  chevron?: boolean;
  testID?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const t = toneColors(c, selected ? "accent" : tone);
  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        {left}
        <View style={{ flex: 1, gap: 2 }}>
          {typeof title === "string" ? <Txt variant="h3">{title}</Txt> : title}
          {typeof subtitle === "string" ? (
            <Txt variant="caption" tone="muted">
              {subtitle}
            </Txt>
          ) : (
            subtitle
          )}
        </View>
        {right}
        {chevron ? <Icon name="chevron" size={18} color={c.faint} /> : null}
      </View>
      {children}
    </>
  );
  const style = {
    padding: space.md + 2,
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: selected || tone !== "neutral" ? t.border : c.border,
    backgroundColor: selected || (tone !== "neutral" && tone !== "muted") ? t.bg : c.surface,
    opacity: dim ? 0.55 : 1,
  } as const;
  if (!onPress)
    return (
      <View testID={testID} style={style} accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, pressed ? { opacity: 0.8 } : null]}
    >
      {body}
    </Pressable>
  );
}

export function SectionHeader({ title, right, icon }: { title: string; right?: ReactNode; icon?: IconName }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs }}>
      {icon ? <Icon name={icon} size={16} color={c.muted} /> : null}
      <Txt variant="label" tone="muted" style={{ flex: 1 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

export function EmptyState({
  icon = "info",
  title,
  body,
  children,
  tone = "muted",
  testID,
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  tone?: Tone;
  testID?: string;
}) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View
      testID={testID}
      style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.md }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.bg,
        }}
      >
        <Icon name={icon} size={26} color={t.fg} />
      </View>
      <Txt variant="h2" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {typeof body === "string" ? (
        <Txt tone="muted" style={{ textAlign: "center", maxWidth: 420 }}>
          {body}
        </Txt>
      ) : (
        body
      )}
      {children}
    </View>
  );
}

export function Banner({
  tone = "neutral",
  icon,
  title,
  children,
  testID,
  accessibilityRole,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: string;
  children?: ReactNode;
  testID?: string;
  accessibilityRole?: AccessibilityRole;
}) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  const glyph: IconName =
    icon ?? (tone === "success" ? "check" : tone === "danger" || tone === "warning" ? "alert" : "info");
  return (
    <View
      testID={testID}
      accessibilityRole={accessibilityRole}
      style={{
        flexDirection: "row",
        gap: space.md,
        alignItems: "flex-start",
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: tone === "neutral" ? c.surfaceAlt : t.bg,
      }}
    >
      <View style={{ paddingTop: 1 }}>
        <Icon name={glyph} size={18} color={tone === "neutral" ? c.muted : t.fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text style={{ color: tone === "neutral" ? c.text : t.fg, fontWeight: "600", fontSize: 14 }}>
            {title}
          </Text>
        ) : null}
        {typeof children === "string" ? (
          <Text selectable style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** Tone for a write-outcome message from `describeSubmit` (display only). */
export function messageTone(message: string): Tone {
  if (/^Saved on Arkiv|^Extended|ready|already in that state/i.test(message)) return "success";
  if (/^You cancelled|^Waiting|^Not confirmed|pending/i.test(message)) return "warning";
  if (/fail|error|cannot|could not|not |no /i.test(message)) return "danger";
  return "neutral";
}

export function Disclosure({
  title,
  icon,
  initiallyOpen = false,
  children,
  testID,
}: {
  title: string;
  icon?: IconName;
  initiallyOpen?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View
      testID={testID}
      style={{
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.md,
        backgroundColor: c.surface,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md + 2 }}
      >
        {icon ? <Icon name={icon} size={16} color={c.muted} /> : null}
        <Txt variant="h3" style={{ flex: 1 }}>
          {title}
        </Txt>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={16} color={c.muted} />
        </View>
      </Pressable>
      {open ? <View style={{ padding: space.md + 2, paddingTop: 0, gap: space.md }}>{children}</View> : null}
    </View>
  );
}

export function Address({ value, full, tone = "muted" }: { value: string; full?: boolean; tone?: TxtTone }) {
  return (
    <Txt mono selectable tone={tone}>
      {full ? value : shortAddress(value)}
    </Txt>
  );
}

export function Avatar({
  letter,
  tone = "accent",
  size = 40,
}: {
  letter: string;
  tone?: Tone;
  size?: number;
}) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: t.fg, fontWeight: "700", fontSize: size * 0.42 }}>{letter}</Text>
    </View>
  );
}

export function IconBubble({
  name,
  tone = "accent",
  size = 40,
}: {
  name: IconName;
  tone?: Tone;
  size?: number;
}) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: t.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={name} size={size * 0.5} color={t.fg} />
    </View>
  );
}

export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: Tone }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: t.fg, borderRadius: 3 }} />
    </View>
  );
}

export function Stat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: Tone }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View
      style={{
        flex: 1,
        minWidth: 140,
        padding: space.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        gap: 4,
      }}
    >
      <Text style={[type.title, tabular, { color: tone === "neutral" ? c.text : t.fg }]}>{value}</Text>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
    </View>
  );
}

/** A large navigation tile: icon, title and a one-line purpose. */
export function Tile({
  href,
  icon,
  title,
  body,
  badge,
  tone = "accent",
  testID,
}: {
  href: string;
  icon: IconName;
  title: string;
  body?: string;
  badge?: string;
  tone?: Tone;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Link href={href as never} asChild>
      <Pressable
        testID={testID}
        accessibilityRole="link"
        // Link asChild drops function styles on web, so this one is static.
        style={{
          flexGrow: 1,
          minWidth: 240,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <IconBubble name={icon} tone={tone} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={6}>
            <Txt variant="h3">{title}</Txt>
            {badge ? <Pill label={badge} tone="muted" /> : null}
          </Row>
          {body ? (
            <Txt variant="caption" tone="muted">
              {body}
            </Txt>
          ) : null}
        </View>
        <Icon name="chevron" size={18} color={c.faint} />
      </Pressable>
    </Link>
  );
}

/** A numbered step heading for multi-step setup cards. */
export function Step({ n, title, right }: { n: number; title: string; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: c.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: c.accent, fontWeight: "700", fontSize: 13 }}>{n}</Text>
      </View>
      <Txt variant="h2" style={{ flex: 1 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

/** Centred column for non-scrolling states (placeholders, gates). */
export function Center({ children }: { children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: space.xl,
        backgroundColor: c.bg,
      }}
    >
      {children}
    </View>
  );
}

/** A compact navigation row. */
export function LinkRow({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
}) {
  const { c } = useTheme();
  return (
    <Link href={href as never} asChild>
      <Pressable
        accessibilityRole="link"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingVertical: space.md,
          paddingHorizontal: space.md,
          borderRadius: radius.sm,
        }}
      >
        {icon ? <Icon name={icon} size={18} color={c.muted} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{title}</Txt>
          {subtitle ? (
            <Txt variant="caption" tone="muted">
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <Icon name="chevron" size={16} color={c.faint} />
      </Pressable>
    </Link>
  );
}
