// The EnsReader conformance suite (plans/P0-foundation.md › P0.3). Every implementation, the
// mock and A2.4's SepoliaEnsReader alike, supplies a scenario: labels and blocks in its own
// history that exhibit each property. The checks are the contract.
import type { EnsReader } from "../interfaces/ens-reader";
import type { Address, Label } from "../types/primitives";
import { expectEqual, expectRejects, expectThat, registerConformance, type Check } from "./conformance";

export type EnsConformanceScenario = {
  /** A name whose registry owner differs from its forward address record at `block`. */
  ownerVsAddress: { label: Label; block: bigint; owner: Address; address: Address };
  /** A name unregistered at `block` (valid at `block - 1`). */
  unregister: { label: Label; block: bigint };
  /** A name with an unexpired registration whose ancestor is invalid at `block` (timestamp given). */
  ancestorExpiry: { label: Label; block: bigint; blockTimestamp: bigint };
  /** A name expiring at `expiry`, and the block whose timestamp equals it exactly. */
  exactExpiry: { label: Label; expiry: bigint; block: bigint };
  /** A text record set to `value` at `setBlock` and removed at `removedBlock`. */
  text: { label: Label; key: string; value: string; setBlock: bigint; removedBlock: bigint };
  /** A name reissued between `before` and `after` (both blocks have a valid owner). */
  reissue: { label: Label; before: bigint; after: bigint };
  /** A name renewed between `before` and `after`. */
  renewal: { label: Label; before: bigint; after: bigint };
  /** A name whose registry roles change between `before` and `after`. */
  roleChange: { label: Label; before: bigint; after: bigint };
  /** A block, its exact timestamp, and the gap to the next block in seconds (> 1). */
  timestamp: { block: bigint; timestamp: bigint; secondsToNext: bigint };
};

export type EnsConformanceSubject = {
  reader: EnsReader;
  /** The same implementation with its RPC failing on every call. */
  failing: EnsReader;
  scenario: EnsConformanceScenario;
};

const at = (sepoliaBlock: bigint) => ({ sepoliaBlock });

