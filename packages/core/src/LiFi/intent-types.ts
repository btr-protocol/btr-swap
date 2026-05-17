/**
 * Li.Fi Intents (OIF / Catalyst) — TypeScript type surface.
 *
 * Spec sources (canonical):
 *  - https://docs.li.fi/lifi-intents/intents-api/api-overview
 *  - https://docs.li.fi/lifi-intents/intents-api/request-quote
 *  - https://docs.li.fi/lifi-intents/intents-api/track-status
 *  - https://docs.li.fi/lifi-intents/intents-api/create-and-submit
 *  - https://docs.li.fi/lifi-intents/architecture/input-settlement
 *  - https://docs.li.fi/lifi-intents/architecture/oracle-systems
 *
 * Base URL: `https://order.li.fi` (prod), `https://order-dev.li.fi` (dev).
 * All Intents API endpoints are OPEN (no API key required).
 *
 * Wire shapes mirrored 1:1 below. Wire JSON uses `callbackData` for the
 * post-delivery calldata; the TS surface uses `call` per the on-chain
 * `MandateOutput` struct (input-settlement spec). Helpers in `intent.ts`
 * rename `call → callbackData` at the JSON boundary.
 */

import type { Stringifiable, TransactionRequest } from "../types";

/** Hex string (`0x` prefixed). */
export type Hex = `0x${string}`;

/**
 * EIP-7930 interoperable address — a single `0x` bytes blob encoding
 * `Version (1 byte) || ChainType (1 byte) || ChainRefLen (1 byte) || ChainRef
 *  || AddressLen (1 byte) || Address`. For EVM, `ChainType = 0x00`, address
 * length = 0x14 (20 bytes), and `ChainRef` is the chain id big-endian.
 */
export type InteropAddress = `0x${string}`;

/** Catalyst settler kinds supported by Li.Fi. Spec-recommended: `escrow`. */
export type IntentSettlerKind = "escrow" | "compact";

/** Order-type discriminator (POST /orders/submit + status responses). */
export type OrderType = "CatalystEscrowOrder" | "CatalystCompactOrder";

/** Alias retained for back-compat with earlier code paths. */
export type IntentOrderType = OrderType;

/** Direction of the intent w.r.t. user-supplied bound. */
export type IntentSwapType = "exact-input" | "exact-output";

/** OIF intent type. Currently only `oif-swap` is documented. */
export type LifiIntentType = "oif-swap";

/** Supported quote payload types (`/quote/request.supportedTypes`). */
export type IntentSupportedType = "oif-escrow-v0" | "oif-resource-lock-v0";

/** Per-leg input token in a quote request (EIP-7930 addresses). */
export interface ILifiIntentInput {
  user: InteropAddress;
  asset: InteropAddress;
  /** wei amount, decimal string */
  amount: string;
}

/** Per-leg output token in a quote request. `amount` may be null for exact-output discovery. */
export interface ILifiIntentOutput {
  receiver: InteropAddress;
  asset: InteropAddress;
  amount: string | null;
}

/** Optional intent metadata block. */
export interface ILifiIntentRequestMetadata {
  /** Pin to a specific solver address. */
  exclusiveFor?: string[];
  /** Integrator tag for analytics/attribution. */
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
  /** Default `["oif-escrow-v0"]` for the Simple Escrow path. */
  supportedTypes: IntentSupportedType[];
}

/** One quote returned by `/quote/request`. */
export interface ILifiIntentQuote {
  /** Always null on /quote/request; the order is constructed client-side. */
  order: null;
  quoteId: string;
  /** UNIX seconds — server-side quote validity horizon. */
  validUntil: number;
  preview: {
    inputs: ILifiIntentInput[];
    outputs: ILifiIntentOutput[];
  };
  metadata: { exclusiveFor: string | null };
  partialFill: boolean;
  failureHandling: string;
}

/** Response shape of `/quote/request`. */
export interface ILifiIntentQuoteResponse {
  quotes: ILifiIntentQuote[];
}

