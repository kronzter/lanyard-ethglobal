// A4.3 partner console: issue and revoke that partner's own judges and staff.
import { useState } from "react";
import { registerPartnerBadgeData, unregisterData } from "@/consoles/calldata";
import { ownerOf, partnerBookRegistry, statusOf } from "@/consoles/observe";
import { Btn, Choice, ConsoleFrame, Field, Log, useRunner } from "@/consoles/ui";
import { useConsole } from "@/consoles/useConsole";
import { decideBadge, parseBadgeArgs } from "@/ens/badge-plan";
import { decideRevoke, SUBS } from "@/ens/revive-plan";
import { eventConfig } from "@/shared/event.config";
import { Card, Row, Txt } from "@/ui";

type Sub = (typeof SUBS)[number];
const PARTNERS = eventConfig.partners.map((p) => p.id);

export default function Partner() {
  const c = useConsole();
  const { busy, log, run } = useRunner();
  const [partner, setPartner] = useState(PARTNERS[0] ?? "");
  const [sub, setSub] = useState<Sub>("judges");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const authority = { kind: "partner", partner } as const;

  const issue = () =>
    run(`issue ${label}.${sub}.${partner}`, async () => {
      const { pc, live } = c;
      if (!pc || !live) throw new Error(c.problem ?? "not ready");
      // Reuse the badge-plan validation for label and owner (the book is not used on chain here).
      const req = parseBadgeArgs(["--book", "judges", "--label", label, "--owner", owner]);
      const registry = await partnerBookRegistry(pc, live, partner, sub);
      const d = decideBadge({ currentOwner: await ownerOf(pc, registry, req.label), wantedOwner: req.owner });
      if (d.action === "blocked") throw new Error(d.reason);
      if (d.action === "skip") return `nothing to do: ${d.reason}`;
      return c.send({
        to: live.registrar,
        data: registerPartnerBadgeData(partner, sub, req.label, req.owner),
        what: "registerPartnerBadge",
        authority,
      });
    });

  const revoke = () =>
    run(`revoke ${label}.${sub}.${partner}`, async () => {
      const { pc, live } = c;
      if (!pc || !live) throw new Error(c.problem ?? "not ready");
      const req = parseBadgeArgs([
        "--book",
        "judges",
        "--label",
        label,
        "--owner",
        "0x0000000000000000000000000000000000000001",
      ]);
      const registry = await partnerBookRegistry(pc, live, partner, sub);
      const d = decideRevoke({ status: await statusOf(pc, registry, req.label) });
      if (d.action !== "act") return d.action === "skip" ? `nothing to do: ${d.reason}` : d.reason;
      return c.send({ to: registry, data: unregisterData(req.label), what: "unregister", authority });
    });

  return (
    <ConsoleFrame title="Partner console">
      <Txt tone="muted">
        A partner wallet manages only its own judges and staff. Another partner's wallet is blocked before
        sending.
      </Txt>
      <Card>
        <Txt variant="h3">Partner</Txt>
        <Choice options={PARTNERS} value={partner} onChange={setPartner} />
        <Txt variant="h3">Sub-book</Txt>
        <Choice options={SUBS} value={sub} onChange={setSub} />
        <Field label="Label" value={label} onChange={setLabel} placeholder="ana" testID="partner-label" />
        <Field
          label="Wallet (to issue)"
          value={owner}
          onChange={setOwner}
          placeholder="0x…"
          testID="partner-owner"
        />
        <Row gap={8}>
          <Btn label="Issue" onPress={issue} disabled={busy} testID="issue" />
          <Btn label="Revoke" onPress={revoke} disabled={busy} testID="revoke" />
        </Row>
      </Card>
      <Log log={log} />
    </ConsoleFrame>
  );
}
