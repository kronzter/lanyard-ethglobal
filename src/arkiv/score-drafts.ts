// Editable values stay on this installation/profile. Ciphertext is only a remote mirror.
import { z } from "zod";
import { canonicalHash, canonicalJson, parseJsonStrict } from "@/shared/canonical";
import { AddressSchema, Bytes32Schema } from "@/shared/types/primitives";
import type { KeyValueStore } from "./store";

const DraftContextSchema = z
  .object({
    chainId: z.number().int().positive(),
    resetId: Bytes32Schema,
    event: z.string().min(1),
    wallet: AddressSchema,
    submission: Bytes32Schema,
    assignment: Bytes32Schema,
    rubric: Bytes32Schema,
    keyId: z.string().min(1),
  })
  .strict();
export type DraftContext = z.infer<typeof DraftContextSchema>;
const ValuesSchema = z.record(z.string(), z.number().int().min(0).max(10000));
export const draftKey = (context: DraftContext) =>
  `score-draft:v1:${canonicalHash(DraftContextSchema.parse(context))}`;
export class ScoreDrafts {
  constructor(private readonly store: KeyValueStore) {}
  async load(context: DraftContext): Promise<Record<string, number> | null> {
    const text = await this.store.get(draftKey(context));
    if (text === null) return null;
    const data = z
      .object({ context: DraftContextSchema, values: ValuesSchema })
      .strict()
      .parse(parseJsonStrict(text));
    if (canonicalJson(data.context) !== canonicalJson(context))
      throw new Error("Local draft context mismatch");
    return data.values;
  }
  async save(context: DraftContext, values: Record<string, number>): Promise<void> {
    await this.store.set(
      draftKey(context),
      canonicalJson({ context: DraftContextSchema.parse(context), values: ValuesSchema.parse(values) }),
    );
  }
}
