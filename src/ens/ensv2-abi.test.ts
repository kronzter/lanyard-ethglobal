import { describe, expect, it } from "vitest";
import {
  admin,
  BASE_SETUP_ROLES,
  EDITION_NAME_ROLES,
  FAR_FUTURE,
  ROLE,
  ROLE_CAN_TRANSFER_ADMIN,
} from "./ensv2-abi";
import { ensv2Sepolia } from "./ensv2-sepolia";

describe("ENSv2 role layout (mirrors RegistryRolesLib at f2f0a05)", () => {
  it("puts each role in its own nybble", () => {
    expect(ROLE.REGISTRAR).toBe(1n);
    expect(ROLE.REGISTER_RESERVED).toBe(16n);
    expect(ROLE.SET_PARENT).toBe(256n);
    expect(ROLE.RENEW).toBe(65_536n);
    expect(ROLE.UPGRADE).toBe(1n << 124n);
  });

  it("shifts admin roles up by 128 bits", () => {
    expect(admin(ROLE.SET_RESOLVER)).toBe(ROLE.SET_RESOLVER << 128n);
    expect(ROLE_CAN_TRANSFER_ADMIN).toBe(1n << 156n);
  });

  it("composes the bitmaps the registrar and script agree on", () => {
    expect(EDITION_NAME_ROLES).toBe(ROLE.RENEW | ROLE.SET_RESOLVER | admin(ROLE.SET_RESOLVER));
    expect(EDITION_NAME_ROLES & ROLE_CAN_TRANSFER_ADMIN).toBe(0n);
    expect(EDITION_NAME_ROLES & ROLE.SET_SUBREGISTRY).toBe(0n);
    expect(BASE_SETUP_ROLES & ROLE.UPGRADE).toBe(0n);
    expect(FAR_FUTURE).toBe(2n ** 64n - 1n);
  });
});

describe("Sepolia ENSv2 addresses", () => {
  it("are distinct nonzero 20-byte lowercase addresses", () => {
    const all = Object.values(ensv2Sepolia);
    for (const a of all) expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(new Set(all).size).toBe(all.length);
  });
});
