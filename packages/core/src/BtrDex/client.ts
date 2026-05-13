import {
  decAddressArray,
  decSwapQuoteAmountOut,
  encExecuteSwap,
  encGetCommonPools,
  encGetSwapQuote,
  ethCall,
  IEncRouteStep,
} from "./abi";
import { IBtrDexCandidate, IBtrDexChainConfig, IBtrDexCustomData } from "./types";

import { BaseAggregator } from "../abstract";
import {
  AggId,
  IBtrSwapParams,
  ITransactionRequestWithEstimate,
  IProtocol,
  ISwapStep,
  ProtocolType,
  StepType,
} from "../types";
import { addEstimatesToTr, emptyCostEstimate } from "../utils";

/** Type for raw `eth_call`, exposed for tests to inject a mock. */
export type EthCallFn = (rpcUrl: string, to: string, data: string) => Promise<string>;

/**
 * BtrDex on-chain aggregator (native BTR DEX router).
 *
 * Sources quotes via `Router.getSwapQuote(pool, ...)` on the source chain and
 * builds calldata against `Router.executeSwap(route, amountIn, minOut, recipient)`.
 *
 * Pool discovery: `PoolFactory.getCommonPools(tokenA, tokenB)` enumerates
 * shared pools; each candidate is quoted in parallel and the highest output is
 * chosen. Single-hop only -multi-hop deferred until the on-chain
 * `getBestRoute` surface stabilises.
 *
 * @see Phase 42J.3b -BtrDex real getQuote + executeSwap (single-hop, Permit2 TODO).
 * @see `@btr-protocol/sdk/abis/Router` v0.4.3.
 */
export class BtrDex extends BaseAggregator {
  /** Per-chain on-chain config (router + factory + optional RPC). */
  public chainConfigByChainId: { [chainId: number]: IBtrDexChainConfig } = {};

  /**
   * Pluggable eth_call implementation. Default uses `fetch`. Tests can swap
   * this for a deterministic mock.
   */
  public ethCall: EthCallFn = ethCall;

  /**
   * Initializes the BtrDex aggregator. Chain configs may be registered via
   * {@link registerChain} (typically by integrators per-deployment).
   */
  constructor() {
    super(AggId.BTR_DEX);
    this.routerByChainId = {};
    this.aliasByChainId = {};
    this.approvalAddressByChainId = {};
  }

  /**
   * Register an on-chain BtrDex deployment for a given chain. Idempotent.
   */
  public registerChain(chainId: number, cfg: IBtrDexChainConfig): void {
    this.chainConfigByChainId[chainId] = cfg;
    this.routerByChainId[chainId] = cfg.router;
    this.aliasByChainId[chainId] = chainId;
    this.approvalAddressByChainId[chainId] = cfg.router;
  }

  /** Resolve the RPC URL for a chain (customData > chain config > env var). */
  private resolveRpcUrl(chainId: number, custom?: IBtrDexCustomData): string {
    const fromCustom = custom?.rpcUrl;
    const fromCfg = this.chainConfigByChainId[chainId]?.rpcUrl;
    const fromEnv = process.env[`BTR_DEX_RPC_${chainId}`];
    const url = fromCustom || fromCfg || fromEnv;
    if (!url) {
      throw new Error(
        `[${this.id}] No RPC URL configured for chain ${chainId} ` +
          `(set customData.rpcUrl, register chain with rpcUrl, or export BTR_DEX_RPC_${chainId}).`,
      );
    }
    return url;
  }

  /**
   * Pulls the first `IBtrDexCustomData` from `params.customContractCalls[0].callData`
   * if it was JSON-stringified there, otherwise reads from any `(params as any).customData`.
   * The BTR-Swap surface doesn't have a first-class `customData` slot on
   * `IBtrSwapParams`, so we accept both conventions.
   */
  private readCustomData(params: IBtrSwapParams): IBtrDexCustomData {
    const anyP = params as unknown as { customData?: IBtrDexCustomData };
    return anyP.customData ?? {};
  }

  /** @inheritdoc */
  protected convertParams(_params: IBtrSwapParams): Record<string, any> | undefined {
    // No HTTP API → no params to convert. Documented stub.
    return undefined;
  }

