// The app's Arkiv: the Rabdi testnet, or (development only) an in-app FakeArkiv on the fixture
// event timeline, chosen by EXPO_PUBLIC_LANYARD_ARKIV. Both expose the same reader and a writer
// per connected account, so screens never branch on the mode except to show it.
//
// Why `fake` exists: until I2 the ENS reader is the fixture mock, whose history covers only the
// fixture event dates, so records written to Rabdi today cannot be evaluated yet. The fake runs
// the same writes, capture and rules on event-time timestamps.
import type { EIP1193Provider } from "viem";
import { freezeConfig } from "@/shared/config/hash";
import type { EventConfig } from "@/shared/config/schema";
import type { Timeline } from "@/shared/fixtures/timeline";
import type { Address, Hex } from "@/shared/types/primitives";
import type { ArkivReader, ArkivWriter } from "./api";
import type { RabdiAccess } from "./chain";
import { createArkivReader, createWalletWriter } from "./client";
import { FAKE_BLOCK_SECONDS, FakeArkiv } from "./fake";
import { seedFakeEvent, type Seeded } from "./seed";

export type AppArkiv = {
  mode: "rabdi" | "fake";
  reader: ArkivReader;
  /** A writer for the connected account; the testnet needs its wallet provider. */
  writer(address: Address, provider: EIP1193Provider | null, onTxHash?: (hash: Hex) => void): ArkivWriter;
  /** Development controls, fake mode only. */
  fake?: { arkiv: FakeArkiv; seeded: Promise<Seeded> };
};

export function rabdiArkiv(access: RabdiAccess): AppArkiv {
  return {
    mode: "rabdi",
    reader: createArkivReader(access),
    writer: (address, provider, onTxHash) => {
      if (!provider) throw new Error("connect a wallet to write to Arkiv");
      return createWalletWriter(provider, address, access, onTxHash);
    },
  };
}

/** Fake mode starts at event start + 2 h (the default mock moment), seeded with the demo event. */
export const FAKE_START_OFFSET_SECONDS = 7_200n;
const FAKE_START_BLOCK = 1_000n;

export function fakeArkiv(config: EventConfig, timeline: Timeline): AppArkiv {
  // Block 0 carries the configured reset identity, so capture and the rules accept the fake.
  const resetId = freezeConfig(config).chains.rabdi.resetId;
  const start = timeline.times.eventStart.timestamp + FAKE_START_OFFSET_SECONDS;
  const arkiv = new FakeArkiv(start - FAKE_START_BLOCK * FAKE_BLOCK_SECONDS, FAKE_START_BLOCK, resetId);
  return {
    mode: "fake",
    reader: arkiv,
    writer: (address, _provider, onTxHash) => arkiv.writer(address, onTxHash),
    fake: { arkiv, seeded: seedFakeEvent(arkiv, config) },
  };
}
