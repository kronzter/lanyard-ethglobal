// The connected wallet's roles (P0.5-R6): an active-role selector when it has any, and an
// onboarding path when it has none. Names are built forward from labels, for display only.
import { View } from "react-native";
import { providers } from "@/providers";
import {
  Address,
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  type IconName,
  IconBubble,
  ListRow,
  Pill,
  Row,
  SectionHeader,
  Stackv,
  Tile,
  Txt,
  initial,
  routeCopy,
} from "@/ui";
import { ensName, roleKey, roleTitle, screensFor, type ShellRole } from "./roles";
import { routeInfo } from "./routes";
import { useSession } from "./session";
import { useWallet } from "./wallet/useWallet";

const names = { edition: providers.config.edition, baseName: providers.config.baseName };

const subtitle = (r: ShellRole) =>
  r.kind === "authority" ? "Configured authority wallet" : ensName(r.label, names);

const kindOf = (r: ShellRole) =>
  r.kind === "authority" ? r.authority.split(":")[0]! : r.role.split(":")[0]!;

const ROLE_ICON: Record<string, IconName> = {
  organizer: "badge",
  results: "key",
  headJudge: "gavel",
  partner: "shield",
  hacker: "user",
  "team-lead": "star",
  "team-member": "users",
  winner: "trophy",
  volunteer: "clock",
  "global-judge": "gavel",
  "partner-judge": "gavel",
  "partner-staff": "ticket",
  "partner-sub-book-owner": "shield",
  "book-owner": "shield",
  "edition-owner": "shield",
};
const roleIcon = (r: ShellRole): IconName => ROLE_ICON[kindOf(r)] ?? "badge";

/** The team a team role belongs to, for the public team page tile (display only). */
const teamOf = (r: ShellRole): string | null => {
  if (r.kind !== "badge") return null;
  const kind = kindOf(r);
  if (kind === "team-lead") return r.label;
  if (kind === "team-member" || kind === "winner") return r.role.split(":")[1] ?? null;
  return null;
};

export function RolePanel() {
  const { address, at, lookup, active, choose, disconnect } = useSession();
  const wallet = useWallet();
  if (!address) return null;
  const switchWallet = () => {
    if (wallet.address) wallet.disconnect();
    disconnect();
  };

  return (
    <Stackv gap={16}>
      <Card>
        <Row wrap={false} gap={12}>
          <Avatar
            letter={active ? initial(active.kind === "badge" ? active.label : roleTitle(active)) : "?"}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h2" numberOfLines={1}>
              {active ? roleTitle(active) : "Connected"}
            </Txt>
            {active ? (
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {subtitle(active)}
              </Txt>
            ) : null}
            <Row gap={6}>
              <Address value={address} />
              {at ? (
                <Txt variant="caption" tone="faint">
                  · block {at.sepoliaBlock.toString()}
                </Txt>
              ) : null}
            </Row>
          </View>
          <Button label="Switch" variant="ghost" size="sm" onPress={switchWallet} />
        </Row>
      </Card>

      {lookup.state === "loading" && <Banner icon="refresh">Reading your badges…</Banner>}
      {lookup.state === "failed" && <Banner tone="danger">{lookup.message}</Banner>}

      {lookup.state === "ready" && lookup.roles.length === 0 && (
        <Card testID="onboarding">
          <EmptyState icon="badge" tone="accent" title="No Lanyard badge on this wallet yet">
            <Txt tone="muted" style={{ textAlign: "center", maxWidth: 440 }}>
              Go to the onboarding desk and show this address. The desk issues your badge and sends tGLM for
              Arkiv gas. Public team pages stay open to everyone meanwhile.
            </Txt>
            <Card tone="muted" style={{ alignSelf: "stretch", alignItems: "center" }}>
              <Txt variant="label" tone="muted">
                Your address
              </Txt>
              <Address value={address} full tone="text" />
            </Card>
          </EmptyState>
        </Card>
      )}

      {lookup.state === "ready" && lookup.roles.length > 0 && (
        <Stackv gap={12}>
          <SectionHeader
            title={active ? (lookup.roles.length > 1 ? "Act as" : "Your role") : "Choose your role"}
          />
          <Stackv gap={8}>
            {lookup.roles.map((r) => {
              const on = active !== null && roleKey(active) === roleKey(r);
              return (
                <ListRow
                  key={roleKey(r)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={roleTitle(r)}
                  onPress={() => choose(r)}
                  selected={on}
                  left={<IconBubble name={roleIcon(r)} tone={on ? "accent" : "muted"} size={36} />}
                  title={roleTitle(r)}
                  subtitle={subtitle(r)}
                  right={on ? <Pill label="Active" tone="accent" dot /> : null}
                  chevron={!on}
                />
              );
            })}
          </Stackv>
          {active && <Screens role={active} />}
        </Stackv>
      )}
    </Stackv>
  );
}

function Screens({ role }: { role: ShellRole }) {
  const screens = screensFor(role);
  const team = teamOf(role);
  if (screens.length === 0)
    return (
      <Banner icon="key">
        {role.kind === "authority" && role.authority === "results"
          ? "The results key acts only through the local freeze CLI."
          : "This badge opens no screens."}
      </Banner>
    );
  return (
    <View testID="role-screens" style={{ gap: 12 }}>
      <SectionHeader title="Your screens" />
      <Row gap={12} align="stretch">
        {screens.map((s) => {
          const copy = routeCopy(s);
          return (
            <Tile
              key={s}
              href={s}
              icon={copy.icon}
              title={copy.title}
              body={copy.body}
              {...(routeInfo(s).webOnly ? { badge: "Web" } : {})}
            />
          );
        })}
        {team ? (
          <Tile
            href={`/teams/${team}`}
            icon="link"
            tone="success"
            title="Public team page"
            body={ensName(team, names)}
          />
        ) : null}
      </Row>
    </View>
  );
}
