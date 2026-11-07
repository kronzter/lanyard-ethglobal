// Display-only formatting helpers.

/** `0x1234…abcd` for an address or other long hex value. */
export const shortAddress = (a: string, head = 6, tail = 4): string =>
  a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;

/** A record key shortened for captions; the full key stays selectable elsewhere. */
export const shortKey = (k: string): string => shortAddress(k, 8, 6);

/** First letter of a label for avatar circles: `priya.volunteers` → `P`. */
export const initial = (label: string): string => (label.trim()[0] ?? "?").toUpperCase();

/** `priya.volunteers` → `priya`; `zkpay-b.hackers` → `zkpay-b`. */
export const firstLabel = (label: string): string => label.split(".")[0] ?? label;

/** Capitalise the first letter of a word. */
export const titleCase = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
