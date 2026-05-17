/**
 * Li.Fi Intents (OIF / Catalyst) — request layer.
 *
 * Spec: /tmp/btr_lifi_intent_spec.md §2. Base URL `https://order.li.fi`
 * (override via env `LIFI_INTENT_API_BASE_URL`, e.g. `https://order-dev.li.fi`).
 *
 * Auth: integrators are currently unauthenticated; the `x-lifi-api-key`
 * header is still attached when an env key is present for forward-compat.
 *
 * Server-only: never invoke from a browser bundle (see back/services/swap).
 */

import { fetchJson, envApiRoot, envOrNull } from "../utils";
import type {
  ILifiIntentQuoteRequest,
  ILifiIntentQuoteResponse,
  ILifiIntentSubmitRequest,
  ILifiIntentSubmitResponse,
  ILifiIntentStatusParams,
  ILifiIntentStatusResponse,
} from "./intent-types";

/** Resolve Li.Fi Intent base URL (env override + sane default). */
export const getIntentApiBase = (): string => envApiRoot("LIFI_INTENT_API_BASE_URL", "order.li.fi");

/** Construct outbound headers; integrator unauth'd but key sent for forward-compat. */
const intentHeaders = (apiKey?: string | null): Record<string, string> => ({
  "Content-Type": "application/json",
  "Accept": "application/json",
  ...(apiKey && { "x-lifi-api-key": apiKey }),
});

const resolveKey = (override?: string): string | null => override ?? envOrNull("LIFI_API_KEY");

/** `POST /quote/request` — fetch standing intent quote(s). */
export async function requestIntentQuote(
  body: ILifiIntentQuoteRequest,
  apiKey?: string,
): Promise<ILifiIntentQuoteResponse> {
  const url = new URL(`${getIntentApiBase()}/quote/request`);
  return fetchJson<ILifiIntentQuoteResponse>(url, {
    method: "POST",
    headers: intentHeaders(resolveKey(apiKey)),
    body: JSON.stringify(body),
  });
}

/** `POST /orders/submit` — submit signed StandardOrder. */
export async function submitIntentOrder(
  body: ILifiIntentSubmitRequest,
  apiKey?: string,
): Promise<ILifiIntentSubmitResponse> {
  const url = new URL(`${getIntentApiBase()}/orders/submit`);
  return fetchJson<ILifiIntentSubmitResponse>(url, {
    method: "POST",
    headers: intentHeaders(resolveKey(apiKey)),
    body: JSON.stringify(body),
  });
}

/** `GET /orders/status` — track an intent's lifecycle. */
export async function getIntentStatus(
  params: ILifiIntentStatusParams,
  apiKey?: string,
): Promise<ILifiIntentStatusResponse> {
  if (!params.onChainOrderId && !params.catalystOrderId) {
    throw new Error("[LiFiIntent] getIntentStatus requires onChainOrderId or catalystOrderId");
  }
  const url = new URL(`${getIntentApiBase()}/orders/status`);
  if (params.onChainOrderId) url.searchParams.set("onChainOrderId", params.onChainOrderId);
  if (params.catalystOrderId) url.searchParams.set("catalystOrderId", params.catalystOrderId);
  return fetchJson<ILifiIntentStatusResponse>(url, {
    method: "GET",
    headers: intentHeaders(resolveKey(apiKey)),
  });
}

/** `GET /chains/supported` — intent-supported chains catalogue. */
export async function getIntentChains(apiKey?: string): Promise<unknown> {
  const url = new URL(`${getIntentApiBase()}/chains/supported`);
  return fetchJson<unknown>(url, {
    method: "GET",
    headers: intentHeaders(resolveKey(apiKey)),
  });
}

/** `GET /routes` — supported intent routes. */
export async function getIntentRoutes(apiKey?: string): Promise<unknown> {
  const url = new URL(`${getIntentApiBase()}/routes`);
  return fetchJson<unknown>(url, {
    method: "GET",
    headers: intentHeaders(resolveKey(apiKey)),
  });
}
