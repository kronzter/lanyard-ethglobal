import { Text, View } from "react-native";
import { routeInfo } from "./routes";

/** A route that exists in P0 but is filled by a later phase (P0.5-R1). */
export function Placeholder({ path }: { path: string }) {
  const r = routeInfo(path);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>{r.title}</Text>
      <Text style={{ marginTop: 8, textAlign: "center" }}>
        For {r.audience}. Track {r.owner} builds this screen in {r.phase}.
      </Text>
    </View>
  );
}
