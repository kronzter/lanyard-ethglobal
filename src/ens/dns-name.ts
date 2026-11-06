// DNS wire encoding of a full ENS name, the `bytes name` argument of PermissionedResolver setters
// (the registrar uses ENSv2's NameCoder.encode for the same thing). Lanyard labels are ASCII.
import { bytesToHex, type Hex } from "viem";

export function dnsEncodeName(name: string): Hex {
  if (name === "") return "0x00";
  const out: number[] = [];
  for (const label of name.split(".")) {
    if (label.length === 0 || label.length > 63) throw new Error(`bad label in ${JSON.stringify(name)}`);
    out.push(label.length);
    for (const ch of label) {
      const c = ch.charCodeAt(0);
      if (c > 0x7e || c < 0x21) throw new Error(`non-ASCII label in ${JSON.stringify(name)}`);
      out.push(c);
    }
  }
  out.push(0);
  return bytesToHex(Uint8Array.from(out));
}
