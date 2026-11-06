/**
 * Shared types, config, labels and canonical encoding used by both tracks.
 * Runs unchanged on Hermes, in the browser and on Node: no Node, React Native or Expo imports.
 * Owner: both tracks (additive changes only, plans/00-README.md › Interfaces are the contract).
 */
export * from "./types/primitives";
export * from "./labels";
export * from "./canonical";
export * from "./config/unmeasured";
export * from "./config/schema";
export * from "./config/validate";
export * from "./config/hash";
export * from "./event.config";
export * from "./types/venue";
export * from "./url";
export * from "./deployments/schema";
export * from "./deployments/load";
