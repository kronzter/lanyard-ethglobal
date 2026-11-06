// Minimal ABIs and role constants for the ENSv2 contracts the deploy script and later readers touch.
// Sources: ensdomains/contracts-v2 at f2f0a05 (src/registry, src/access-control) and
// contracts/src/ens/LanyardRegistrar.sol. The role layout is checked against Solidity by
// contracts/test/ens/Ensv2Wiring.t.sol and, in this repo, by ensv2-abi.test.ts.
import { parseAbi } from "viem";

/** Role bits (one nybble each); an admin role is the same bit shifted left by 128. */
export const ROLE = {
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  UPGRADE: 1n << 124n,
} as const;

export const admin = (role: bigint): bigint => role << 128n;

/** The registry's transfer bit already lives in the admin half of the bitmap. */
export const ROLE_CAN_TRANSFER_ADMIN = (1n << 28n) << 128n;

/** Registrar roles on the base registry's `mumbai2026`-style name (RENEW, SET_RESOLVER and its admin). */
export const EDITION_NAME_ROLES = ROLE.RENEW | ROLE.SET_RESOLVER | admin(ROLE.SET_RESOLVER);

/** Roles the deploy script gives the organizer on the base registry while setting it up. */
export const BASE_SETUP_ROLES = ROLE.REGISTRAR | ROLE.RENEW | ROLE.SET_PARENT | admin(ROLE.SET_PARENT);

export const FAR_FUTURE = (1n << 64n) - 1n;

export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "function proxyLogic() view returns (address)",
  "function verifyContract(address proxy) view returns (address implementation)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const userRegistryInitAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants)",
]);

export const permissionedRegistryAbi = parseAbi([
  "function getOwner(uint256 anyId) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getStatus(uint256 anyId) view returns (uint8)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getParent() view returns (address parent, string label)",
  "function roles(uint256 anyId, address account) view returns (uint256)",
  "function roleCount(uint256 anyId) view returns (uint256)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function isEmancipated() view returns (bool)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function setParent(address parent, string label)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
]);

export const lanyardRegistrarAbi = parseAbi([
  "constructor(address organizer, address factory, address userRegistryImplementation, address baseRegistry, string editionLabel, uint64 eventEnd, uint64 freezeDeadline)",
  "function organizer() view returns (address)",
  "function baseRegistry() view returns (address)",
  "function namespaceExpiry() view returns (uint64)",
  "function editionLabel() view returns (string)",
  "function phase() view returns (uint8)",
  "function edition() view returns (address)",
  "function publicationResolver() view returns (address)",
  "function editionNameRoles() pure returns (uint256)",
  "function bootstrapEdition()",
  "function seal()",
  "function setPublicationResolver(address resolver)",
  "event EditionBootstrapped(address indexed edition, string label)",
  "event EditionSealed(address indexed edition)",
  "event PublicationResolverSet(address indexed resolver)",
]);

/** `LanyardRegistrar.Phase` as the contract encodes it. */
export const REGISTRAR_PHASE = ["created", "bootstrapped", "sealed"] as const;
export type RegistrarPhase = (typeof REGISTRAR_PHASE)[number];
