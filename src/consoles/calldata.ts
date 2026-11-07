// Calldata for the console actions, matching scripts/ens/* exactly. Pure.
import { encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { dnsEncodeName } from "../ens/dns-name";
import { lanyardRegistrarAbi } from "../ens/ensv2-abi";
import { partnerHash } from "./authority";

export const textSetterAbi = parseAbi(["function setText(bytes name,string key,string value)"]);
export const unregisterAbi = parseAbi([
  "function unregister(uint256 labelId)",
  "function getStatus(uint256 anyId) view returns (uint8)",
  "function getOwner(uint256 anyId) view returns (address)",
]);

export const bookHash = (s: string): Hex => keccak256(toHex(s));
export const labelIdOf = (label: string): bigint => BigInt(keccak256(toHex(label)));

export const registerBadgeData = (book: string, label: string, owner: Address): Hex =>
  encodeFunctionData({
    abi: lanyardRegistrarAbi,
    functionName: "registerBadge",
    args: [bookHash(book), label, owner],
  });

export const registerTeamData = (label: string, lead: Address): Hex =>
  encodeFunctionData({ abi: lanyardRegistrarAbi, functionName: "registerTeam", args: [label, lead] });

export const registerJudgeData = (label: string, owner: Address): Hex =>
  encodeFunctionData({ abi: lanyardRegistrarAbi, functionName: "registerJudge", args: [label, owner] });

export const registerPartnerBadgeData = (partner: string, sub: string, label: string, owner: Address): Hex =>
  encodeFunctionData({
    abi: lanyardRegistrarAbi,
    functionName: "registerPartnerBadge",
    args: [partnerHash(partner), bookHash(sub), label, owner],
  });

export const unregisterData = (label: string): Hex =>
  encodeFunctionData({ abi: unregisterAbi, functionName: "unregister", args: [labelIdOf(label)] });

export const setTextData = (fullName: string, key: string, value: string): Hex =>
  encodeFunctionData({
    abi: textSetterAbi,
    functionName: "setText",
    args: [dnsEncodeName(fullName), key, value],
  });
