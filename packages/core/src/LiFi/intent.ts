/**
 * Li.Fi Intents (OIF / Catalyst) — request layer.
 *
 * Spec: https://docs.li.fi/lifi-intents/intents-api/api-overview
 * Base URL: `https://order.li.fi` (prod) / `https://order-dev.li.fi` (dev).
 * Override via env `LIFI_INTENT_API_BASE_URL`.
 *
 * Auth: ALL endpoints are OPEN — no API key required. We do NOT send
 * `x-lifi-api-key` on the intent surface (it's silently ignored upstream and
 * confuses keeper-mode auth audits). Keep the key only on the atomic
 * `li.quest` flow.
 *
 * Server-only: never invoke from a browser bundle (see back/services/swap).
 */

import { fetchJson, envApiRoot } from "../utils";
import type {
  ILifiIntentQuoteRequest,
  ILifiIntentQuoteResponse,
  ILifiIntentSubmitRequest,
  ILifiIntentSubmitResponse,
  ILifiIntentStatusParams,
  ILifiIntentStatusResponse,
  ILifiSupportedChainsResponse,
  IStandardOrder,
  IMandateOutput,
} from "./intent-types";

/** Resolve Li.Fi Intent base URL (env override + sane default). */
export const getIntentApiBase = (): string => envApiRoot("LIFI_INTENT_API_BASE_URL", "order.li.fi");

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept": "application/json",
};

// ─────────────────────────────────────────────────────────────────────────────
// Wire serialization helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert any bigint / Stringifiable to a decimal string for JSON wire. */
const toDec = (v: unknown): string => {
  if (typeof v === "bigint") return v.toString(10);
  if (typeof v === "number") return v.toString(10);
  if (typeof v === "string") return v;
  if (v && typeof (v as { toString?: () => string }).toString === "function") {
    return (v as { toString: () => string }).toString();
  }
  return String(v);
};

/** Map the on-chain `call` field to its JSON wire name `callbackData`. */
const mandateToWire = (m: IMandateOutput): Record<string, unknown> => ({
  oracle: m.oracle,
  settler: m.settler,
  chainId: toDec(m.chainId),
  token: m.token,
  amount: toDec(m.amount),
  recipient: m.recipient,
  callbackData: m.call,
  context: m.context,
});

/** Serialize a StandardOrder for the wire (decimal strings, callbackData rename). */
export const orderToWire = (o: IStandardOrder): Record<string, unknown> => ({
  user: o.user,
  nonce: toDec(o.nonce),
  originChainId: toDec(o.originChainId),
  expires: o.expires,
  fillDeadline: o.fillDeadline,
  inputOracle: o.inputOracle,
  inputs: o.inputs.map(([tok, amt]) => [toDec(tok), toDec(amt)]),
  outputs: o.outputs.map(mandateToWire),
});

const requestToWire = (req: ILifiIntentQuoteRequest): Record<string, unknown> => ({
  user: req.user,
  intent: {
    intentType: req.intent.intentType,
    inputs: req.intent.inputs.map((i) => ({
      user: i.user,
      asset: i.asset,
      amount: toDec(i.amount),
    })),
    outputs: req.intent.outputs.map((o) => ({
      receiver: o.receiver,
      asset: o.asset,
      amount: o.amount === null ? null : toDec(o.amount),
    })),
    swapType: req.intent.swapType,
    ...(req.intent.metadata ? { metadata: req.intent.metadata } : {}),
  },
  supportedTypes: req.supportedTypes,
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints (all open — no API key)
// ─────────────────────────────────────────────────────────────────────────────

/** `POST /quote/request` — fetch standing intent quote(s). */
export async function requestIntentQuote(
  body: ILifiIntentQuoteRequest,
): Promise<ILifiIntentQuoteResponse> {
  const url = new URL(`${getIntentApiBase()}/quote/request`);
  return fetchJson<ILifiIntentQuoteResponse>(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(requestToWire(body)),
  });
}

/**
 * `POST /orders/submit` — OFF-CHAIN gasless Compact path only.
 *
 * For the recommended on-chain `InputSettlerEscrow` flow (BTR's default),
 * solvers auto-detect orders opened on-chain — DO NOT call this endpoint.
 * See `back/services/swap/src/lib/intent.ts → intentSubmit` which returns
 * HTTP 410 Gone for the Escrow case.
 */
export async function submitIntentOrder(
  body: ILifiIntentSubmitRequest,
): Promise<ILifiIntentSubmitResponse> {
  const url = new URL(`${getIntentApiBase()}/orders/submit`);
  const wire: Record<string, unknown> = {
    orderType: body.orderType,
    inputSettler: body.inputSettler,
    ...(body.quoteId ? { quoteId: body.quoteId } : {}),
    order: orderToWire(body.order),
    ...(body.signature ? { signature: body.signature } : {}),
  };
  return fetchJson<ILifiIntentSubmitResponse>(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(wire),
  });
}

/** `GET /orders/status` — track an intent's lifecycle. */
export async function getIntentStatus(
  params: ILifiIntentStatusParams,
): Promise<ILifiIntentStatusResponse> {
  if (!params.onChainOrderId && !params.catalystOrderId) {
    throw new Error("[LiFiIntent] getIntentStatus requires onChainOrderId or catalystOrderId");
  }
  const url = new URL(`${getIntentApiBase()}/orders/status`);
  if (params.onChainOrderId) url.searchParams.set("onChainOrderId", params.onChainOrderId);
  if (params.catalystOrderId) url.searchParams.set("catalystOrderId", params.catalystOrderId);
  return fetchJson<ILifiIntentStatusResponse>(url, {
    method: "GET",
    headers: HEADERS,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /chains/supported — cached 1h
// ─────────────────────────────────────────────────────────────────────────────

const CHAINS_TTL_MS = 60 * 60 * 1000;
let _chainsCache: { ts: number; resp: ILifiSupportedChainsResponse } | null = null;

/** `GET /chains/supported` — intent-supported chains catalogue (1h LRU). */
export async function getIntentChains(
  opts: { force?: boolean } = {},
): Promise<ILifiSupportedChainsResponse> {
  if (!opts.force && _chainsCache && Date.now() - _chainsCache.ts < CHAINS_TTL_MS) {
    return _chainsCache.resp;
  }
  const url = new URL(`${getIntentApiBase()}/chains/supported`);
  const raw = await fetchJson<unknown>(url, { method: "GET", headers: HEADERS });
  const resp: ILifiSupportedChainsResponse = Array.isArray(raw)
    ? { chains: raw as ILifiSupportedChainsResponse["chains"] }
    : (raw as ILifiSupportedChainsResponse);
  _chainsCache = { ts: Date.now(), resp };
  return resp;
}

/** `GET /routes` — supported intent routes. */
export async function getIntentRoutes(): Promise<unknown> {
  const url = new URL(`${getIntentApiBase()}/routes`);
  return fetchJson<unknown>(url, { method: "GET", headers: HEADERS });
}

/** `GET /orders` — list orders with filters (pass-through). */
export async function listIntentOrders(
  q: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const url = new URL(`${getIntentApiBase()}/orders`);
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return fetchJson<unknown>(url, { method: "GET", headers: HEADERS });
}
