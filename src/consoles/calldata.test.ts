import { decodeFunctionData, getAddress, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { lanyardRegistrarAbi } from "../ens/ensv2-abi";
import { partnerHash } from "./authority";
import {
  bookHash,
  registerBadgeData,
  registerPartnerBadgeData,
  registerTeamData,
  unregisterData,
  unregisterAbi,
} from "./calldata";

const OWNER = getAddress("0x00000000000000000000000000000000000000a1");

describe("calldata", () => {
  it("registerBadge uses the keccak book hash", () => {
    const d = decodeFunctionData({
      abi: lanyardRegistrarAbi,
      data: registerBadgeData("hackers", "priya", OWNER),
    });
    expect(d.functionName).toBe("registerBadge");
    expect(d.args).toEqual([keccak256(toHex("hackers")), "priya", OWNER]);
    expect(bookHash("hackers")).toBe(keccak256(toHex("hackers")));
  });
  it("registerTeam carries label and lead", () => {
    const d = decodeFunctionData({ abi: lanyardRegistrarAbi, data: registerTeamData("alpha", OWNER) });
    expect(d.args).toEqual(["alpha", OWNER]);
  });
  it("registerPartnerBadge hashes partner and sub", () => {
    const d = decodeFunctionData({
      abi: lanyardRegistrarAbi,
      data: registerPartnerBadgeData("arkiv", "judges", "ana", OWNER),
    });
    expect(d.args).toEqual([partnerHash("arkiv"), bookHash("judges"), "ana", OWNER]);
  });
  it("unregister takes the label id", () => {
    const d = decodeFunctionData({ abi: unregisterAbi, data: unregisterData("ana") });
    expect(d.args).toEqual([BigInt(keccak256(toHex("ana")))]);
  });
});
