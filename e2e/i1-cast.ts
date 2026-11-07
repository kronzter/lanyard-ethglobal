// The I1 live cast and the public record of its seeding (fixtures/sepolia-personas.json).
// Mock addresses in fixtures/personas.json stay untouched: rules vectors and mock mode commit to them.
import { z } from "zod";

/** Team zkpay (Person A–D) and two volunteers: the A1 identities I1 writes records with. */
// The demo adds a second north-zone volunteer (anita), Arkiv partner staff (sam) and an Arkiv partner judge (ana).
export const I1_CAST = [
  "zkpay-a",
  "zkpay-b",
  "zkpay-c",
  "zkpay-d",
  "priya",
  "ravi",
  "anita",
  "sam",
  "ana",
] as const;

export const SEPOLIA_PERSONAS_FILE = "fixtures/sepolia-personas.json";

const hex = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`))
    .transform((s) => s as `0x${string}`);
const block = z.string().regex(/^[0-9]+$/);
const drip = z
  .object({ tx: hex(32).nullable(), record: hex(32) })
  .strict()
  .nullable();

const SepoliaPersonaSchema = z
  .object({
    id: z.string(),
    by: z.string(),
    keyEnv: z.string().regex(/^LANYARD_KEY_[A-Z0-9_]+$/),
    address: hex(20),
    names: z.array(z.object({ label: z.string(), tx: hex(32).nullable(), block: block.nullable() }).strict()),
    drip,
  })
  .strict();

const SepoliaPersonasSchema = z
  .object({
    schemaVersion: z.literal(1),
    network: z.literal("sepolia"),
    edition: z.string(),
    organizer: hex(20),
    organizerDrip: drip,
    personas: z.array(SepoliaPersonaSchema),
  })
  .strict();

export type SepoliaPersona = z.infer<typeof SepoliaPersonaSchema>;
export type SepoliaPersonas = z.infer<typeof SepoliaPersonasSchema>;
export const parseSepoliaPersonas = (v: unknown): SepoliaPersonas => SepoliaPersonasSchema.parse(v);
