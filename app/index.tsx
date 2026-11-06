import { Text, View } from "react-native";

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Lanyard · mumbai2026</Text>
      <Text style={{ marginTop: 8, textAlign: "center" }}>
        App shell placeholder. Role selection arrives with P0.5.
      </Text>
    </View>
  );
}
