// src/config.ts
// Centralized configuration values using interfaces

import { AggId as Id } from "./types";
import { envOrNull, envInt, envApiRoot } from "./utils";

/**
 * Interface for an aggregator's configuration.
 */
export interface AggregatorConfig {
  apiRoot: string;
  apiKey: string | null;
  integrator: string;
  referrer: string | number | null;
  feeBps: number;
}

/**
 * Creates a configuration object for a specific aggregator based on environment variables.
 */
const createConfig = (
  aggId: Id,
  fallbackApiRoot: string,
  apiKeyDefault: string | null = null,
  integratorDefault: string | null = null,
  referrerDefault: string | number | null = null,
  feeBpsDefault: number = 0,
): AggregatorConfig => {
  const apiRoot = envApiRoot(`${aggId}_API_BASE_URL`, fallbackApiRoot);
  const apiKey = envOrNull(`${aggId}_API_KEY`) || apiKeyDefault;
  // Phase 43: default integrator is "btr" (lowercase) across all aggregators.
  // Override via env `<AGGID>_INTEGRATOR=...` or codepath default.
  const integrator = envOrNull(`${aggId}_INTEGRATOR`) || integratorDefault || "btr";
  const referrer = envOrNull(`${aggId}_REFERRER`) || referrerDefault;
  const feeBps = envInt(`${aggId}_FEE_BPS`, feeBpsDefault);
  return { apiRoot, apiKey, integrator, referrer, feeBps };
};

/**
 * Main configuration object holding config objects for each supported aggregator.
 */
const c: Record<Id, AggregatorConfig> = {} as Record<Id, AggregatorConfig>;

// Configuration for each aggregator - [id, apiRoot]
type ConfigTuple = readonly [id: Id, apiRoot: string, feeBps?: number];

const configs: ConfigTuple[] = [
  // Meta-Aggregator
  [Id.LIFI, "li.quest/v1"],
  // On-chain aggregators (no external HTTP API) -`apiRoot` is a placeholder.
  // RPC endpoints are resolved per-chain via env vars (e.g. `BTR_DEX_RPC_1`).
  [Id.BTR_DEX, "onchain.btr.supply/btrdex"],
];

// Initialize all configurations
configs.forEach(([id, apiRoot, feeBps]) => {
  c[id] = createConfig(id, apiRoot, null, null, null, feeBps);
});

export default c;
