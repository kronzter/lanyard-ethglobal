import { describe, expect, it } from "vitest";
import { parsePlace, PrizesParseError } from "./prizes";

describe("parsePlace", () => {
  it("is null when the record is absent or empty", () => {
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace(undefined)).toBeNull();
    expect(parsePlace("")).toBeNull();
    expect(parsePlace("[]")).toBeNull();
  });
  it("reads winner and runner-up", () => {
    expect(parsePlace('["winner"]')).toBe("winner");
    expect(parsePlace('["runner-up"]')).toBe("runner-up");
  });
  it("prefers winner when several prizes are listed, and ignores other prize strings", () => {
    expect(parsePlace('["runner-up","winner","Best use of Arkiv, with comma"]')).toBe("winner");
    expect(parsePlace('["Best use of Arkiv"]')).toBeNull();
  });
  it("throws on a malformed record", () => {
    expect(() => parsePlace("winner")).toThrow(PrizesParseError);
    expect(() => parsePlace('{"a":1}')).toThrow(PrizesParseError);
    expect(() => parsePlace('["winner",1]')).toThrow(PrizesParseError);
  });
});
