// P0.5 stand-in for A3.3's real map (P0.5-R5): floor plan, seats, POIs and a straight path, with
// no pan or zoom. It takes the shared VenueMapProps, so I3 swaps it out without screen changes.
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Image, Polyline, Rect, Text } from "react-native-svg";
import type { VenueMapProps } from "@/shared/interfaces/venue-map";
import { cellCenterPx, mapMarkers, pathPoints, walkableRects } from "@/venue/map-geometry";

const COLORS = {
  wall: "#DCDCE4",
  floor: "#FFFFFF",
  seat: "#A5A8B8",
  poi: "#10B981",
  highlight: "#F59E0B",
  path: "#4F46E5",
  label: "#111114",
};

// The stub only loads absolute image URIs. How a venue's bare file name (as in the fixtures)
// becomes a loadable asset is decided when venues are published (A3.1/B3.3).
const loadable = (uri: string) => /^(https?:|data:|file:)/.test(uri);

export function StubVenueMap({ venue, highlight, path, onSeatTap }: VenueMapProps) {
  const { uri, widthPx, heightPx } = venue.image;
  const floor = useMemo(() => walkableRects(venue), [venue]);
  const markers = useMemo(() => mapMarkers(venue, highlight), [venue, highlight]);
  const line = pathPoints(venue, path);
  const start = line && path ? cellCenterPx(venue, path[0]!) : null;
  const cell = venue.grid.cellSizePx;
  const font = cell * 0.35;

  return (
    <View style={{ width: "100%", aspectRatio: widthPx / heightPx }} accessibilityLabel={`${venue.name} map`}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${widthPx} ${heightPx}`}>
        <Rect x={0} y={0} width={widthPx} height={heightPx} fill={COLORS.wall} />
        {floor.map((r) => (
          // The same-colour stroke hides anti-aliasing seams between neighbouring rows.
          <Rect key={`${r.x},${r.y}`} {...r} fill={COLORS.floor} stroke={COLORS.floor} strokeWidth={1} />
        ))}
        {loadable(uri) && (
          <Image
            href={uri}
            x={0}
            y={0}
            width={widthPx}
            height={heightPx}
            preserveAspectRatio="none"
            opacity={0.45}
          />
        )}
        {line !== "" && (
          <Polyline
            points={line}
            fill="none"
            stroke={COLORS.path}
            strokeWidth={cell * 0.15}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {start && <Circle cx={start.x} cy={start.y} r={cell * 0.2} fill={COLORS.path} />}
        {markers.map((m) => {
          const size = m.highlighted ? cell * 0.4 : cell * 0.28;
          const fill = m.highlighted ? COLORS.highlight : m.kind === "seat" ? COLORS.seat : COLORS.poi;
          const tap = m.kind === "seat" && onSeatTap ? () => onSeatTap(m.id) : undefined;
          return (
            <G key={`${m.kind}:${m.id}`} onPress={tap}>
              {tap && <Circle cx={m.at.x} cy={m.at.y} r={cell / 2} fill="rgba(0,0,0,0)" />}
              {m.kind === "seat" ? (
                <Circle
                  cx={m.at.x}
                  cy={m.at.y}
                  r={size}
                  fill={fill}
                  {...(m.highlighted ? { stroke: "#FFFFFF", strokeWidth: cell * 0.08 } : {})}
                />
              ) : (
                <Rect x={m.at.x - size} y={m.at.y - size} width={size * 2} height={size * 2} fill={fill} />
              )}
              {m.highlighted && (
                <Text
                  x={m.at.x}
                  y={m.at.y - size - font * 0.4}
                  fontSize={font}
                  fontWeight="600"
                  fontFamily="sans-serif"
                  fill={COLORS.label}
                  textAnchor="middle"
                >
                  {m.label}
                </Text>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

export default StubVenueMap;