/**
 * OIF `MandateOutput` — post-fill side of an intent.
 *
 * Wire/JSON note: the Li.Fi API serializes the on-chain `call` field as
 * `callbackData`. The TS surface keeps `call` for parity with the Solidity
 * struct (per input-settlement spec); `intent.ts` performs the rename.
 */
export interface IMandateOutput {
  /** Oracle on the destination chain validating fills (bytes32). */
  oracle: Hex;
  /** Output settler contract on the destination chain (bytes32). */
  settler: Hex;
  /** Destination chain id. */
  chainId: string | number | Stringifiable;
  /** Output token, left-padded to bytes32. */
  token: Hex;
  /** Output amount (decimal string at JSON boundary). */
  amount: string;
  /** Recipient on the destination chain, left-padded to bytes32. */
  recipient: Hex;
  /** Post-delivery calldata (`0x` if unused). Serialized as `callbackData`. */
  call: Hex;
  /** Auction / verification context — opaque hex blob (`0x` if unused). */
  context: Hex;
}

/**
 * OIF `StandardOrder` — the on-chain order primitive Catalyst settlers fill.
 * Wire JSON serializes all `uint256/uint32` fields as decimal strings.
 */
export interface IStandardOrder {
  user: Hex;
  nonce: string | bigint | Stringifiable;
  originChainId: string | number | Stringifiable;
  /** UNIX seconds — order is rejected after `expires`; refund eligible. */
  expires: number;
  /** UNIX seconds — solver fill deadline (must be < expires). */
  fillDeadline: number;
  /** Origin-side input oracle (address). */
  inputOracle: Hex;
  /** Each tuple is `[tokenIdentifier (uint256), amount (uint256)]`. */
  inputs: Array<[string, string]>;
  outputs: IMandateOutput[];
}

/** Body for `POST /orders/submit` (OFF-CHAIN Compact only). */
export interface ILifiIntentSubmitRequest {
  orderType: OrderType;
  inputSettler: Hex;
  quoteId?: string;
  order: IStandardOrder;
  /** Sponsor signature (Compact path). */
  signature?: Hex;
}

/** Response for `POST /orders/submit`. */
export interface ILifiIntentSubmitResponse {
  orderIdentifier?: string;
  onChainOrderId?: string;
  [k: string]: unknown;
}

/**
 * Lifecycle statuses returned by `GET /orders/status`.
 *
 * Spec values: Submitted | Open | Signed | Delivered | Settled.
 * BTR additionally surfaces `Refunded` (post-`expires` reclaim) and `Failed`
 * (terminal error) for UI completeness; upstream may collapse these into
 * `Settled` / absence-of-fill.
 */
export type IntentOrderStatus =
  | "Pending"
  | "Submitted"
  | "Open"
  | "Signed"
  | "Delivered"
  | "Settled"
  | "Refunded"
  | "Failed";

/** Alias kept for spec parity. */
export type OrderStatus = IntentOrderStatus;

/** Response shape of `GET /orders/status`. */
export interface ILifiIntentStatusResponse {
  order: IStandardOrder;
  quote: unknown | null;
  sponsorSignature: string | null;
  allocatorSignature: string | null;
  inputSettler: string;
  meta: {
    submitTime: number;
    orderStatus: IntentOrderStatus;
    destinationAddress: string;
    orderIdentifier: string;
    onChainOrderId: string;
    signedAt: string | null;
    deliveredAt: string | null;
    settledAt: string | null;
    expiredAt: string | null;
    orderInitiatedTxHash: string | null;
    orderDeliveredTxHash: string | null;
    orderVerifiedTxHash: string | null;
    orderSettledTxHash: string | null;
    solverAddress: string | null;
    [k: string]: unknown;
  };
}

/** Status query parameters. */
export interface ILifiIntentStatusParams {
  /** Either `onChainOrderId` or `catalystOrderId` MUST be set. */
  onChainOrderId?: string;
  catalystOrderId?: string;
}

