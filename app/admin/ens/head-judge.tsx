// A4.3 head-judge console: issue global judges (registerJudge) and revoke them (unregister).
import { useState } from "react";
import { type Address } from "viem";
import { registerJudgeData, unregisterData } from "@/consoles/calldata";
import { bookRegistry, ownerOf, statusOf } from "@/consoles/observe";
import { Btn, ConsoleFrame, Field, Log, useRunner } from "@/consoles/ui";
import { useConsole } from "@/consoles/useConsole";
import { decideBadge, parseBadgeArgs } from "@/ens/badge-plan";
import { decideRevoke } from "@/ens/revive-plan";
import { Card, Row, Txt } from "@/ui";

export default function HeadJudge() {
  const c = useConsole();
  const { busy, log, run } = useRunner();
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const authority = { kind: "headJudge" } as const;

  const issue = () =>
    run(`issue ${label}.judges`, async () => {
      const { pc, live } = c;
      if (!pc || !live) throw new Error(c.problem ?? "not ready");
      const req = parseBadgeArgs(["--book", "judges", "--label", label, "--owner", owner]);
      const registry = await bookRegistry(pc, live, "judges");
      const d = decideBadge({ currentOwner: await ownerOf(pc, registry, req.label), wantedOwner: req.owner });
      if (d.action === "blocked") throw new Error(d.reason);
      if (d.action === "skip") return `nothing to do: ${d.reason}`;
      return c.send({
        to: live.registrar,
        data: registerJudgeData(req.label, req.owner as Address),
        what: "registerJudge",
        authority,
      });
    });

  const revoke = () =>
    run(`revoke ${label}.judges`, async () => {
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
      const registry = await bookRegistry(pc, live, "judges");
      const d = decideRevoke({ status: await statusOf(pc, registry, req.label) });
      if (d.action !== "act") return d.action === "skip" ? `nothing to do: ${d.reason}` : d.reason;
      return c.send({ to: registry, data: unregisterData(req.label), what: "unregister", authority });
    });

  return (
    <ConsoleFrame title="Head judge">
      <Txt tone="muted">Head judge wallet only. Issues global (main track) judges.</Txt>
      <Card>
        <Field label="Judge label" value={label} onChange={setLabel} placeholder="ana" testID="judge-label" />
        <Field
          label="Judge wallet (to issue)"
          value={owner}
          onChange={setOwner}
          placeholder="0x…"
          testID="judge-owner"
        />
        <Row gap={8}>
          <Btn label="Issue judge" onPress={issue} disabled={busy} testID="issue" />
          <Btn label="Revoke judge" onPress={revoke} disabled={busy} testID="revoke" />
        </Row>
      </Card>
      <Log log={log} />
    </ConsoleFrame>
  );
}
