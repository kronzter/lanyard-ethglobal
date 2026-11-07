import { Banner, type IconName, Row, Screen, Tile } from "@/ui";

const LINKS: { href: string; icon: IconName; title: string; body: string }[] = [
  {
    href: "/admin/ens/desk",
    icon: "badge",
    title: "Onboarding desk",
    body: "Organizer: issue badges and register teams",
  },
  {
    href: "/admin/ens/coordinator",
    icon: "users",
    title: "Coordinator",
    body: "Make or unmake volunteer leads",
  },
  {
    href: "/admin/ens/partner",
    icon: "shield",
    title: "Partner console",
    body: "Issue and revoke partner judges and staff",
  },
  {
    href: "/admin/ens/head-judge",
    icon: "gavel",
    title: "Head judge",
    body: "Issue and revoke global judges",
  },
  {
    href: "/admin/ens/permissions",
    icon: "key",
    title: "Permission map",
    body: "Every role grant on Lanyard's contracts",
  },
];

export default function EnsConsoles() {
  return (
    <Screen title="ENS consoles">
      <Banner icon="lock">Staff wallets sign every transaction; nothing is stored in the app.</Banner>
      <Row gap={12} align="stretch">
        {LINKS.map((l) => (
          <Tile key={l.href} href={l.href} icon={l.icon} title={l.title} body={l.body} />
        ))}
      </Row>
    </Screen>
  );
}