/** Per-chain entry of `GET /chains/supported`. */
export interface ILifiSupportedChain {
  chainId: number;
  inputSettlerEscrow?: Hex;
  inputSettlerCompact?: Hex;
  inputOracle?: Hex;
  outputSettler?: Hex;
  outputOracle?: Hex;
  /** Pass-through for forward-compat. */
  [k: string]: unknown;
}

/** Response shape of `GET /chains/supported`. */
export interface ILifiSupportedChainsResponse {
  chains: ILifiSupportedChain[];
}

/** EIP-712 typed-data envelope (Compact off-chain path only). */
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

/** Server-prepared intent payload. */
export type ILifiIntentPayload =
  | {
      kind: "escrow";
      inputSettler: Hex;
      quoteId: string;
      order: IStandardOrder;
      /** On-chain open: user broadcasts `Swapper.openIntent(...)` themselves. */
      abiEncodedCalldata: Hex;
    }
  | {
      kind: "compact";
      inputSettler: Hex;
      quoteId: string;
      order: IStandardOrder;
      typedData: IEIP712TypedData;
    };

/** Extended BTR swap params for intent quote requests. */
export interface IBtrIntentParams {
  fromChainId: number;
  toChainId: number;
  fromToken: Hex;
  toToken: Hex;
  user: Hex;
  receiver?: Hex;
  amount: string;
  swapType?: IntentSwapType;
  settlerKind?: IntentSettlerKind;
  exclusiveFor?: string;
  callRecipient?: Hex;
  callData?: Hex;
  integrator?: string;
}

/** Re-exported for symmetry with the on-chain `TransactionRequest` type. */
export type IntentTransactionRequest = TransactionRequest;

// ─────────────────────────────────────────────────────────────────────────────
// EIP-7930 helpers
// ─────────────────────────────────────────────────────────────────────────────

const ENC = (b: number): string => b.toString(16).padStart(2, "0");

/** Big-endian, minimal-byte chain reference. */
const chainRefBytes = (chainId: bigint): string => {
  if (chainId < 0n) throw new Error("chainId must be non-negative");
  let hex = chainId.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  if (hex === "00") return "00"; // 1-byte zero placeholder, length 1
  return hex;
};

/**
 * Encode an EIP-7930 interoperable address for an EVM chain.
 *
 * Layout:
 *   `0x | Version=01 | ChainType=00 | ChainRefLen | ChainRef | AddrLen=14 | Address(20)`
 */
export const encodeInteropAddress = (chainId: bigint, address: `0x${string}`): InteropAddress => {
  const a = address.toLowerCase().replace(/^0x/, "");
  if (a.length !== 40) throw new Error(`bad address: ${address}`);
  const ref = chainRefBytes(chainId);
  const refLen = ref.length / 2;
  if (refLen > 255) throw new Error("chainRef exceeds 255 bytes");
  const out =
    "0x" +
    ENC(1) + // Version
    ENC(0) + // ChainType = EVM
    ENC(refLen) +
    ref +
    ENC(20) +
    a;
  return out as InteropAddress;
};

/** Decode an EIP-7930 EVM interop address into `(chainId, address)`. */
export const decodeInteropAddress = (
  blob: InteropAddress,
): { chainId: bigint; address: `0x${string}` } => {
  const hex = blob.toLowerCase().replace(/^0x/, "");
  const version = parseInt(hex.slice(0, 2), 16);
  if (version !== 1) throw new Error(`unsupported interop version ${version}`);
  const chainType = parseInt(hex.slice(2, 4), 16);
  if (chainType !== 0) throw new Error(`unsupported chainType ${chainType}`);
  const refLen = parseInt(hex.slice(4, 6), 16);
  const refEnd = 6 + refLen * 2;
  const ref = hex.slice(6, refEnd);
  const addrLen = parseInt(hex.slice(refEnd, refEnd + 2), 16);
  if (addrLen !== 20) throw new Error(`unsupported addrLen ${addrLen}`);
  const addr = hex.slice(refEnd + 2, refEnd + 2 + addrLen * 2);
  return {
    chainId: ref ? BigInt("0x" + ref) : 0n,
    address: `0x${addr}` as `0x${string}`,
  };
};
