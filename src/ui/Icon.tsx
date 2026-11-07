// A small stroke icon set drawn with react-native-svg (24×24 grid, 2px strokes).
import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
  | "check"
  | "x"
  | "clock"
  | "ticket"
  | "pin"
  | "star"
  | "shield"
  | "user"
  | "users"
  | "chevron"
  | "alert"
  | "lock"
  | "info"
  | "map"
  | "wallet"
  | "gavel"
  | "trophy"
  | "badge"
  | "drop"
  | "list"
  | "monitor"
  | "phone"
  | "plus"
  | "refresh"
  | "link"
  | "key";

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  const p = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shape(name, p)}
    </Svg>
  );
}

type P = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
  fill: string;
};

function shape(name: IconName, p: P) {
  switch (name) {
    case "check":
      return <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />;
    case "x":
      return <Path d="M6 6l12 12M18 6L6 18" {...p} />;
    case "clock":
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 7v5l3 2" {...p} />
        </>
      );
    case "ticket":
      return (
        <Path
          d="M4 7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 6v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-6V7zM14 5v14"
          {...p}
        />
      );
    case "pin":
      return (
        <>
          <Path d="M12 21s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z" {...p} />
          <Circle cx={12} cy={9} r={2.5} {...p} />
        </>
      );
    case "star":
      return (
        <Path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" {...p} />
      );
    case "shield":
      return <Path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z" {...p} />;
    case "user":
      return (
        <>
          <Circle cx={12} cy={8} r={4} {...p} />
          <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...p} />
        </>
      );
    case "users":
      return (
        <>
          <Circle cx={9} cy={8} r={3.5} {...p} />
          <Path
            d="M2.5 20c1.2-3.4 3.6-5 6.5-5s5.3 1.6 6.5 5M16 4.6a3.5 3.5 0 010 6.8M18 15c1.8.6 3 2.3 3.6 5"
            {...p}
          />
        </>
      );
    case "chevron":
      return <Path d="M9 5l7 7-7 7" {...p} />;
    case "alert":
      return (
        <>
          <Path d="M12 4l9 16H3l9-16z" {...p} />
          <Path d="M12 10v4M12 17.5v.01" {...p} />
        </>
      );
    case "lock":
      return (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...p} />
          <Path d="M8 11V8a4 4 0 018 0v3" {...p} />
        </>
      );
    case "info":
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 11v5M12 7.5v.01" {...p} />
        </>
      );
    case "map":
      return <Path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20" {...p} />;
    case "wallet":
      return (
        <>
          <Rect x={3} y={6} width={18} height={14} rx={2.5} {...p} />
          <Path d="M3 10h18M16.5 15h.01M6 6l9-3 1 3" {...p} />
        </>
      );
    case "gavel":
      return <Path d="M14 4l6 6M11 7l6 6M12.5 5.5l-4 4 6 6 4-4M10.5 13.5L4 20M3 21h8" {...p} />;
    case "trophy":
      return (
        <Path
          d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8M9.5 17h5"
          {...p}
        />
      );
    case "badge":
      return (
        <>
          <Rect x={5} y={3} width={14} height={18} rx={2.5} {...p} />
          <Circle cx={12} cy={10} r={2.5} {...p} />
          <Path d="M8.5 16.5c.8-1.5 2-2.2 3.5-2.2s2.7.7 3.5 2.2M10 3v2h4V3" {...p} />
        </>
      );
    case "drop":
      return <Path d="M12 3.5s6 6.4 6 10.5a6 6 0 01-12 0c0-4.1 6-10.5 6-10.5z" {...p} />;
    case "list":
      return <Path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...p} />;
    case "monitor":
      return (
        <>
          <Rect x={3} y={4} width={18} height={12} rx={2} {...p} />
          <Path d="M8 20h8M12 16v4" {...p} />
        </>
      );
    case "phone":
      return (
        <Path
          d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"
          {...p}
        />
      );
    case "plus":
      return <Path d="M12 5v14M5 12h14" {...p} />;
    case "refresh":
      return <Path d="M20 11a8 8 0 00-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.9L20 16M20 20v-4h-4" {...p} />;
    case "link":
      return (
        <Path
          d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"
          {...p}
        />
      );
    case "key":
      return (
        <>
          <Circle cx={8} cy={15} r={4} {...p} />
          <Path d="M11 12l9-9M16 7l3 3M14 9l2 2" {...p} />
        </>
      );
  }
}
