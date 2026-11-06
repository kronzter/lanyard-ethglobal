// deployments/{sepolia,rabdi}.json (plans/P0-foundation.md › P0.2-R3).
// `mode: "mock"` files are placeholders that need no secrets or real deployments; fixtures
// never masquerade as live. Live files carry nonzero addresses and the chain's reset identity.
import { z } from "zod";
import { RABDI_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../config/schema";
import { Bytes32Schema, NonZeroAddressSchema } from "../types/primitives";
import { isAppOrigin } from "../url";

const BlockNumberSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "block numbers are base-10 strings")
  .transform((v) => BigInt(v));

const origin = (allowLocalhost: boolean) =>
  z
    .string()
    .refine(
      (v) => isAppOrigin(v, { allowLocalhost }),
      allowLocalhost
        ? "expected an https origin or http://localhost"
        : "live deployments need an https origin (no path)",
    );

const mock = <N extends string, C extends number>(network: N, chainId: C) =>
  z.object({
    network: z.literal(network),
    chainId: z.literal(chainId),
    mode: z.literal("mock"),
    note: z.string().min(1),
  });

export const SepoliaDeploymentSchema = z.discriminatedUnion("mode", [
  mock("sepolia", SEPOLIA_CHAIN_ID)
    .extend({ publicAppOrigin: origin(true) })
    .strict(),
  z
    .object({
      network: z.literal("sepolia"),
      chainId: z.literal(SEPOLIA_CHAIN_ID),
      mode: z.literal("live"),
      resetId: Bytes32Schema,
      deployedAtBlock: BlockNumberSchema,
      /** Edition-specific HTTPS origin for public team pages (ENS `url` records point here). */
      publicAppOrigin: origin(false),
      contracts: z
        .record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), NonZeroAddressSchema)
        .refine((r) => Object.keys(r).length > 0, "a live deployment lists its contracts"),
    })
    .strict(),
]);

export const FundingSchema = z.discriminatedUnion("profile", [
  z.object({ profile: z.literal("faucet-contract"), faucet: NonZeroAddressSchema }).strict(),
  z.object({ profile: z.literal("desk-wallet"), deskWallet: NonZeroAddressSchema }).strict(),
]);

export const RabdiDeploymentSchema = z.discriminatedUnion("mode", [
  mock("rabdi", RABDI_CHAIN_ID).strict(),
  z
    .object({
      network: z.literal("rabdi"),
      chainId: z.literal(RABDI_CHAIN_ID),
      mode: z.literal("live"),
      resetId: Bytes32Schema,
      deployedAtBlock: BlockNumberSchema,
      funding: FundingSchema,
    })
    .strict(),
]);

export type SepoliaDeployment = z.output<typeof SepoliaDeploymentSchema>;
export type RabdiDeployment = z.output<typeof RabdiDeploymentSchema>;
export type Deployment = SepoliaDeployment | RabdiDeployment;
export type LiveDeployment<D extends Deployment> = Extract<D, { mode: "live" }>;
