import type { EventConfig } from "../config/schema";
import { requireMeasured } from "../config/unmeasured";
import {
  RabdiDeploymentSchema,
  SepoliaDeploymentSchema,
  type Deployment,
  type LiveDeployment,
  type RabdiDeployment,
  type SepoliaDeployment,
} from "./schema";

export class DeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentError";
  }
}

function parseWith<T>(
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  file: string,
): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => `${i.path.map(String).join(".") || "$"}: ${i.message}`);
  throw new DeploymentError(`${file} is invalid:\n  - ${issues.join("\n  - ")}`);
}

export const parseSepoliaDeployment = (value: unknown): SepoliaDeployment =>
  parseWith(SepoliaDeploymentSchema, value, "deployments/sepolia.json");

export const parseRabdiDeployment = (value: unknown): RabdiDeployment =>
  parseWith(RabdiDeploymentSchema, value, "deployments/rabdi.json");

/**
 * Live providers call this before touching a chain. Rejects mock files and a reset identity
 * that differs from the configured one (which stays blocked until P0.6 measures it).
 */
export function requireLive<D extends Deployment>(deployment: D, config: EventConfig): LiveDeployment<D> {
  if (deployment.mode !== "live") {
    throw new DeploymentError(
      `deployments/${deployment.network}.json is a mock placeholder; live providers need a live deployment`,
    );
  }
  const expected = requireMeasured(
    config.chains[deployment.network].resetId,
    `${deployment.network} reset identity`,
  );
  if (deployment.resetId !== expected) {
    throw new DeploymentError(
      `${deployment.network} reset identity ${deployment.resetId} does not match the config (${expected})`,
    );
  }
  if (deployment.network === "rabdi") {
    const profile = requireMeasured(config.fundingProfile, "funding profile");
    if (deployment.funding.profile !== profile) {
      throw new DeploymentError(
        `rabdi funding profile ${deployment.funding.profile} does not match the config (${profile})`,
      );
    }
  }
  return deployment as LiveDeployment<D>;
}
