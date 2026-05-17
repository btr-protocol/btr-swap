/**
 * Li.Fi Intents (OIF / Catalyst) — TypeScript type surface.
 *
 * Authoritative reference: /tmp/btr_lifi_intent_spec.md §2.
 * Base URL: https://order.li.fi (prod) / https://order-dev.li.fi (dev).
 *
 * These mirror the on-the-wire shape of:
 *  - POST /quote/request
 *  - POST /orders/submit
 *  - GET  /orders/status
 *  - GET  /chains/supported
 *  - GET  /routes
 *
 * The contract uses EIP-7930 interop addresses for `user` / `inputs.user` /
 * `outputs.receiver`. For BTR's single-chain EVM happy-path we accept plain
 * `0x` hex strings and let the back-end up-convert to EIP-7930 when wiring
 * to Li.Fi's order service.
 */

import type { Stringifiable, TransactionRequest } from "../types";

/** Hex string (`0x` prefixed). */
export type Hex = `0x${string}`;

/** EIP-7930 or plain `0x` address; back-end normalises before submit. */
export type InteropAddress = string;

/** Catalyst settler kinds supported by Li.Fi. */
export type IntentSettlerKind = "escrow" | "compact";

/** Order-type discriminator returned by Li.Fi for the `/orders/submit` payload. */
export type IntentOrderType = "CatalystCompactOrder";

/** Direction of the intent w.r.t. user-supplied bound. */
export type IntentSwapType = "exact-input" | "exact-output";

/** OIF intent type. Currently only `oif-swap` is documented. */
export type LifiIntentType = "oif-swap";

/** Supported quote payload types (`/quote/request.supportedTypes`). */
export type IntentSupportedType = "oif-escrow-v0" | "oif-resource-lock-v0";

/** Per-leg input token in a quote request. */
export interface ILifiIntentInput {
  user: InteropAddress;
  asset: InteropAddress;
  /** wei amount, decimal string */
  amount: string;
}

/** Per-leg output token in a quote request. */
export interface ILifiIntentOutput {
  receiver: InteropAddress;
  asset: InteropAddress;
  amount: string;
}

/** Optional intent metadata block. */
export interface ILifiIntentRequestMetadata {
  /** Pin to a specific solver. */
  exclusiveFor?: string;
  /** BTR sends `"btr"` here for forward-compat (Li.Fi may surface custom integrator tags). */
  integrator?: string;
}

/** Request body for `POST https://order.li.fi/quote/request`. */
export interface ILifiIntentQuoteRequest {
  user: InteropAddress;
  intent: {
    intentType: LifiIntentType;
    inputs: ILifiIntentInput[];
    outputs: ILifiIntentOutput[];
    swapType: IntentSwapType;
    metadata?: ILifiIntentRequestMetadata;
  };
  supportedTypes: IntentSupportedType[];
}

/** One quote returned by `/quote/request`. */
export interface ILifiIntentQuote {
  quoteId: string;
  /** UNIX seconds — back-end clients must respect this for resubmits. */
  validUntil: number;
  preview: {
    inputs: ILifiIntentInput[];
    outputs: ILifiIntentOutput[];
  };
  metadata: ILifiIntentRequestMetadata & { exclusiveFor?: string | null };
  partialFill: boolean;
  failureHandling: string;
}

/** Response shape of `/quote/request`. */
export interface ILifiIntentQuoteResponse {
  quotes: ILifiIntentQuote[];
}

/** OIF MandateOutput — describes the post-fill side of an intent. */
export interface IMandateOutput {
  oracle: Hex;
  settler: Hex;
  chainId: string | number | Stringifiable;
  token: Hex;
  amount: string;
  recipient: Hex;
  /** Hex calldata to execute post-delivery, `"0x"` if unused. */
  call: Hex;
  /** Auction params, opaque hex blob. */
  context: Hex;
}

/** OIF StandardOrder — the on-chain order primitive Catalyst settlers fill. */
export interface IStandardOrder {
  user: Hex;
  nonce: string | bigint | Stringifiable;
  originChainId: string | number | Stringifiable;
  /** UNIX seconds — order is rejected after `expires`. */
  expires: number;
  /** UNIX seconds — solver-fill deadline. */
  fillDeadline: number;
  inputOracle: Hex;
  /** Each tuple is `[tokenIdentifier, amount]`. */
  inputs: Array<[Hex, string]>;
  outputs: IMandateOutput[];
}

/** Body for `POST /orders/submit`. */
export interface ILifiIntentSubmitRequest {
  orderType: IntentOrderType;
  inputSettler: Hex;
  quoteId?: string;
  order: IStandardOrder;
  /** EIP-712 sig over StandardOrder — required for off-chain Compact path. */
  signature: Hex;
}

/** Response for `POST /orders/submit`. */
export interface ILifiIntentSubmitResponse {
  orderIdentifier?: string;
  onChainOrderId?: string;
  /** Loose pass-through so we don't break on shape drift. */
  [k: string]: unknown;
}

/** EIP-712 typed-data envelope returned by the back-end intent/prepare endpoint. */
export interface IEIP712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Hex;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: "StandardOrder";
  message: IStandardOrder;
}

/** Server-prepared intent payload — Escrow flow returns `depositTx`; Compact flow returns `typedData`. */
export type ILifiIntentPayload =
  | {
      kind: "escrow";
      inputSettler: Hex;
      quoteId: string;
      order: IStandardOrder;
      /** User must broadcast this on the origin chain to deposit input tokens. */
      depositTx: TransactionRequest;
    }
  | {
      kind: "compact";
      inputSettler: Hex;
      quoteId: string;
      order: IStandardOrder;
      typedData: IEIP712TypedData;
    };

/** Lifecycle statuses returned by `GET /orders/status`. */
export type IntentOrderStatus =
  | "Submitted"
  | "Open"
  | "Signed"
  | "Delivered"
  | "Settled"
  | "Failed"
  | "Refunded";

/** Response shape of `GET /orders/status`. */
export interface ILifiIntentStatusResponse {
  meta: {
    orderStatus: IntentOrderStatus;
    [k: string]: unknown;
  };
  legs?: Array<{
    chainId: number;
    txHash?: Hex;
    blockNumber?: number;
  }>;
  [k: string]: unknown;
}

/** Status query parameters. */
export interface ILifiIntentStatusParams {
  /** Either `onChainOrderId` or `catalystOrderId` MUST be set. */
  onChainOrderId?: string;
  catalystOrderId?: string;
}

/** Extended BTR swap params for intent quote requests. */
export interface IBtrIntentParams {
  /** Origin chain id (matches IBtrSwapParams.input.chainId). */
  fromChainId: number;
  /** Destination chain id (matches IBtrSwapParams.output.chainId). */
  toChainId: number;
  /** Input token addr (`0x`). */
  fromToken: Hex;
  /** Output token addr (`0x`). */
  toToken: Hex;
  /** Origin-side user addr. */
  user: Hex;
  /** Destination-side receiver. Defaults to `user`. */
  receiver?: Hex;
  /** wei string. */
  amount: string;
  swapType?: IntentSwapType;
  settlerKind?: IntentSettlerKind;
  exclusiveFor?: string;
  /** Optional ALM/adapter call recipient on dest chain. */
  callRecipient?: Hex;
  /** Optional ALM calldata to run on dest chain after delivery. */
  callData?: Hex;
  integrator?: string;
}
