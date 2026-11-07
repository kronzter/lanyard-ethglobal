// On-chain observations the screens feed to the pure planners (same reads as scripts/ens/*).
import { keccak256, toHex, type Address, type PublicClient } from "viem";
import { permissionedRegistryAbi, lanyardRegistrarAbi } from "../ens/ensv2-abi";
import { registryReadAbi } from "../ens/registry-read";
import { toFullName } from "../shared/labels";
import { eventConfig } from "../shared/event.config";
import { bookHash, unregisterAbi } from "./calldata";
import { partnerHash } from "./authority";
import type { TeamFlowInput } from "./team-flow";
import type { Live } from "./useConsole";

export const idOf = (label: string): bigint => BigInt(keccak256(toHex(label)));

export async function bookRegistry(pc: PublicClient, live: Live, book: string): Promise<Address> {
  return pc.readContract({
    address: live.registrar,
    abi: lanyardRegistrarAbi,
    functionName: "bookRegistry",
    args: [bookHash(book)],
  });
}

export async function partnerBookRegistry(
  pc: PublicClient,
  live: Live,
  partner: string,
  sub: string,
): Promise<Address> {
  return pc.readContract({
    address: live.registrar,
    abi: lanyardRegistrarAbi,
    functionName: "partnerBookRegistry",
    args: [partnerHash(partner), bookHash(sub)],
  });
}

export const ownerOf = (pc: PublicClient, registry: Address, label: string): Promise<Address> =>
  pc.readContract({ address: registry, abi: unregisterAbi, functionName: "getOwner", args: [idOf(label)] });

export const statusOf = (pc: PublicClient, registry: Address, label: string): Promise<number> =>
  pc.readContract({ address: registry, abi: unregisterAbi, functionName: "getStatus", args: [idOf(label)] });

export async function readUrl(pc: PublicClient, live: Live, label: string): Promise<string | null> {
  return pc.getEnsText({
    name: toFullName(label, eventConfig),
    key: "url",
    universalResolverAddress: live.universalResolver,
  });
}

/** Everything `planTeamFlow` needs for one team, read fresh from chain. */
export async function observeTeam(
  pc: PublicClient,
  live: Live,
  label: string,
  lead: Address,
): Promise<TeamFlowInput> {
  const hash = keccak256(toHex(label));
  const id = BigInt(hash);
  const reg = (functionName: "teamRegistry" | "teamLead") =>
    pc.readContract({ address: live.registrar, abi: lanyardRegistrarAbi, functionName, args: [hash] });
  const edOwner = () =>
    pc.readContract({
      address: live.edition,
      abi: permissionedRegistryAbi,
      functionName: "getOwner",
      args: [id],
    });
  const edStatus = () =>
    pc.readContract({
      address: live.edition,
      abi: permissionedRegistryAbi,
      functionName: "getStatus",
      args: [id],
    });
  const edExpiry = () =>
    pc.readContract({
      address: live.edition,
      abi: permissionedRegistryAbi,
      functionName: "getExpiry",
      args: [id],
    });
  const [
    registeredChild,
    registeredLead,
    currentOwner,
    currentChild,
    status,
    expiry,
    minimumExpiry,
    resolver,
    url,
  ] = await Promise.all([
    reg("teamRegistry"),
    reg("teamLead"),
    edOwner(),
    pc.readContract({
      address: live.edition,
      abi: permissionedRegistryAbi,
      functionName: "getSubregistry",
      args: [label],
    }),
    edStatus(),
    edExpiry(),
    pc.readContract({ address: live.registrar, abi: lanyardRegistrarAbi, functionName: "namespaceExpiry" }),
    pc.readContract({
      address: live.edition,
      abi: registryReadAbi,
      functionName: "getResolver",
      args: [label],
    }) as Promise<Address>,
    readUrl(pc, live, label).catch(() => null),
  ]);
  return {
    label,
    lead,
    team: {
      registeredChild,
      registeredLead,
      currentOwner,
      currentChild,
      status,
      expiry,
      minimumExpiry: BigInt(minimumExpiry),
    },
    resolver,
    currentUrl: url,
    hackersResolver: live.hackersResolver,
    publicAppOrigin: live.publicAppOrigin,
    repair: false,
  };
}
