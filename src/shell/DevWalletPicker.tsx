// Mock mode only, beside the real wallet button (P0.5-R3): act as a fixture persona's wallet,
// or paste any address, at a chosen moment of the fixture chain. Roles still come from the
// IdentityDirectory; the persona list only supplies addresses.
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import personasJson from "../../fixtures/personas.json";
import { parsePersonas } from "@/shared/fixtures/personas";
import { fixtureTimeline } from "@/shared/mocks/fixtures";
import { type Address, isAddress } from "@/shared/types/primitives";
import { DEFAULT_MOCK_MOMENT, mockMoments } from "./mock-clock";
import { useSession } from "./session";
import { styles } from "./styles";

export function DevWalletPicker() {
  const session = useSession();
  const personas = useMemo(() => parsePersonas(personasJson).personas, []);
  const moments = useMemo(() => mockMoments(fixtureTimeline()), []);
  const [momentId, setMomentId] = useState(DEFAULT_MOCK_MOMENT);
  const [pasted, setPasted] = useState("");
  const block = moments.find((m) => m.id === momentId)!.block;
  const connect = (address: Address) => session.connect(address, { sepoliaBlock: block });
  const pastedOk = isAddress(pasted.trim().toLowerCase());

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Connect a test wallet (mock mode)</Text>
      <Text style={styles.muted}>
        Pick a fixture wallet instead of a real one. Its roles are read from the mock ENS chain at the chosen
        moment.
      </Text>

      <Text style={styles.h3}>Moment</Text>
      <View style={styles.wrap}>
        {moments.map((m) => (
          <Pressable
            key={m.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: m.id === momentId }}
            onPress={() => setMomentId(m.id)}
            style={[styles.chip, m.id === momentId && styles.chipOn]}
          >
            <Text>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.h3}>Wallets</Text>
      <View style={styles.wrap}>
        {personas.map((p) => {
          // Every team has a "Person A"; the team tells them apart.
          const name = p.team ? `${p.displayName} (${p.team})` : p.displayName;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Connect as ${name}`}
              onPress={() => connect(p.address as Address)}
              style={styles.chip}
            >
              <Text>
                {name} <Text style={styles.muted}>· {p.role}</Text>
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.h3}>Any address</Text>
      <View style={[styles.wrap, { alignItems: "center" }]}>
        <TextInput
          value={pasted}
          onChangeText={setPasted}
          placeholder="0x…"
          autoCapitalize="none"
          accessibilityLabel="Wallet address"
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!pastedOk}
          onPress={() => connect(pasted.trim().toLowerCase() as Address)}
          style={[styles.chip, !pastedOk && { opacity: 0.4 }]}
        >
          <Text>Connect</Text>
        </Pressable>
      </View>
    </View>
  );
}
