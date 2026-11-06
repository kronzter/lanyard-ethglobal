// Harnesses for MockResultsPublisher: a correct one, and a deliberately broken publisher that
// keeps accepting writes after the lock (P0.3-R5). Persistence goes through the same canonical
// serialization a file store uses, never a shared object.
import { MockResultsPublisher, type ReceiptOutcome } from "../mocks/mock-results-publisher";
import {
  createSerializedStore,
  type PersistedPublisher,
  type PublisherOp,
  type PublisherStore,
} from "../mocks/publisher-store";
import type { PublisherHarness } from "./results-publisher-conformance";

/** Ignores the lock: every other rule still applies. */
class AllowsWritesAfterLock extends MockResultsPublisher {
  protected override validate(op: PublisherOp, data: PersistedPublisher): void {
    super.validate(op, { ...data, state: { ...data.state, locked: false } });
  }
}

function harness(
  make: (store: PublisherStore, outcome: () => ReceiptOutcome) => MockResultsPublisher,
): PublisherHarness {
  let file: string | null = null;
  const store = createSerializedStore({ read: async () => file, write: async (t) => void (file = t) });
  const queue: ReceiptOutcome[] = [];
  const outcome = () => queue.shift() ?? "success";
  return {
    open: () => make(store, outcome),
    restart: () => make(store, outcome),
    next: (o) => void queue.push(o),
    settle: (hash, o) => make(store, outcome).settle(hash, o),
  };
}

export const createMockPublisherHarness = (): PublisherHarness =>
  harness((store, outcome) => new MockResultsPublisher({ store, outcome }));

export const createWritesAfterLockHarness = (): PublisherHarness =>
  harness((store, outcome) => new AllowsWritesAfterLock({ store, outcome }));
