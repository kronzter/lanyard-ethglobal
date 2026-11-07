import { describe, expect, it } from "vitest";
import { lockedWinnerPlace, parsePlace, PrizesParseError } from "./prizes";

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

describe("lockedWinnerPlace", () => {
  const reader = (texts: Record<string, string>) => {
    const calls: string[] = [];
    return {
      calls,
      async text(label: string, key: string, at: { sepoliaBlock: bigint }) {
        calls.push(`${label}|${key}@${at.sepoliaBlock}`);
        return texts[`${label}|${key}`] ?? null;
      },
    };
  };

  it("shows the prize only once the edition's lanyard.locked is 1, read at the same block", async () => {
    const r = reader({ "|lanyard.locked": "1", "winner.zkpay|lanyard.prizes": '["winner"]' });
    expect(await lockedWinnerPlace(r, "zkpay", 42n)).toBe("winner");
    expect(r.calls).toEqual(["|lanyard.locked@42", "winner.zkpay|lanyard.prizes@42"]);
  });

  it.each([[undefined], [""], ["0"], ["true"]])(
    "renders nothing for a declared winner while lanyard.locked is %j",
    async (locked) => {
      const texts: Record<string, string> = { "winner.zkpay|lanyard.prizes": '["winner"]' };
      if (locked !== undefined) texts["|lanyard.locked"] = locked;
      const r = reader(texts);
      expect(await lockedWinnerPlace(r, "zkpay", 7n)).toBeNull();
      expect(r.calls).toEqual(["|lanyard.locked@7"]);
    },
  );

  it("is null after the lock for a team without a prize", async () => {
    expect(await lockedWinnerPlace(reader({ "|lanyard.locked": "1" }), "chainchat", 1n)).toBeNull();
  });
});
