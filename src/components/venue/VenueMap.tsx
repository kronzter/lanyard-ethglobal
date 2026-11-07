// A3.3's real venue map: floor plan, seats, POIs and the walking path, with pan and pinch-zoom on
// Android and web. It takes the shared VenueMapProps (A3.3-R1), so I3 swaps it in for the stub
// without screen changes.
//
// Gestures run on the UI thread and move one transform (src/venue/map-view.ts). Seat taps don't
// rely on SVG hit-testing: the tap point is mapped back through that transform to the nearest
// seat, so the right seat is reported after any pan, zoom or rotation (A3.3-R3). A layout change
// (rotation, window resize) re-fits the map.
import { type ComponentRef, useCallback, useMemo, useRef } from "react";
import { type LayoutChangeEvent, Pressable, Text as Label, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, G, Image, Polyline, Rect, Text } from "react-native-svg";
import type { VenueMapProps } from "@/shared/interfaces/venue-map";
import { cellCenterPx, mapMarkers, pathPoints, walkableRects } from "@/venue/map-geometry";
import { MIN_SCALE, type Size, clampPan, screenToImage, seatAt, zoomAbout } from "@/venue/map-view";

const COLORS = {
  wall: "#3f3f46",
  floor: "#f4f4f5",
  seat: "#2563eb",
  poi: "#16a34a",
  highlight: "#f59e0b",
  path: "#dc2626",
  helper: "#7c3aed",
  label: "#18181b",
  halo: "#ffffff",
};

// Only absolute image URIs load; a venue's bare file name (as in the fixtures) draws no image.
const loadable = (uri: string) => /^(https?:|data:|file:)/.test(uri);

