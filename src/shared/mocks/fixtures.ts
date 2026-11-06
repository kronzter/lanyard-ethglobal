// Mocks wired to the committed fixtures: what the app and CLI composition roots select until
// their integration checkpoint switches them to the real implementations.
import historyJson from "../../../fixtures/ens-history.json";
import timelineJson from "../../../fixtures/timeline.json";
import venueJson from "../../../fixtures/venue.small.json";
import { parseEnsHistory } from "../fixtures/ens-history";
import { parseTimeline } from "../fixtures/timeline";
import { parseVenue } from "../types/venue";
import { MockEnsReader, type MockEnsReaderOptions } from "./mock-ens-reader";
import { MockIdentityDirectory } from "./mock-identity-directory";

export const fixtureEnsHistory = () => parseEnsHistory(historyJson);
export const fixtureTimeline = () => parseTimeline(timelineJson);
export const fixtureVenue = () => parseVenue(venueJson);

export const createFixtureEnsReader = (opts: Pick<MockEnsReaderOptions, "fail"> = {}): MockEnsReader =>
  new MockEnsReader({ history: fixtureEnsHistory(), timeline: fixtureTimeline(), ...opts });

/** The fixture directory, verifying ownership through the given reader (the fixture reader by default). */
export const createFixtureIdentityDirectory = (
  reader: MockEnsReader = createFixtureEnsReader(),
): MockIdentityDirectory => new MockIdentityDirectory(reader, fixtureEnsHistory());
