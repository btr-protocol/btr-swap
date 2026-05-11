import { IToken } from "../types";

/**
 * Mirror of the on-chain `IPoolModule.SwapQuote` struct returned by
 * `Router.getSwapQuote(pool, tokenIn, tokenOut, amountIn)`.
 *
 * Source ABI: `@btr-protocol/sdk/abis/Router` v0.4.3 (`Router.sol:313`).
 */
export interface IBtrDexSwapQuote {
  amountOut: bigint;
  amountIn: bigint;
  spreadBps: number;
  protoFee: bigint;
  lpFee: bigint;
  skewIn: number;
  skewOut: number;
  routeHops: string[];
  hopAmounts: bigint[];
  hopPrices: bigint[];
}

/**
 * Mirror of the on-chain `IRouter.RouteStep` struct.
 */
export interface IBtrDexRouteStep {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  minOut: bigint;
}

/**
 * Mirror of the on-chain `IRouter.Route` struct consumed by `Router.executeSwap`.
 */
export interface IBtrDexRoute {
  steps: IBtrDexRouteStep[];
  amountOut: bigint;
  gasEstimate: bigint;
}

/**
 * Resolved candidate route from a single pool quote (Phase 1: single-hop only).
 */
export interface IBtrDexCandidate {
  pool: string;
  tokenIn: IToken;
  tokenOut: IToken;
  amountIn: bigint;
  amountOut: bigint;
  spreadBps: number;
}

/**
 * Permit signature data attached to a swap.
 *
 * - `eip2612`: EIP-2612 `permit(owner, spender, value, deadline, v, r, s)` on the input token itself.
 * - `permit2`: Uniswap Permit2 `permitTransferFrom` signed payload.
 *
 * @see Phase 42J Team B finding F-permit2 — required for 0x v2 Settler-style listings.
 *
 * NOTE: Router-side support is **not yet wired** in `dex/evm/src/Router.sol`. This typing
 * defines the integration surface so that consumers (front, back) can begin signing flows
 * ahead of the on-chain rollout in Phase 42K.
 */
export type BtrDexPermit =
  | {
      kind: "eip2612";
      owner: string;
      spender: string;
      value: bigint;
      deadline: bigint;
      v: number;
      r: string;
      s: string;
    }
  | {
      kind: "permit2";
      permitted: { token: string; amount: bigint };
      nonce: bigint;
      deadline: bigint;
      signature: string;
    };

/**
 * Optional `customData` payload recognised by `BtrDex` on `IBtrSwapParams.customData`.
 */
export interface IBtrDexCustomData {
  /** Override the JSON-RPC URL for the source chain (otherwise read from env). */
  rpcUrl?: string;
  /** Pre-discovered pool address (skips `PoolFactory.getCommonPools`). */
  pool?: string;
  /** Permit / Permit2 signature for tokenIn. Optional. */
  permit?: BtrDexPermit;
  /**
   * If true, the caller expects tokenIn to be pre-authorized via Permit2 and
   * the on-chain Router to short-circuit ERC-20 `transferFrom`.
   *
   * TODO Phase 42K: Router.executeSwap does not currently accept a Permit2
   * payload on-chain — this flag is wired through the SDK surface ahead of the
   * on-chain rollout. With `usePermit2=true` today, the generated calldata is
   * identical and the caller is responsible for issuing the Permit2 approval
   * out-of-band (or for the SDK consumer to attach a permit signature in a
   * follow-up phase once the Router signature is finalised).
   */
  usePermit2?: boolean;
  /** Caller-provided minimum output (wei). When supplied, overrides aggregator-side slippage math. */
  minOut?: bigint | string;
}

/** Per-chain BtrDex on-chain deployment addresses. */
export interface IBtrDexChainConfig {
  /** `Router` proxy address. */
  router: string;
  /** `PoolFactory` address (used for `getCommonPools` discovery). */
  poolFactory: string;
  /** JSON-RPC URL for `eth_call`. Falls back to `BTR_DEX_RPC_<chainId>` env. */
  rpcUrl?: string;
}
