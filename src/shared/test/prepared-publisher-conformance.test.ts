import { createMockPublisherHarness } from "../testing/mock-publisher-harness";
import {
  runPreparedPublisherConformance,
  type PreparedPublisherHarness,
} from "../testing/prepared-publisher-conformance";
runPreparedPublisherConformance(
  "MockResultsPublisher",
  () => createMockPublisherHarness() as PreparedPublisherHarness,
);
