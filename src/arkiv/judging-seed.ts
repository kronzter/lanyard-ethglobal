// Three demo teams, nine assigned judges, one cutoff revocation (ENS fixture) and one recusal.
import personasJson from "../../fixtures/personas.json";
import type { EventConfig } from "@/shared/config/schema";
import { requireMeasured } from "@/shared/config/unmeasured";
import { parsePersonas } from "@/shared/fixtures/personas";
import { canonicalBytes } from "@/shared/canonical";
import { sealScore, scoreAad } from "@/shared/crypto/score-cipher";
import type { Hex } from "@/shared/types/primitives";
import type { FakeArkiv } from "./fake";
import { buildCreate } from "./writers";
export async function seedJudging(
  fake: FakeArkiv,
  config: EventConfig,
  options: { finals?: boolean; recusal?: boolean } = {},
) {
  const personas = parsePersonas(personasJson).personas;
  const person = (id: string) => {
    const p = personas.find((p) => p.id === id);
    if (!p) throw new Error(`No persona ${id}`);
    return p;
  };
  const organizer = person("organizer");
  const ctx = (byLabel: string) => ({ edition: config.edition, byLabel, times: config.times });
  const write = async (id: string, creates: Parameters<ReturnType<FakeArkiv["writer"]>["write"]>[0]) =>
    (await fake.writer(person(id).address).write(creates)).created;
  const teams = [
    ["zkpay", "main", ["gita", "hari", "ines"]],
    ["chainchat", "arkiv", ["ana", "ben", "chen"]],
    ["seatsense", "ens", ["dana", "eli", "fatima"]],
  ] as const;
  const seeded: { team: string; submission: Hex; rubric: Hex; assignments: Hex[]; finals: Hex[] }[] = [];
  for (const [team, track, judges] of teams) {
    const [rubric] = await write(organizer.id, {
      creates: [
        buildCreate("rubric", ctx("organizer"), {
          track,
          rubric: {
            criteria: [
              { id: "impact", name: "Impact", weight: 2 },
              { id: "execution", name: "Execution", weight: 1 },
            ],
            scale: 10,
          },
        }),
      ],
    });
    const lead = person(`${team}-a`);
    const content = {
      page: {
        title: team,
        description: `${team} demo project`,
        members: ["Person A", "Person B", "Person C", "Person D"],
        links: { ethglobal: `https://ethglobal.com/showcase/${team}` },
      },
    };
    const [project] = await write(lead.id, {
      creates: [buildCreate("project", ctx(team), { team, track, content })],
    });
    const [submission] = await write(lead.id, {
      creates: [
        buildCreate("submission", ctx(team), { project: project!, team, track, lead: lead.address, content }),
      ],
    });
    await write(organizer.id, {
      creates: [buildCreate("acceptance", ctx("organizer"), { submission: submission!, track })],
    });
    const result = {
      team,
      submission: submission!,
      rubric: rubric!,
      assignments: [] as Hex[],
      finals: [] as Hex[],
    };
    for (const [index, id] of judges.entries()) {
      const judge = person(id);
      const [assignment] = await write(organizer.id, {
        creates: [
          buildCreate("judge_assignment", ctx("organizer"), {
            submission: submission!,
            rubric: rubric!,
            judge: judge.by,
          }),
        ],
      });
      result.assignments.push(assignment!);
      if (options.finals) {
        const input = {
          event: config.edition,
          submission: submission!,
          rubric: rubric!,
          assignment: assignment!,
          judge: judge.by,
        };
        const cipher = requireMeasured(config.scoreCipher, "score cipher");
        const ciphertext = sealScore(
          cipher.publicKey,
          canonicalBytes({
            schemaVersion: 1,
            values: { impact: 700 + index * 50, execution: 800 - index * 50 },
          }),
          scoreAad(input),
        );
        const [final] = await write(id, {
          creates: [buildCreate("final_score", ctx(judge.by), { ...input, ciphertext })],
        });
        result.finals.push(final!);
      }
      if (options.recusal && id === "dana")
        await write(id, {
          creates: [buildCreate("recusal", ctx(judge.by), { submission: submission!, judge: judge.by })],
        });
    }
    seeded.push(result);
  }
  return seeded;
}
