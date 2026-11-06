import { describe, expect, it } from "vitest";
import {
  SHIFT_MANAGER,
  encodePermissionEnvelope,
  grantsPermission,
  parsePermissionEnvelope,
  type PermissionEnvelope,
} from "../ens/permission-envelope";
import { registrationIdOf } from "../ens/registration-id";
import type { Address, Hex } from "../types/primitives";

const registry: Address = "0x00000000000000000000000000000000000000aa";
const resource = (n: string): Hex => `0x${n.repeat(64)}`;
const priya: Address = "0x00000000000000000000000000000000000000b1";
const regA = registrationIdOf({ chainId: 11155111, registry, resource: resource("1") });
const regB = registrationIdOf({ chainId: 11155111, registry, resource: resource("2") });
const envelope = (patch: Partial<PermissionEnvelope> = {}): PermissionEnvelope => ({
  schemaVersion: 1,
  registrationId: regA,
  holder: priya,
  permissions: [SHIFT_MANAGER],
  ...patch,
});

describe("registrationIdOf", () => {
  it("is deterministic and case-insensitive in its inputs", () => {
    expect(regA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      registrationIdOf({
        chainId: 11155111,
        registry: registry.toUpperCase().replace("0X", "0x") as Address,
        resource: resource("1"),
      }),
    ).toBe(regA);
  });

  it("changes with the registration resource, the registry and the chain", () => {
    expect(regB).not.toBe(regA);
    expect(
      registrationIdOf({
        chainId: 11155111,
        registry: "0x00000000000000000000000000000000000000ab",
        resource: resource("1"),
      }),
    ).not.toBe(regA);
    expect(registrationIdOf({ chainId: 1, registry, resource: resource("1") })).not.toBe(regA);
  });

  it("rejects malformed inputs", () => {
    expect(() => registrationIdOf({ chainId: 11155111, registry, resource: "0x1234" })).toThrow(/32-byte/);
    expect(() => registrationIdOf({ chainId: 0, registry, resource: resource("1") })).toThrow(/chainId/);
  });
});

describe("permission envelope", () => {
  it("round-trips the canonical text", () => {
    const text = encodePermissionEnvelope(envelope());
    expect(text).toBe(
      `{"holder":"${priya}","permissions":["shift-manager"],"registrationId":"${regA}","schemaVersion":1}`,
    );
    expect(parsePermissionEnvelope(text)).toEqual(envelope());
  });

  it("refuses to encode unsorted, duplicate or uppercase values", () => {
    expect(() => encodePermissionEnvelope(envelope({ permissions: ["z", "a"] }))).toThrow(/sorted/);
    expect(() => encodePermissionEnvelope(envelope({ permissions: ["a", "a"] }))).toThrow(/unique/);
    expect(() =>
      encodePermissionEnvelope(envelope({ holder: priya.replace("b1", "B1") as Address })),
    ).toThrow(/lowercase/);
  });

  it.each([
    ["a legacy bare permission", "shift-manager"],
    ["a legacy comma list", "shift-manager,ticket-admin"],
    ["non-canonical whitespace", JSON.stringify(envelope(), null, 2)],
    [
      "non-canonical key order",
      JSON.stringify({ schemaVersion: 1, registrationId: regA, holder: priya, permissions: [SHIFT_MANAGER] }),
    ],
    [
      "an unknown field",
      `{"extra":1,"holder":"${priya}","permissions":["shift-manager"],"registrationId":"${regA}","schemaVersion":1}`,
    ],
    [
      "a duplicate key",
      `{"holder":"${priya}","holder":"${priya}","permissions":[],"registrationId":"${regA}","schemaVersion":1}`,
    ],
    [
      "a wrong schema version",
      `{"holder":"${priya}","permissions":["shift-manager"],"registrationId":"${regA}","schemaVersion":2}`,
    ],
    ["an empty value", ""],
  ])("parses %s as no grant", (_name, text) => {
    expect(parsePermissionEnvelope(text)).toBeNull();
    expect(grantsPermission(text, { registrationId: regA, owner: priya }, SHIFT_MANAGER)).toBe(false);
  });

  it("grants only for the bound registration and holder", () => {
    const text = encodePermissionEnvelope(envelope());
    expect(grantsPermission(text, { registrationId: regA, owner: priya }, SHIFT_MANAGER)).toBe(true);
    // Reissued badge: same label, new registration, old note still readable.
    expect(grantsPermission(text, { registrationId: regB, owner: priya }, SHIFT_MANAGER)).toBe(false);
    // Different holder.
    expect(
      grantsPermission(
        text,
        { registrationId: regA, owner: "0x00000000000000000000000000000000000000c2" },
        SHIFT_MANAGER,
      ),
    ).toBe(false);
    // Invalid owner (expired, unregistered) reads as null.
    expect(grantsPermission(text, { registrationId: null, owner: null }, SHIFT_MANAGER)).toBe(false);
    // A permission the note does not carry.
    expect(grantsPermission(text, { registrationId: regA, owner: priya }, "ticket-admin")).toBe(false);
  });

  it("compares the badge's owner case-insensitively", () => {
    const text = encodePermissionEnvelope(envelope());
    expect(
      grantsPermission(
        text,
        { registrationId: regA, owner: priya.replace("b1", "B1") as Address },
        SHIFT_MANAGER,
      ),
    ).toBe(true);
  });
});
