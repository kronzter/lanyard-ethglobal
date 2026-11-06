// Pure planning for scripts/ens/deploy-edition.ts: what is still to do, given what the chain shows.
// No network, no clock. The script observes, calls planEditionSteps, then executes the steps in order,
// so a run that stops half way resumes where it stopped and a finished run plans nothing.
import {
  concat,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

export type EditionStep =
  | "deploy-base-registry"
  | "attach-base-registry"
  | "set-base-parent"
  | "lock-base-parent"
  | "deploy-registrar"
  | "bootstrap-edition"
  | "attach-edition-name"
  | "seal-edition";

export type EditionObservation = {
  /** `lanyard.eth` is owned by the organizer in the ETH registry. */
  lanyardOwnedByOrganizer: boolean;
  /** Expiry of `lanyard.eth` and the lifetime the namespace needs (`namespaceExpiry`). */
  lanyardExpiry: bigint;
  namespaceExpiry: bigint;
  /** The base registry proxy exists. */
  baseRegistryDeployed: boolean;
  /** `lanyard.eth`'s subregistry is the base registry. */
  baseAttachedToLanyard: boolean;
  /** The base registry's parent pointer is (ETH registry, "lanyard"). */
  baseParentSet: boolean;
  /** The organizer no longer holds set-parent or its admin on the base registry. */
  baseParentLocked: boolean;
  /** A `LanyardRegistrar` for this edition exists; null when none has been deployed. */
  registrarPhase: "created" | "bootstrapped" | "sealed" | null;
  /** The base registry's edition name is owned by the registrar. */
  editionNameAttached: boolean;
};

export type EditionPlan = { status: "blocked"; reason: string } | { status: "ready"; steps: EditionStep[] };

/** The remaining steps in execution order; `steps` is empty once everything is done. */
export function planEditionSteps(o: EditionObservation): EditionPlan {
  const blocked = (reason: string): EditionPlan => ({ status: "blocked", reason });

  if (!o.lanyardOwnedByOrganizer) {
    return blocked(
      "lanyard.eth is not owned by the organizer wallet in the ETH registry; register it first (plans/A1-namespace.md › A1.1 tasks)",
    );
  }
  if (o.lanyardExpiry < o.namespaceExpiry) {
    return blocked(
      `lanyard.eth expires at ${o.lanyardExpiry}, before the namespace needs ${o.namespaceExpiry}; renew it first`,
    );
  }
  if (!o.baseRegistryDeployed && (o.baseAttachedToLanyard || o.baseParentSet || o.baseParentLocked)) {
    return blocked("base registry state is inconsistent: it is attached or configured but not deployed");
  }
  if (o.baseParentLocked && !o.baseParentSet) {
    return blocked("base registry state is inconsistent: set-parent is revoked but the parent was never set");
  }
  if (o.registrarPhase === null && o.editionNameAttached) {
    return blocked(
      "edition name is attached but no registrar is recorded; recover the registrar address first",
    );
  }
  if (o.registrarPhase === "created" && o.editionNameAttached) {
    return blocked("edition name is attached before the edition registry was bootstrapped");
  }
  if (o.registrarPhase === "sealed" && !o.editionNameAttached) {
    return blocked("registrar is sealed but does not own the edition name");
  }

  const steps: EditionStep[] = [];
  if (!o.baseRegistryDeployed) steps.push("deploy-base-registry");
  if (!o.baseAttachedToLanyard) steps.push("attach-base-registry");
  if (!o.baseParentSet) steps.push("set-base-parent");
  if (!o.baseParentLocked) steps.push("lock-base-parent");
  if (o.registrarPhase === null) steps.push("deploy-registrar");
  if (o.registrarPhase === null || o.registrarPhase === "created") steps.push("bootstrap-edition");
  if (!o.editionNameAttached) steps.push("attach-edition-name");
  if (o.registrarPhase !== "sealed") steps.push("seal-edition");
  return { status: "ready", steps };
}

/** EIP-1167-style clone creation code `VerifiableFactory` uses (CloneProxyBytecode.sol, 0x57 bytes). */
export function verifiableProxyCreationCode(logic: Address, salt: Hex): Hex {
  return concat([
    "0x3d604d80600a3d3981f3363d3d373d3d3d363d73",
    logic.toLowerCase() as Hex,
    "0x5af43d82803e903d91602b57fd5bf3",
    salt,
  ]);
}

/**
 * The address `VerifiableFactory.deployProxy(impl, salt, …)` creates when `sender` calls it. Lets a
 * resumed run find a proxy it deployed earlier without scanning logs.
 */
export function predictVerifiableProxy(args: {
  factory: Address;
  proxyLogic: Address;
  sender: Address;
  salt: bigint;
}): Address {
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [args.sender, args.salt]),
  );
  return getCreate2Address({
    from: args.factory,
    salt: outerSalt,
    bytecodeHash: keccak256(verifiableProxyCreationCode(args.proxyLogic, outerSalt)),
  });
}

/** Salts the script uses; the factory namespaces them by caller. */
export const baseRegistrySalt = (baseName: string): bigint =>
  BigInt(keccak256(toHex(`lanyard.base:${baseName}`)));

/** What a recorded registrar was built with; compared with the config before a resumed run trusts it. */
export type RegistrarImmutables = {
  organizer: Address;
  baseRegistry: Address;
  factory: Address;
  userRegistryImplementation: Address;
  eventEnd: bigint;
  freezeDeadline: bigint;
  editionLabel: string;
};

/** Every way `actual` differs from `expected` (empty when the registrar matches the config). */
export function registrarMismatches(actual: RegistrarImmutables, expected: RegistrarImmutables): string[] {
  const out: string[] = [];
  const addr = ["organizer", "baseRegistry", "factory", "userRegistryImplementation"] as const;
  for (const key of addr) {
    if (actual[key].toLowerCase() !== expected[key].toLowerCase())
      out.push(`${key} is ${actual[key]}, expected ${expected[key]}`);
  }
  for (const key of ["eventEnd", "freezeDeadline"] as const) {
    if (actual[key] !== expected[key]) out.push(`${key} is ${actual[key]}, expected ${expected[key]}`);
  }
  if (actual.editionLabel !== expected.editionLabel)
    out.push(
      `editionLabel is ${JSON.stringify(actual.editionLabel)}, expected ${JSON.stringify(expected.editionLabel)}`,
    );
  return out;
}

export type DeployTxReceipt = { status: "success" | "reverted"; contractAddress: Address | null } | null;

/**
 * A registrar deploy transaction was recorded but its address was not. Decide from its receipt whether to
 * adopt the address, wait for the transaction, or deploy again.
 */
export function recoverRegistrar(
  receipt: DeployTxReceipt,
): { action: "use"; address: Address } | { action: "wait" } | { action: "redeploy" } {
  if (receipt === null) return { action: "wait" };
  if (receipt.status === "success" && receipt.contractAddress)
    return { action: "use", address: receipt.contractAddress.toLowerCase() as Address };
  return { action: "redeploy" };
}
