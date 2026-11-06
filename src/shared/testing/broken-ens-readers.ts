// Deliberately wrong readers for the conformance self-test (P0.3-R5).
import type { AtBlock, EnsReader } from "../interfaces/ens-reader";
import type { Label } from "../types/primitives";

/** owner() ignores the requested block and answers for the head. */
export function ownerIgnoresBlock(inner: EnsReader): EnsReader {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "owner") {
        return async (label: Label, _at: AtBlock) =>
          target.owner(label, { sepoliaBlock: await target.headBlock() });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Every failure is swallowed and reported as "no name". */
export function swallowsFailures(inner: EnsReader): EnsReader {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch {
          return null;
        }
      };
    },
  });
}
