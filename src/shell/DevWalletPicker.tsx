// Mock mode only, beside the real wallet button (P0.5-R3): act as a fixture persona's wallet,
// or paste any address, at a chosen moment of the fixture chain. Roles still come from the
// IdentityDirectory; the persona list only supplies addresses.
import { useMemo, useState } from "react";
import personasJson from "../../fixtures/personas.json";
import { parsePersonas } from "@/shared/fixtures/personas";
import { fixtureTimeline } from "@/shared/mocks/fixtures";
import { type Address, isAddress } from "@/shared/types/primitives";
import { DEFAULT_MOCK_MOMENT, mockMoments } from "./mock-clock";
import { useSession } from "./session";
import { Button, Card, Chip, Field, Pill, Row, SectionHeader, Stackv, Txt } from "@/ui";

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
    <Card dashed>
      <Stackv gap={4}>
        <Row gap={8}>
          <Txt variant="h2">Test wallets</Txt>
          <Pill label="Mock mode" tone="warning" />
        </Row>
        <Txt variant="caption" tone="muted">
          Pick a fixture wallet instead of a real one. Its roles are read from the mock ENS chain at the
          chosen moment.
        </Txt>
      </Stackv>

      <SectionHeader title="Moment" icon="clock" />
      <Row gap={6}>
        {moments.map((m) => (
          <Chip
            key={m.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: m.id === momentId }}
            onPress={() => setMomentId(m.id)}
            selected={m.id === momentId}
            label={m.label}
          />
        ))}
      </Row>

      <SectionHeader title="Wallets" icon="users" />
      <Row gap={6}>
        {personas.map((p) => {
          // Every team has a "Person A"; the team tells them apart.
          const name = p.team ? `${p.displayName} (${p.team})` : p.displayName;
          return (
            <Chip
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Connect as ${name}`}
              onPress={() => connect(p.address as Address)}
            >
              <Txt variant="caption" style={{ fontWeight: "600" }}>
                {name}{" "}
                <Txt variant="caption" tone="muted">
                  · {p.role}
                </Txt>
              </Txt>
            </Chip>
          );
        })}
      </Row>

      <SectionHeader title="Any address" icon="wallet" />
      <Row gap={8} wrap={false} align="flex-end">
        <Field
          value={pasted}
          onChangeText={setPasted}
          placeholder="0x…"
          autoCapitalize="none"
          accessibilityLabel="Wallet address"
          mono
          style={{ flex: 1 }}
        />
        <Button
          accessibilityRole="button"
          disabled={!pastedOk}
          onPress={() => connect(pasted.trim().toLowerCase() as Address)}
          variant="primary"
          label="Connect"
        />
      </Row>
    </Card>
  );
}
