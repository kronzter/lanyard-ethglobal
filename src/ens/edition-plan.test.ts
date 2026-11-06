import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { namespaceExpiry } from "../shared/config/validate";
import { eventConfig } from "../shared/event.config";
import {
  baseRegistrySalt,
  planEditionSteps,
  recoverRegistrar,
  registrarMismatches,
  predictVerifiableProxy,
  verifiableProxyCreationCode,
  type EditionObservation,
  type EditionStep,
  type RegistrarImmutables,
} from "./edition-plan";

const expiry = namespaceExpiry(eventConfig.times);
const fresh: EditionObservation = {
  lanyardOwnedByOrganizer: true,
  lanyardExpiry: expiry + 1n,
  namespaceExpiry: expiry,
  baseRegistryDeployed: false,
  baseAttachedToLanyard: false,
  baseParentSet: false,
  baseParentLocked: false,
  registrarPhase: null,
  editionNameAttached: false,
};
const done: EditionObservation = {
  ...fresh,
  baseRegistryDeployed: true,
  baseAttachedToLanyard: true,
  baseParentSet: true,
  baseParentLocked: true,
  registrarPhase: "sealed",
  editionNameAttached: true,
};
const ALL: EditionStep[] = [
  "deploy-base-registry",
  "attach-base-registry",
  "set-base-parent",
  "lock-base-parent",
  "deploy-registrar",
  "bootstrap-edition",
  "attach-edition-name",
  "seal-edition",
];
const plan = (o: EditionObservation) => planEditionSteps(o);

describe("planEditionSteps", () => {
  it("plans every step, in order, from a clean chain", () => {
    expect(plan(fresh)).toEqual({ status: "ready", steps: ALL });
  });

  it("plans nothing once the edition is sealed (idempotent)", () => {
    expect(plan(done)).toEqual({ status: "ready", steps: [] });
  });

  it("resumes after each step instead of redoing it", () => {
    const afterBase = { ...fresh, baseRegistryDeployed: true };
    expect(plan(afterBase)).toEqual({ status: "ready", steps: ALL.slice(1) });
    const afterLock = {
      ...afterBase,
      baseAttachedToLanyard: true,
      baseParentSet: true,
      baseParentLocked: true,
    };
    expect(plan(afterLock)).toEqual({ status: "ready", steps: ALL.slice(4) });
    const afterBootstrap: EditionObservation = { ...afterLock, registrarPhase: "bootstrapped" };
    expect(plan(afterBootstrap)).toEqual({ status: "ready", steps: ["attach-edition-name", "seal-edition"] });
    const attached: EditionObservation = { ...afterBootstrap, editionNameAttached: true };
    expect(plan(attached)).toEqual({ status: "ready", steps: ["seal-edition"] });
  });

  it("deploys the registrar's bootstrap even when the registrar exists but is unbootstrapped", () => {
    const o: EditionObservation = { ...done, registrarPhase: "created", editionNameAttached: false };
    expect(plan(o)).toEqual({
      status: "ready",
      steps: ["bootstrap-edition", "attach-edition-name", "seal-edition"],
    });
  });

  it("blocks when lanyard.eth is not the organizer's", () => {
    const r = plan({ ...fresh, lanyardOwnedByOrganizer: false });
    expect(r.status).toBe("blocked");
  });

  it("blocks when lanyard.eth expires before the namespace does, and accepts the exact boundary", () => {
    expect(plan({ ...fresh, lanyardExpiry: expiry - 1n }).status).toBe("blocked");
    expect(plan({ ...fresh, lanyardExpiry: expiry }).status).toBe("ready");
  });

  it.each<[string, Partial<EditionObservation>]>([
    ["attached but not deployed", { baseAttachedToLanyard: true }],
    ["lock without set", { baseRegistryDeployed: true, baseParentLocked: true }],
    ["edition name without a registrar", { editionNameAttached: true }],
    ["edition name before bootstrap", { registrarPhase: "created", editionNameAttached: true }],
    ["sealed without the name", { registrarPhase: "sealed", editionNameAttached: false }],
  ])("blocks on inconsistent state: %s", (_label, patch) => {
    expect(plan({ ...fresh, ...patch }).status).toBe("blocked");
  });
});

