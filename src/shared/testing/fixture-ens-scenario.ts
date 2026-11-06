// The conformance scenario for the fixture history, derived from the events themselves so it
// cannot drift from fixtures/ens-history.json.
import { PERMS_TEXT_KEY } from "../ens/permission-envelope";
import type { EnsEvent } from "../fixtures/ens-history";
import { timestampOfBlock } from "../fixtures/timeline";
import { fixtureEnsHistory, fixtureTimeline } from "../mocks/fixtures";
import type { EnsConformanceScenario } from "./ens-reader-conformance";

export function fixtureEnsScenario(): EnsConformanceScenario {
  const { events } = fixtureEnsHistory();
  const timeline = fixtureTimeline();
  const find = (label: string, type: EnsEvent["type"], nth = 0) => {
    const e = events.filter((x) => x.label === label && x.type === type)[nth];
    if (!e) throw new Error(`fixture has no ${type} #${nth} for ${label}`);
    return e;
  };
  const addrOf = (label: string) =>
    (find(label, "register") as Extract<EnsEvent, { type: "register" }>).owner;
  const anitaAddr = find("anita.volunteers", "setAddr") as Extract<EnsEvent, { type: "setAddr" }>;
  const leela = find("leela.volunteers", "register") as Extract<EnsEvent, { type: "register" }>;
  const priyaNote = find("priya.volunteers", "setText") as Extract<EnsEvent, { type: "setText" }>;
  const kabirOut = find("kabir.volunteers", "unregister");
  const kabirIn = find("kabir.volunteers", "register", 1);
  const rahul = find("rahul.volunteers", "renew");
  const meera = find("meera.volunteers", "setRoles");
  const expiryBlock =
    timeline.genesis.block + (leela.expiry - timeline.genesis.timestamp) / BigInt(timeline.secondsPerBlock);
  return {
    ownerVsAddress: {
      label: "anita.volunteers",
      block: anitaAddr.block,
      owner: addrOf("anita.volunteers"),
      address: anitaAddr.address!,
    },
    unregister: {
      label: "ben.judges.arkiv.partners",
      block: find("ben.judges.arkiv.partners", "unregister").block,
    },
    ancestorExpiry: {
      label: "zkpay",
      block: timeline.head,
      blockTimestamp: timestampOfBlock(timeline, timeline.head),
    },
    exactExpiry: { label: "leela.volunteers", expiry: leela.expiry, block: expiryBlock },
    text: {
      label: "priya.volunteers",
      key: PERMS_TEXT_KEY,
      value: priyaNote.value!,
      setBlock: priyaNote.block,
      removedBlock: find("priya.volunteers", "setText", 1).block,
    },
    reissue: { label: "kabir.volunteers", before: kabirOut.block - 1n, after: kabirIn.block },
    renewal: { label: "rahul.volunteers", before: rahul.block - 1n, after: rahul.block },
    roleChange: { label: "meera.volunteers", before: meera.block - 1n, after: meera.block },
    timestamp: {
      block: timeline.times.results.block,
      timestamp: timeline.times.results.timestamp,
      secondsToNext: BigInt(timeline.secondsPerBlock),
    },
  };
}
