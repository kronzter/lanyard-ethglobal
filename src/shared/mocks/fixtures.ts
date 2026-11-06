// Mocks wired to the committed fixtures: what the app and CLI composition roots select until
// their integration checkpoint switches them to the real implementations.
import historyJson from "../../../fixtures/ens-history.json";
import timelineJson from "../../../fixtures/timeline.json";
import { parseEnsHistory } from "../fixtures/ens-history";
import { parseTimeline } from "../fixtures/timeline";
import { MockEnsReader, type MockEnsReaderOptions } from "./mock-ens-reader";

export const fixtureEnsHistory = () => parseEnsHistory(historyJson);
export const fixtureTimeline = () => parseTimeline(timelineJson);

export const createFixtureEnsReader = (opts: Pick<MockEnsReaderOptions, "fail"> = {}): MockEnsReader =>
  new MockEnsReader({ history: fixtureEnsHistory(), timeline: fixtureTimeline(), ...opts });
