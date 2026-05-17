import { BaseAggregator } from "./abstract";
import { btrDexAggregator } from "./BtrDex";
import config from "./config";
import {
  addresses,
  aggregatorsWithContractCalls,
  defaultAggregators,
  MAX_SLIPPAGE_BPS,
  nativeTokenAddress,
  zeroAddress,
} from "./constants";
import { lifiAggregator } from "./LiFi";
import {
  DisplayMode,
  IBtrSwapCliParams,
  IBtrSwapParams,
  ITransactionRequestWithEstimate,
  SerializationMode,
  AggId,
} from "./types";
import {
  compactTrs,
  getToken,
  getPerformance,
  getPerformanceTable,
  paramsToString,
  serialize,
  sortTrsByRate,
  toJSON,
} from "./utils";

/** Mapping of AggId to its corresponding Aggregator implementation instance. */
export const aggregatorById: Partial<{ [key in AggId]: BaseAggregator }> = {
  // Meta-Aggregator
  [AggId.LIFI]: lifiAggregator,
  // On-chain (native BTR DEX router) -no external API
  [AggId.BTR_DEX]: btrDexAggregator,
};

/**
 * Fetches the best transaction request and extracts its calldata.
 * Useful for scenarios where only the transaction calldata is needed.
 * @param o - BTR Swap parameters.
 * @returns A promise resolving to the transaction calldata string, or an empty string if no data is found.
 */
export async function getCallData(o: IBtrSwapParams): Promise<string> {
  // Fetches the best transaction request and returns its data field.
  return (await getBestTransactionRequest(o))?.data?.toString() ?? "";
}

/**
 * Fetches transaction requests concurrently from multiple specified aggregators.
 * Sorts the successful results by the best estimated output amount (exchange rate).
 * Includes a timeout mechanism for each aggregator request.
 * @param o - BTR Swap parameters.
 * @returns Array of successful transaction requests sorted by rate, or undefined if none succeed.
 * @throws {Error} If no viable routes are found.
 */
export async function getAllTimedTr(
  params: IBtrSwapParams,
): Promise<ITransactionRequestWithEstimate[]> {
  const aggIds = params.aggIds ?? defaultAggregators;
  const filteredAggIds = aggIds.filter((id) => aggregatorById[id]);

  params.expiryMs ??= 5_000; // 5s timeout

  // Fetch quotes concurrently with timeout
  const trs = (
    await Promise.all(
      filteredAggIds.map(
        async (aggId: string): Promise<ITransactionRequestWithEstimate | undefined> => {
          const aggregator = aggregatorById[aggId as AggId];
          if (!aggregator) throw new Error(`Aggregator not found: ${aggId}`);

          try {
            const timeoutPromise = new Promise<undefined>((resolve) =>
              setTimeout(() => resolve(undefined), params.expiryMs),
            );

            const tr = await Promise.race([aggregator.getTimedTr(params), timeoutPromise]);
            if (tr && !tr.aggId) tr.aggId = aggregator.id;
            return tr;
          } catch (e) {
            console.error(`[${aggId}] Error retrieving tx`, e);
            return undefined;
          }
        },
      ),
    )
  ).filter(Boolean) as ITransactionRequestWithEstimate[];

  if (trs.length === 0) {
    throw new Error(
      `No viable routes found for ${paramsToString(params)} across aggregators: ${filteredAggIds.join(", ")}`,
    );
  }

  // Sort by best rate and ensure correct payer address
  const sortedTrs = sortTrsByRate(trs);
  sortedTrs.forEach((tr) => {
    if (tr?.data) tr.from = params.payer;
  });

  return sortedTrs;
}

/**
 * Fetches the single best transaction request from the available aggregators.
 * It determines the "best" request based on the highest estimated output amount after fetching from all specified aggregators.
 * Uses `getAllTimedTr` internally.
 * @param o - BTR Swap parameters.
 * @returns A promise resolving to the best transaction request, or undefined if none found.
 */
export const getBestTransactionRequest = async (
  o: IBtrSwapParams,
): Promise<ITransactionRequestWithEstimate | undefined> => (await getAllTimedTr(o))?.[0];

// Export types and functions needed by the CLI and other consumers
export {
  addresses,
  aggregatorsWithContractCalls,
  compactTrs,
  config,
  defaultAggregators,
  DisplayMode,
  getToken,
  getPerformance,
  getPerformanceTable,
  MAX_SLIPPAGE_BPS,
  nativeTokenAddress,
  SerializationMode,
  serialize,
  toJSON,
  AggId,
  zeroAddress,
};
export type { IBtrSwapCliParams, IBtrSwapParams, ITransactionRequestWithEstimate };

// HTTP wire types + projection helper for BTR swap service consumers
// (back/services/swap and front/src/lib/api/swap).
export { trToRoute } from "./http";
export type {
  BuildRequest,
  BuildResponse,
  ErrorResponse,
  QuoteRequest,
  QuoteResponse,
  QuoteResponseRoute,
  Route,
  SwapMode,
} from "./http";

// LiFi Intents (OIF / Catalyst) — server-side only.
export {
  requestIntentQuote,
  submitIntentOrder,
  getIntentStatus,
  getIntentChains,
  getIntentRoutes,
  getIntentApiBase,
  listIntentOrders,
  orderToWire,
} from "./LiFi/intent";
export { encodeInteropAddress, decodeInteropAddress } from "./LiFi/intent-types";
export type {
  IBtrIntentParams,
  IEIP712TypedData,
  ILifiIntentInput,
  ILifiIntentOutput,
  ILifiIntentPayload,
  ILifiIntentQuote,
  ILifiIntentQuoteRequest,
  ILifiIntentQuoteResponse,
  ILifiIntentRequestMetadata,
  ILifiIntentStatusParams,
  ILifiIntentStatusResponse,
  ILifiIntentSubmitRequest,
  ILifiIntentSubmitResponse,
  ILifiSupportedChain,
  ILifiSupportedChainsResponse,
  IMandateOutput,
  IntentOrderStatus,
  IntentOrderType,
  IntentSettlerKind,
  IntentSupportedType,
  IntentSwapType,
  IStandardOrder,
  LifiIntentType,
  OrderStatus,
  OrderType,
  Hex,
  InteropAddress,
} from "./LiFi/intent-types";