  /**
   * Fetches an on-chain swap quote.
   *
   * Steps:
   *   1. Resolve RPC + factory for `input.chainId`.
   *   2. If `customData.pool` is set, use it directly. Else
   *      `PoolFactory.getCommonPools(tokenIn, tokenOut)`.
   *   3. For each candidate pool, `eth_call Router.getSwapQuote(...)` in
   *      parallel, decode `amountOut`, pick max.
   *   4. Return the winning {@link IBtrDexCandidate}.
   */
  public async getQuote(params: IBtrSwapParams): Promise<IBtrDexCandidate | undefined> {
    const p = this.overloadParams(params);
    try {
      const chainId = Number(p.input.chainId);
      const cfg = this.chainConfigByChainId[chainId];
      if (!cfg) {
        throw new Error(`[${this.id}] No chain config registered for chainId=${chainId}`);
      }
      const custom = this.readCustomData(p);
      const rpcUrl = this.resolveRpcUrl(chainId, custom);
      const tokenIn = p.input.address!;
      const tokenOut = p.output.address!;
      const amountIn = BigInt(p.inputAmountWei.toString());

      // 1. Pool discovery.
      let pools: string[];
      if (custom.pool) {
        pools = [custom.pool];
      } else {
        const raw = await this.ethCall(
          rpcUrl,
          cfg.poolFactory,
          encGetCommonPools(tokenIn, tokenOut),
        );
        pools = decAddressArray(raw);
      }
      if (!pools.length) {
        throw new Error(
          `[${this.id}] No common pools for ${tokenIn} → ${tokenOut} on chain ${chainId}`,
        );
      }

      // 2. Quote each pool in parallel; ignore failures.
      const quotes = await Promise.all(
        pools.map(async (pool): Promise<IBtrDexCandidate | undefined> => {
          try {
            const raw = await this.ethCall(
              rpcUrl,
              cfg.router,
              encGetSwapQuote(pool, tokenIn, tokenOut, amountIn),
            );
            const amountOut = decSwapQuoteAmountOut(raw);
            if (amountOut === 0n) return undefined;
            return {
              pool,
              tokenIn: p.input,
              tokenOut: p.output,
              amountIn,
              amountOut,
              spreadBps: 0,
            };
          } catch {
            return undefined;
          }
        }),
      );

      // 3. Pick best.
      const best = quotes
        .filter((q): q is IBtrDexCandidate => q !== undefined)
        .sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0))[0];
      if (!best) throw new Error(`[${this.id}] All pool quotes failed`);
      return best;
    } catch (e) {
      this.handleError(e, "getQuote");
      return undefined;
    }
  }

  /**
   * Builds an `executeSwap` transaction request for the BTR Router.
   *
   * - Single-hop route only (multi-hop deferred Phase 42K).
   * - `minOut` is taken from `customData.minOut` if supplied, else falls back
   *   to `quote.amountOut * (10000 - maxSlippage) / 10000`.
   * - DOES NOT trust aggregator-side minOut: caller is expected to provide
   *   one explicitly for production usage.
   * - Permit2: when `customData.usePermit2 === true`, the generated calldata
   *   is identical (no on-chain support yet -see {@link IBtrDexCustomData}
   *   TODO). The caller is responsible for issuing the Permit2 approval
   *   out-of-band until Phase 42K wires sig verification into the Router.
   */
  public async getTransactionRequest(
    params: IBtrSwapParams,
  ): Promise<ITransactionRequestWithEstimate | undefined> {
    const p = this.overloadParams(params);
    try {
      const quote = await this.getQuote(p);
      if (!quote) {
        throw new Error(`[${this.id}] getQuote returned undefined; cannot build tx`);
      }
      const chainId = Number(p.input.chainId);
      const cfg = this.chainConfigByChainId[chainId];
      if (!cfg) {
        throw new Error(`[${this.id}] No chain config registered for chainId=${chainId}`);
      }
      const custom = this.readCustomData(p);

      // Caller-provided minOut wins; otherwise derive from quote × slippage.
      const slippageBps = BigInt(p.maxSlippage ?? 500);
      const derivedMinOut = (quote.amountOut * (10000n - slippageBps)) / 10000n;
      const minOut = custom.minOut !== undefined ? BigInt(custom.minOut.toString()) : derivedMinOut;

      const recipient = p.receiver ?? p.payer;

      const stepIn: IEncRouteStep = {
        pool: quote.pool,
        tokenIn: quote.tokenIn.address!,
        tokenOut: quote.tokenOut.address!,
        minOut,
      };

      const calldata = encExecuteSwap(
        [stepIn],
        quote.amountOut, // amountOut hint (unused by Router on-chain -slippage gate uses minAmountOut)
        0n, // gasEstimate hint
        quote.amountIn,
        minOut,
        recipient,
      );

      // Native ETH sends -`address(0)` convention.
      const isNativeIn = /^0x0{40}$/i.test(quote.tokenIn.address!);
      const value = isNativeIn ? quote.amountIn.toString() : "0";

      const protocol: IProtocol = {
        id: "btr-dex",
        name: "BTR DEX",
        type: ProtocolType.DEX,
      };
      const inputDec = p.input.decimals || 18;
      const outputDec = p.output.decimals || 18;
      const inputAmount = Number(quote.amountIn) / 10 ** inputDec;
      const outputAmount = Number(quote.amountOut) / 10 ** outputDec;
      const step: ISwapStep = {
        id: "btr-dex-swap-1",
        type: StepType.SWAP,
        description: "BTR DEX single-hop swap",
        input: p.input,
        output: p.output,
        inputChainId: chainId,
        outputChainId: chainId,
        payer: p.payer,
        receiver: recipient,
        protocol,
        estimates: {
          input: inputAmount,
          inputWei: quote.amountIn,
          output: outputAmount,
          outputWei: quote.amountOut,
          exchangeRate: inputAmount > 0 ? outputAmount / inputAmount : 0,
          slippage: Number(slippageBps) / 10000,
          ...emptyCostEstimate(),
        },
      };

      return addEstimatesToTr({
        aggId: this.id,
        to: cfg.router,
        from: p.payer,
        data: calldata,
        value,
        chainId,
        params: p,
        steps: [step],
        approveTo: cfg.router,
        customData: { usePermit2: !!custom.usePermit2 },
      });
    } catch (e) {
      this.handleError(e, "getTransactionRequest");
      return undefined;
    }
  }
}

export const btrDexAggregator = new BtrDex();
