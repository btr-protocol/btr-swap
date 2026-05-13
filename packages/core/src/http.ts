/**
 * Canonical HTTP wire types for BTR swap service consumers.
 *
 * Back-end (back/services/swap) exposes /api/quote and /api/build over HTTP.
 * Front-end consumes the same shapes. To avoid drift, both sides import these
 * from `@btr-supply/swap` rather than re-declaring locally.
 *
 * Types are derived from the canonical aggregator types in ./types where possible.
 */
import type { ITransactionRequestWithEstimate, RouteKind } from "./types";

/** Mode discriminator for quote/build endpoints. */
export type SwapMode = "user" | "keeper";

/**
 * Request shape accepted by POST /api/quote.
 * Inputs are minimal (chain ids + token addresses); the back-end hydrates IToken internally.
 */
export interface QuoteRequest {
  fromChain: number;
  toChain: number;
  /** Token address or the literal `"native"`. */
  fromToken: string;
  toToken: string;
  /** Input amount in wei (string to preserve precision). */
  fromAmount: string;
  /** Payer address. */
  fromAddress: string;
  /** Receiver address; defaults to `fromAddress` server-side. */
  toAddress?: string;
  /** Optional override; if omitted the server consults well-known tokens, else falls back to 18. */
  fromDecimals?: number;
  toDecimals?: number;
  fromSymbol?: string;
  toSymbol?: string;
  /** Slippage in basis points. */
  slippageBps?: number;
  mode?: SwapMode;
  integrator?: string;
  referrer?: string;
  exchangeBlacklist?: string[];
  bridgeBlacklist?: string[];
}

/**
 * Request shape accepted by POST /api/build.
 * Extends QuoteRequest with an optional aggregator preference.
 */
export interface BuildRequest extends QuoteRequest {
  /** When set, prefer the named aggregator if available. */
  preferAggId?: string;
}

/**
 * Flattened per-route shape returned by the back-end.
 *
 * Derived from a projection of {@link ITransactionRequestWithEstimate}: the back-end
 * collapses `globalEstimates.*` onto the top level and stringifies bigints so the
 * response is JSON-safe and ergonomic for front-end consumers.
 */
export type QuoteResponseRoute = Pick<
  ITransactionRequestWithEstimate,
  "to" | "approveTo" | "latencyMs"
> & {
  aggId: string;
  kind: RouteKind;
  /** Calldata as hex string (Uint8Array form from the SDK is serialized server-side). */
  data?: string;
  /** Native value as decimal string (bigint serialized). */
  value?: string;
  /** Human-readable output amount. */
  output?: string | number;
  /** Output amount in wei (bigint serialized as string). */
  outputWei?: string;
  exchangeRate?: string | number;
  gasCostUsd?: number;
  feeCostUsd?: number;
  /** Number of swap/bridge steps in the route (flattened from `steps.length`). */
  steps?: number;
};

/** Alias for ergonomic front-end imports. */
export type Route = QuoteResponseRoute;

/** Top-level response from POST /api/quote. */
export interface QuoteResponse {
  mode: SwapMode;
  routes: QuoteResponseRoute[];
  /** Convenience: best route by output (already included in `routes`). */
  best?: QuoteResponseRoute;
}

/** Top-level response from POST /api/build (a single route with mode attached). */
export interface BuildResponse extends QuoteResponseRoute {
  mode: SwapMode;
}

/** Error envelope used by both endpoints on non-2xx. */
export interface ErrorResponse {
  error: string;
  detail?: string;
}

/**
 * Project an {@link ITransactionRequestWithEstimate} into the wire-safe
 * {@link QuoteResponseRoute} shape returned by /api/quote and /api/build.
 *
 * - Stringifies bigints (`value`, `outputWei`) so the result is JSON-safe.
 * - Drops non-string `data` (Uint8Array) — only hex-string calldata is forwarded.
 * - Collapses `globalEstimates.*` onto the top level.
 * - Replaces `steps: ISwapStep[]` with `steps: number` (count only).
 */
export const trToRoute = (tr: ITransactionRequestWithEstimate): QuoteResponseRoute => ({
  aggId: String(tr.aggId ?? "UNKNOWN"),
  kind: tr.kind ?? "atomic",
  to: tr.to,
  data: typeof tr.data === "string" ? tr.data : undefined,
  value: tr.value?.toString(),
  approveTo: tr.approveTo,
  output: tr.globalEstimates?.output,
  outputWei: tr.globalEstimates?.outputWei?.toString(),
  exchangeRate: tr.globalEstimates?.exchangeRate,
  gasCostUsd: tr.globalEstimates?.gasCostUsd,
  feeCostUsd: tr.globalEstimates?.feeCostUsd,
  latencyMs: tr.latencyMs,
  steps: tr.steps?.length,
});