export function VenueMap({ venue, highlight, path, onSeatTap }: VenueMapProps) {
  const { uri, widthPx, heightPx } = venue.image;
  const image = useMemo<Size>(() => ({ width: widthPx, height: heightPx }), [widthPx, heightPx]);
  const floor = useMemo(() => walkableRects(venue), [venue]);
  const markers = useMemo(() => mapMarkers(venue, highlight), [venue, highlight]);
  const line = pathPoints(venue, path);
  const helper = path && path.length > 0 ? cellCenterPx(venue, path[0]!) : null;
  const target = path && path.length > 1 ? cellCenterPx(venue, path[path.length - 1]!) : null;
  const cell = venue.grid.cellSizePx;
  const font = cell * 0.45;

  const viewSize = useSharedValue<Size>({ width: 1, height: 1 });
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lastPan = useSharedValue({ x: 0, y: 0 });

  // The tap handler may be captured once by the gesture, so it reads everything current from here.
  const latest = useRef({ venue, image, onSeatTap });
  const frame = useRef<ComponentRef<typeof View>>(null);
  latest.current = { venue, image, onSeatTap };

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      viewSize.value = { width, height };
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
    },
    [viewSize, scale, tx, ty],
  );

  // Both gestures apply small increments to the current transform, so pan and pinch compose.
  const pan = usePanGesture({
    minDistance: 6,
    onBegin: () => {
      lastPan.value = { x: 0, y: 0 };
    },
    onUpdate: (e) => {
      const t = clampPan(
        {
          scale: scale.value,
          tx: tx.value + e.translationX - lastPan.value.x,
          ty: ty.value + e.translationY - lastPan.value.y,
        },
        viewSize.value,
      );
      lastPan.value = { x: e.translationX, y: e.translationY };
      tx.value = t.tx;
      ty.value = t.ty;
    },
  });
  const pinch = usePinchGesture({
    onUpdate: (e) => {
      const t = zoomAbout(
        { scale: scale.value, tx: tx.value, ty: ty.value },
        { x: e.focalX, y: e.focalY },
        scale.value * e.scaleChange,
        viewSize.value,
      );
      scale.value = t.scale;
      tx.value = t.tx;
      ty.value = t.ty;
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (e) => {
      const { venue: v, image: img, onSeatTap: report } = latest.current;
      if (!report) return;
      // Measure now rather than trust the last onLayout, which can lag a resize on web.
      const x = e.x;
      const y = e.y;
      frame.current?.measure((_fx, _fy, width, height) => {
        if (width > 0 && height > 0) viewSize.value = { width, height };
        const at = screenToImage({ x, y }, viewSize.value, img, {
          scale: scale.value,
          tx: tx.value,
          ty: ty.value,
        });
        const seat = seatAt(v, at);
        if (seat) report(seat);
      });
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch, tap);

  // Buttons zoom about the centre: pinch needs touch, so desktop web would have no zoom otherwise.
  const zoomBy = useCallback(
    (factor: number | null) => {
      const v = viewSize.value;
      const t =
        factor === null
          ? { scale: MIN_SCALE, tx: 0, ty: 0 }
          : zoomAbout(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              { x: v.width / 2, y: v.height / 2 },
              scale.value * factor,
              v,
            );
      scale.value = t.scale;
      tx.value = t.tx;
      ty.value = t.ty;
    },
    [viewSize, scale, tx, ty],
  );

  const moved = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureHandlerRootView style={{ width: "100%", aspectRatio: widthPx / heightPx }}>
      <GestureDetector gesture={gesture}>
        <View
          ref={frame}
          style={{ flex: 1, overflow: "hidden", backgroundColor: COLORS.wall }}
          onLayout={onLayout}
          accessibilityLabel={`${venue.name} map`}
        >
          <Animated.View style={[{ flex: 1 }, moved]}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${widthPx} ${heightPx}`}>
              <Rect x={0} y={0} width={widthPx} height={heightPx} fill={COLORS.wall} />
              {floor.map((r) => (
                // The same-colour stroke hides anti-aliasing seams between neighbouring rows.
                <Rect
                  key={`${r.x},${r.y}`}
                  {...r}
                  fill={COLORS.floor}
                  stroke={COLORS.floor}
                  strokeWidth={1}
                />
              ))}
              {loadable(uri) && (
                <Image
                  href={uri}
                  x={0}
                  y={0}
                  width={widthPx}
                  height={heightPx}
                  preserveAspectRatio="none"
                  opacity={0.6}
                />
              )}
              {markers.map((m) => {
                if (m.highlighted) return null;
                const size = cell * 0.28;
                return m.kind === "seat" ? (
                  <Circle key={`seat:${m.id}`} cx={m.at.x} cy={m.at.y} r={size} fill={COLORS.seat} />
                ) : (
                  <Rect
                    key={`poi:${m.id}`}
                    x={m.at.x - size}
                    y={m.at.y - size}
                    width={size * 2}
                    height={size * 2}
                    fill={COLORS.poi}
                  />
                );
              })}
              {line !== "" && (
                <Polyline
                  points={line}
                  fill="none"
                  stroke={COLORS.path}
                  strokeWidth={cell * 0.18}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {target && <Circle cx={target.x} cy={target.y} r={cell * 0.22} fill={COLORS.path} />}
              {helper && (
                <G accessibilityLabel="Your position">
                  <Circle cx={helper.x} cy={helper.y} r={cell * 0.45} fill={COLORS.halo} />
                  <Circle cx={helper.x} cy={helper.y} r={cell * 0.32} fill={COLORS.helper} />
                </G>
              )}
              {/* Highlighted seats and POIs draw last, with labels, so nothing covers them. */}
              {markers
                .filter((m) => m.highlighted)
                .map((m) => {
                  const size = cell * 0.4;
                  return (
                    <G key={`hl:${m.kind}:${m.id}`}>
                      {m.kind === "seat" ? (
                        <Circle cx={m.at.x} cy={m.at.y} r={size} fill={COLORS.highlight} />
                      ) : (
                        <Rect
                          x={m.at.x - size}
                          y={m.at.y - size}
                          width={size * 2}
                          height={size * 2}
                          fill={COLORS.highlight}
                        />
                      )}
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
                    </G>
                  );
                })}
            </Svg>
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={{ position: "absolute", right: 8, top: 8, gap: 6 }}>
        {(
          [
            ["+", "Zoom in", 1.6],
            ["−", "Zoom out", 1 / 1.6],
            ["⤢", "Fit map", null],
          ] as const
        ).map(([glyph, label, factor]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => zoomBy(factor)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.92)",
            }}
          >
            <Label style={{ fontSize: 20, fontWeight: "600", color: COLORS.label }}>{glyph}</Label>
          </Pressable>
        ))}
      </View>
    </GestureHandlerRootView>
  );
}

export default VenueMap;