describe("predictVerifiableProxy", () => {
  // Printed by contracts/test/ens/Ensv2Wiring.t.sol › test_proxyAddressFollowsTheCreate2FormulaTheScriptCopies
  const vector = {
    factory: "0xF62849F9A0B5Bf2913b396098F7c7019b51A820a",
    proxyLogic: "0x4f81992FCe2E1846dD528eC0102e6eE1f61ed3e2",
    sender: "0xEA76a77949a33b9456E691c4c137B047B09037a0",
    salt: 0xba5en,
    proxy: "0x46781a330cdb13EbA104262e2B0DCbd91a6388B7",
    creationCode:
      "0x3d604d80600a3d3981f3363d3d373d3d3d363d734f81992fce2e1846dd528ec0102e6ee1f61ed3e25af43d82803e903d91602b57fd5bf331a23e411656b1f93092647f0dccc409e5a49081bfb0195ab064c225cc689634",
  } as const;

  it("matches the address the real factory created", () => {
    expect(
      predictVerifiableProxy({
        factory: vector.factory,
        proxyLogic: vector.proxyLogic,
        sender: vector.sender,
        salt: vector.salt,
      }),
    ).toBe(vector.proxy);
  });

  it("does not match for a different sender or salt", () => {
    const base = { factory: vector.factory, proxyLogic: vector.proxyLogic, sender: vector.sender };
    expect(predictVerifiableProxy({ ...base, salt: vector.salt + 1n })).not.toBe(vector.proxy);
    expect(
      predictVerifiableProxy({
        ...base,
        sender: "0x0000000000000000000000000000000000000001",
        salt: vector.salt,
      }),
    ).not.toBe(vector.proxy);
  });

  it("builds the same 0x57-byte creation code as CloneProxyBytecode", () => {
    const code = verifiableProxyCreationCode(
      vector.proxyLogic,
      "0x31a23e411656b1f93092647f0dccc409e5a49081bfb0195ab064c225cc689634",
    );
    expect(code).toBe(vector.creationCode);
    expect((code.length - 2) / 2).toBe(0x57);
  });
});

describe("baseRegistrySalt", () => {
  it("is stable and depends on the base name", () => {
    expect(baseRegistrySalt("lanyard.eth")).toBe(baseRegistrySalt("lanyard.eth"));
    expect(baseRegistrySalt("lanyard.eth")).not.toBe(baseRegistrySalt("other.eth"));
  });
});

describe("namespace expiry shared with Solidity", () => {
  // contracts/test/ens/helpers/EnsFixture.sol hard-codes the same placeholder times and result.
  it("matches the value the Foundry fixtures assume", () => {
    expect(eventConfig.times.eventEnd).toBe(1_796_560_200n);
    expect(eventConfig.times.freezeDeadline).toBe(1_796_567_400n);
    expect(expiry).toBe(1_796_567_400n + 30n * 86_400n);
    expect(expiry).toBe(1_799_159_400n); // RegisterBadge.t.sol › test_R4_namespaceExpiryEqualsTheTypescriptFormula
  });
});

describe("registrarMismatches", () => {
  const expected: RegistrarImmutables = {
    organizer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    baseRegistry: "0x2cBC51494744A7A6C2bedc4dD48C0B7C402931bb",
    factory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c",
    userRegistryImplementation: "0xa80338aaa8d23831cea25e858d1774534abb0263",
    eventEnd: 1_796_560_200n,
    freezeDeadline: 1_796_567_400n,
    editionLabel: "mumbai2026",
  };

  it("accepts a registrar built from the same config (address case does not matter)", () => {
    const actual = { ...expected, organizer: expected.organizer.toLowerCase() as Address };
    expect(registrarMismatches(actual, expected)).toEqual([]);
  });

  it.each<[string, Partial<RegistrarImmutables>, RegExp]>([
    ["organizer", { organizer: "0x0000000000000000000000000000000000000001" }, /organizer/],
    ["base registry", { baseRegistry: "0x0000000000000000000000000000000000000002" }, /baseRegistry/],
    ["factory", { factory: "0x0000000000000000000000000000000000000003" }, /factory/],
    [
      "implementation",
      { userRegistryImplementation: "0x0000000000000000000000000000000000000004" },
      /userRegistryImplementation/,
    ],
    ["eventEnd", { eventEnd: 1n }, /eventEnd/],
    ["freezeDeadline", { freezeDeadline: 1n }, /freezeDeadline/],
    ["edition label", { editionLabel: "other2026" }, /editionLabel/],
  ])("reports a different %s", (_name, patch, message) => {
    const out = registrarMismatches({ ...expected, ...patch }, expected);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(message);
  });

  it("lists every difference", () => {
    expect(registrarMismatches({ ...expected, eventEnd: 1n, freezeDeadline: 2n }, expected)).toHaveLength(2);
  });
});

describe("recoverRegistrar", () => {
  const deployed = "0xDC64a140Aa3E981100a9becA4E685f962f0cF6C9";
  it("adopts the contract address from a successful receipt (lowercased)", () => {
    expect(recoverRegistrar({ status: "success", contractAddress: deployed })).toEqual({
      action: "use",
      address: deployed.toLowerCase(),
    });
  });
  it("waits when there is no receipt yet", () => {
    expect(recoverRegistrar(null)).toEqual({ action: "wait" });
  });
  it("redeploys after a reverted deploy, and when a success carries no address", () => {
    expect(recoverRegistrar({ status: "reverted", contractAddress: null })).toEqual({ action: "redeploy" });
    expect(recoverRegistrar({ status: "success", contractAddress: null })).toEqual({ action: "redeploy" });
  });
});
