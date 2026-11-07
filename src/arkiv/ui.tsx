// Small shared pieces for the field screens: times, write outcomes and the fake-mode clock.
import { Card, Chip, Icon, Row, Txt, useTheme } from "@/ui";
import type { SubmitResult } from "./queue";

/** A chain timestamp as local wall-clock time (display only; decisions use block time). */
export const clockTime = (seconds: bigint): string =>
  new Date(Number(seconds) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function countdown(seconds: bigint): string {
  if (seconds <= 0n) return "0:00";
  const h = seconds / 3600n;
  const m = (seconds % 3600n) / 60n;
  const s = seconds % 60n;
  const mm = m.toString().padStart(2, "0");
  return h > 0n ? `${h}:${mm}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
}

/** What happened to a write, in words for the screen. */
export function describeSubmit(r: SubmitResult): string {
  switch (r.status) {
    case "verified":
    case "confirmed":
      return "Saved on Arkiv.";
    case "rejected":
      return "You cancelled this in your wallet. Nothing was sent.";
    case "blocked":
      return `Waiting on an earlier write: ${r.message}`;
    case "uncertain":
      return `Not confirmed yet: ${r.message}. It will not be resent automatically.`;
    case "failed":
      return `Failed: ${r.message}`;
  }
}

/** Fake mode only: move the development chain's clock forward. */
export function DevClock(props: { now: bigint | null; onAdvance: (seconds: bigint) => void }) {
  const { c } = useTheme();
  return (
    <Card dashed tone="muted" style={{ paddingVertical: 10, gap: 8 }}>
      <Row gap={6}>
        <Icon name="clock" size={14} color={c.muted} />
        <Txt variant="caption" tone="muted">
          Dev clock · chain time {props.now === null ? "…" : clockTime(props.now)}
        </Txt>
      </Row>
      <Row gap={6}>
        {[300n, 900n, 3600n].map((s) => (
          <Chip key={s.toString()} onPress={() => props.onAdvance(s)} label={`+${Number(s / 60n)} min`} />
        ))}
      </Row>
    </Card>
  );
}
