import { Row, Screen, Tile, routeCopy } from "@/ui";

const DESK = [
  "/admin/ens/desk",
  "/organizer/faucet",
  "/organizer/seats",
  "/organizer/judging",
  "/organizer/leaderboard",
  "/organizer/records",
] as const;

const EXTRA: Record<string, { icon: "badge"; title: string; body: string }> = {
  "/admin/ens/desk": { icon: "badge", title: "Onboarding desk", body: "Issue badges and register teams" },
};

export default function OrganizerHome() {
  return (
    <Screen
      title="Organizer desk"
      subtitle="Everything the event runs on, from the onboarding desk to published results."
    >
      <Row gap={12} align="stretch">
        {DESK.map((href) => {
          const copy = EXTRA[href] ?? routeCopy(href);
          return <Tile key={href} href={href} icon={copy.icon} title={copy.title} body={copy.body} />;
        })}
      </Row>
    </Screen>
  );
}
