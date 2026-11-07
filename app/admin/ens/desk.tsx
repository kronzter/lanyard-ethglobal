// A4.3 onboarding desk (organizer): issue badges, register teams, then link each team's page `url`.
import { Link } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { ISSUABLE_BOOKS, decideBadge, parseBadgeArgs } from "@/ens/badge-plan";
import { parseTeamArgs } from "@/ens/team-plan";
import { registerBadgeData, registerTeamData, setTextData } from "@/consoles/calldata";
import { bookRegistry, observeTeam, ownerOf, readUrl } from "@/consoles/observe";
import { planTeamFlow, type TeamFlow } from "@/consoles/team-flow";
import { Btn, Choice, ConsoleFrame, Field, Log, useRunner } from "@/consoles/ui";
import { useConsole } from "@/consoles/useConsole";
import { eventConfig } from "@/shared/event.config";
import { toFullName } from "@/shared/labels";
import { styles } from "@/shell/styles";

type Book = (typeof ISSUABLE_BOOKS)[number];

export default function Desk() {
  const c = useConsole();
  const { busy, log, run } = useRunner();
  const [holder, setHolder] = useState("");
  const [badgeLabel, setBadgeLabel] = useState("");
  const [book, setBook] = useState<Book>("hackers");
  const [teamLabel, setTeamLabel] = useState("");
  const [lead, setLead] = useState("");
  const [flow, setFlow] = useState<TeamFlow | null>(null);

  const authority = { kind: "organizer" } as const;

  const issue = () =>
    run(`issue ${badgeLabel}.${book}`, async () => {
      if (!c.pc || !c.live) throw new Error(c.problem ?? "not ready");
      const req = parseBadgeArgs(["--book", book, "--label", badgeLabel, "--owner", holder]);
      const registry = await bookRegistry(c.pc, c.live, req.book);
      const decision = decideBadge({
        currentOwner: await ownerOf(c.pc, registry, req.label),
        wantedOwner: req.owner,
      });
      if (decision.action === "blocked") throw new Error(decision.reason);
      if (decision.action === "skip") return `nothing to do: ${decision.reason}`;
      return c.send({
        to: c.live.registrar,
        data: registerBadgeData(req.book, req.label, req.owner),
        what: "registerBadge",
        authority,
      });
    });

  const observe = async () => {
    if (!c.pc || !c.live) throw new Error(c.problem ?? "not ready");
    const req = parseTeamArgs(["--label", teamLabel, "--lead", lead]);
    if (req.mode !== "team") throw new Error("unexpected demo mode");
    const f = planTeamFlow(await observeTeam(c.pc, c.live, req.label, req.lead));
    setFlow(f);
    return { req, f };
  };

  const check = () =>
    run("check team", async () => {
      const { f } = await observe();
      return `registration ${f.registration}, link ${f.link}${f.reason ? ` (${f.reason})` : ""}`;
    });

  const register = () =>
    run(`register ${teamLabel}`, async () => {
      const { req, f } = await observe();
      if (f.next !== "register") throw new Error(`nothing to register (registration ${f.registration})`);
      const tx = await c.send({
        to: c.live!.registrar,
        data: registerTeamData(req.label, req.lead),
        what: "registerTeam",
        authority,
      });
      await observe(); // registration is its own status; linking is a separate step
      return tx;
    });

  // Retryable alone: re-reads first, so an uncertain earlier write is reconciled, never repeated.
  const link = () =>
    run(`link ${teamLabel}`, async () => {
      const { req, f } = await observe();
      if (f.registration !== "done") throw new Error("register the team first");
      if (f.link === "ready") return "url already set and read back";
      if (f.link !== "needed" || !f.url) throw new Error(f.reason ?? `cannot link (${f.link})`);
      const name = toFullName(req.label, eventConfig);
      const tx = await c.send({
        to: c.live!.hackersResolver,
        data: setTextData(name, "url", f.url),
        what: "setText url",
        authority,
      });
      const back = await readUrl(c.pc!, c.live!, req.label);
      const after = (await observe()).f;
      if (back !== f.url || after.link !== "ready")
        throw new Error(
          `url written (${tx.hash}) but read back ${JSON.stringify(back)}; not ready, press Link again`,
        );
      return tx;
    });

  const url = flow?.url ?? null;
  const copy = () =>
    run("copy", async () => {
      if (!url) throw new Error("no url yet");
      await navigator.clipboard.writeText(url);
      return url;
    });

  return (
    <ConsoleFrame title="Onboarding desk">
      <Text style={styles.muted}>Organizer wallet only. Dripping tGLM is a separate screen.</Text>
      <Link href="/organizer/faucet" style={styles.link}>
        Open the faucet
      </Link>

      <View style={styles.card}>
        <Text style={styles.h2}>Issue a badge</Text>
        <Field label="Holder address" value={holder} onChange={setHolder} placeholder="0x…" testID="holder" />
        <Field
          label="Badge label"
          value={badgeLabel}
          onChange={setBadgeLabel}
          placeholder="priya"
          testID="badge-label"
        />
        <Choice options={ISSUABLE_BOOKS} value={book} onChange={setBook} />
        <Btn label="Issue badge" onPress={issue} disabled={busy} testID="issue" />
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Register a team</Text>
        <Field
          label="Team label"
          value={teamLabel}
          onChange={setTeamLabel}
          placeholder="alpha-team"
          testID="team-label"
        />
        <Field label="Lead address" value={lead} onChange={setLead} placeholder="0x…" testID="team-lead" />
        <View style={styles.wrap}>
          <Btn label="Check status" onPress={check} disabled={busy} />
          <Btn label="1. Register team" onPress={register} disabled={busy} testID="register" />
          <Btn label="2. Link page url" onPress={link} disabled={busy} testID="link" />
        </View>
        {flow && (
          <View testID="team-status">
            <Text>Registration: {flow.registration}</Text>
            <Text>Website link: {flow.link === "ready" ? "ready (read back)" : flow.link}</Text>
            {flow.reason && <Text style={{ color: "#b91c1c" }}>{flow.reason}</Text>}
          </View>
        )}
        {flow?.link === "ready" && url && (
          <View style={styles.wrap}>
            <Text style={styles.mono}>{url}</Text>
            <Btn label="Copy" onPress={copy} />
            <Btn label="Open page" onPress={() => void Linking.openURL(url)} />
          </View>
        )}
      </View>

      <Log log={log} />
    </ConsoleFrame>
  );
}
