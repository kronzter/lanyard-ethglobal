// The connected wallet's roles (P0.5-R6): an active-role selector when it has any, and an
// onboarding path when it has none. Names are built forward from labels, for display only.
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { providers } from "@/providers";
import { ensName, roleKey, roleTitle, screensFor, type ShellRole } from "./roles";
import { routeInfo } from "./routes";
import { useSession } from "./session";
import { styles } from "./styles";

const names = { edition: providers.config.edition, baseName: providers.config.baseName };

const subtitle = (r: ShellRole) =>
  r.kind === "authority" ? "Configured authority wallet" : ensName(r.label, names);

export function RolePanel() {
  const { address, at, lookup, active, choose, disconnect } = useSession();
  if (!address) return null;

  return (
    <View style={styles.card}>
      <View style={[styles.wrap, { justifyContent: "space-between", alignItems: "center" }]}>
        <Text>
          Wallet <Text style={styles.mono}>{address}</Text>
          {at ? <Text style={styles.muted}> · block {at.sepoliaBlock.toString()}</Text> : null}
        </Text>
        <Pressable accessibilityRole="button" onPress={disconnect} style={styles.chip}>
          <Text>Switch wallet</Text>
        </Pressable>
      </View>

      {lookup.state === "loading" && <Text style={styles.muted}>Reading your badges…</Text>}
      {lookup.state === "failed" && <Text style={{ color: "#b91c1c" }}>{lookup.message}</Text>}

      {lookup.state === "ready" && lookup.roles.length === 0 && (
        <View testID="onboarding" style={{ gap: 6 }}>
          <Text style={styles.h2}>No Lanyard badge on this wallet yet</Text>
          <Text>
            Go to the onboarding desk and show this address. The desk issues your badge and sends tGLM for
            Arkiv gas. Public team pages stay open to everyone meanwhile.
          </Text>
        </View>
      )}

      {lookup.state === "ready" && lookup.roles.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.h2}>{lookup.roles.length > 1 ? "Act as" : "Your role"}</Text>
          {lookup.roles.map((r) => {
            const on = active !== null && roleKey(active) === roleKey(r);
            return (
              <Pressable
                key={roleKey(r)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={roleTitle(r)}
                onPress={() => choose(r)}
                style={[styles.row, on && styles.rowOn]}
              >
                <Text style={{ fontWeight: "600" }}>{roleTitle(r)}</Text>
                <Text style={styles.muted}>{subtitle(r)}</Text>
              </Pressable>
            );
          })}
          {active && <Screens role={active} />}
        </View>
      )}
    </View>
  );
}

function Screens({ role }: { role: ShellRole }) {
  const screens = screensFor(role);
  if (screens.length === 0)
    return (
      <Text style={styles.muted}>
        {role.kind === "authority" && role.authority === "results"
          ? "The results key acts only through the local freeze CLI."
          : "This badge opens no screens."}
      </Text>
    );
  return (
    <View testID="role-screens">
      <Text style={styles.h3}>Screens</Text>
      {screens.map((s) => (
        <Link key={s} href={s as never} style={styles.link}>
          {routeInfo(s).title}
          {routeInfo(s).webOnly ? " (web only)" : ""}
        </Link>
      ))}
    </View>
  );
}