export const ensReaderChecks: Check<EnsConformanceSubject>[] = [
  {
    name: "owner comes from the registry, not the forward address record",
    run: async ({ reader, scenario: { ownerVsAddress: s } }) => {
      expectThat(s.owner.toLowerCase() !== s.address.toLowerCase(), "scenario owner and address must differ");
      expectEqual((await reader.owner(s.label, at(s.block)))?.toLowerCase(), s.owner.toLowerCase(), "owner");
      expectEqual(
        (await reader.address(s.label, at(s.block)))?.toLowerCase(),
        s.address.toLowerCase(),
        "address",
      );
    },
  },
  {
    name: "a registration is honoured until the block it is unregistered",
    run: async ({ reader, scenario: { unregister: s } }) => {
      expectThat(
        (await reader.owner(s.label, at(s.block - 1n))) !== null,
        "owner one block before unregister",
      );
      expectEqual(await reader.owner(s.label, at(s.block)), null, "owner at the unregister block");
    },
  },
  {
    name: "registrationId is null whenever owner is null",
    run: async ({ reader, scenario: { unregister: s, ancestorExpiry: a } }) => {
      expectThat(
        (await reader.registrationId(s.label, at(s.block - 1n))) !== null,
        "registrationId while valid",
      );
      expectEqual(await reader.registrationId(s.label, at(s.block)), null, "registrationId after unregister");
      expectEqual(
        await reader.registrationId(a.label, at(a.block)),
        null,
        "registrationId under an expired ancestor",
      );
    },
  },
  {
    name: "an invalid ancestor invalidates an unexpired descendant",
    run: async ({ reader, scenario: { ancestorExpiry: s } }) => {
      const expiry = await reader.expiry(s.label, at(s.block));
      expectThat(
        expiry !== null && expiry > s.blockTimestamp,
        "the descendant's own registration is unexpired",
      );
      expectEqual(await reader.owner(s.label, at(s.block)), null, "owner under an expired ancestor");
    },
  },
  {
    name: "a name is invalid at exactly its expiry",
    run: async ({ reader, scenario: { exactExpiry: s } }) => {
      expectEqual(await reader.sepoliaBlockAt(s.expiry), s.block, "block at the expiry timestamp");
      expectThat((await reader.owner(s.label, at(s.block - 1n))) !== null, "owner one block before expiry");
      expectEqual(await reader.owner(s.label, at(s.block)), null, "owner at the exact expiry");
      expectEqual(await reader.expiry(s.label, at(s.block)), s.expiry, "expiry stays readable");
    },
  },
  {
    name: "text reflects the requested block",
    run: async ({ reader, scenario: { text: s } }) => {
      expectThat(
        (await reader.text(s.label, s.key, at(s.setBlock - 1n))) !== s.value,
        "text before it was set",
      );
      expectEqual(await reader.text(s.label, s.key, at(s.setBlock)), s.value, "text at the set block");
      expectEqual(await reader.text(s.label, s.key, at(s.removedBlock - 1n)), s.value, "text before removal");
      expectEqual(await reader.text(s.label, s.key, at(s.removedBlock)), null, "text at the removal block");
    },
  },
  {
    name: "registrationId changes on reissue",
    run: async ({ reader, scenario: { reissue: s } }) => {
      const before = await reader.registrationId(s.label, at(s.before));
      const after = await reader.registrationId(s.label, at(s.after));
      expectThat(before !== null && after !== null, "both registrations are valid");
      expectThat(before !== after, "a reissued name has a new registration ID");
    },
  },
  {
    name: "registrationId is stable across renewal",
    run: async ({ reader, scenario: { renewal: s } }) => {
      expectThat((await reader.registrationId(s.label, at(s.before))) !== null, "valid before renewal");
      expectEqual(
        await reader.registrationId(s.label, at(s.after)),
        await reader.registrationId(s.label, at(s.before)),
        "registrationId",
      );
      expectThat(
        (await reader.expiry(s.label, at(s.after)))! > (await reader.expiry(s.label, at(s.before)))!,
        "renewal extends expiry",
      );
    },
  },
  {
    name: "registrationId is stable across role changes",
    run: async ({ reader, scenario: { roleChange: s } }) => {
      expectThat(
        (await reader.registrationId(s.label, at(s.before))) !== null,
        "valid before the role change",
      );
      expectEqual(
        await reader.registrationId(s.label, at(s.after)),
        await reader.registrationId(s.label, at(s.before)),
        "registrationId",
      );
    },
  },
  {
    name: "unregisteredBetween covers reissue, not renewal, with inclusive endpoints",
    run: async ({ reader, scenario: { reissue, renewal, unregister: u } }) => {
      expectEqual(
        await reader.unregisteredBetween(reissue.label, reissue.before, reissue.after),
        true,
        "across a reissue",
      );
      expectEqual(
        await reader.unregisteredBetween(renewal.label, renewal.before, renewal.after),
        false,
        "across a renewal",
      );
      expectEqual(
        await reader.unregisteredBetween(u.label, u.block, u.block),
        true,
        "interval [unregister, unregister]",
      );
      expectEqual(
        await reader.unregisteredBetween(u.label, u.block - 1n, u.block - 1n),
        false,
        "interval before unregister",
      );
      expectEqual(await reader.unregisteredBetween(u.label, u.block + 1n, u.block), false, "empty interval");
    },
  },
  {
    name: "timestamps map to the latest block at or before them",
    run: async ({ reader, scenario: { timestamp: s } }) => {
      expectThat(s.secondsToNext > 1n, "scenario needs a block gap above one second");
      expectEqual(await reader.sepoliaBlockAt(s.timestamp), s.block, "equal timestamp");
      expectEqual(
        await reader.sepoliaBlockAt(s.timestamp + s.secondsToNext - 1n),
        s.block,
        "timestamp between blocks",
      );
      expectEqual(
        await reader.sepoliaBlockAt(s.timestamp - 1n),
        s.block - 1n,
        "timestamp just before the block",
      );
    },
  },
  {
    name: "the head block covers every scenario block",
    run: async ({ reader, scenario: s }) => {
      const head = await reader.headBlock();
      const blocks = [
        s.ownerVsAddress.block,
        s.unregister.block,
        s.ancestorExpiry.block,
        s.exactExpiry.block,
        s.text.removedBlock,
        s.reissue.after,
        s.renewal.after,
        s.roleChange.after,
        s.timestamp.block,
      ];
      expectThat(
        blocks.every((b) => b <= head),
        `head ${head} is behind a scenario block`,
      );
    },
  },
  {
    name: "RPC failures throw instead of returning no name",
    run: async ({ failing, scenario: s }) => {
      const b = at(s.ownerVsAddress.block);
      const l = s.ownerVsAddress.label;
      await expectRejects(() => failing.owner(l, b), "owner");
      await expectRejects(() => failing.address(l, b), "address");
      await expectRejects(() => failing.text(l, s.text.key, b), "text");
      await expectRejects(() => failing.expiry(l, b), "expiry");
      await expectRejects(() => failing.registrationId(l, b), "registrationId");
      await expectRejects(
        () => failing.unregisteredBetween(l, b.sepoliaBlock - 1n, b.sepoliaBlock),
        "unregisteredBetween",
      );
      await expectRejects(() => failing.sepoliaBlockAt(s.timestamp.timestamp), "sepoliaBlockAt");
      await expectRejects(() => failing.headBlock(), "headBlock");
    },
  },
];

export function runEnsReaderConformance(
  name: string,
  factory: () => EnsConformanceSubject | Promise<EnsConformanceSubject>,
): void {
  registerConformance(`EnsReader conformance: ${name}`, ensReaderChecks, factory);
}
