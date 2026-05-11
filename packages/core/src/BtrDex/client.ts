import { BaseAggregator } from "../abstract";
import { AggId, IBtrSwapParams, ITransactionRequestWithEstimate } from "../types";
import { notImplemented } from "../utils";

/**
 * BtrDex on-chain aggregator (native BTR DEX router).
 *
 * Unlike HTTP aggregators, BtrDex sources quotes directly from the on-chain
 * `Router.getSwapQuote(...)` view function on the source chain and builds
 * calldata against `Router.executeSwap(...)`.
 *
 * Scaffolding only — quote / execution wiring lands in Phase 42J.3b.
 *
 * @see Phase 42J.3a — BtrDex aggregator scaffolding.
 * @see `@btr-protocol/sdk/abis/Router` v0.4.3.
 */
export class BtrDex extends BaseAggregator {
  /**
   * Initializes the BtrDex aggregator.
   * Router addresses + chain support populated in Phase 42J.3b.
   */
  constructor() {
    super(AggId.BTR_DEX);
    this.routerByChainId = {};
    this.aliasByChainId = {};
    this.approvalAddressByChainId = {};
  }

  /**
   * @inheritdoc
   * @throws {Error} Always — implementation pending.
   */
  protected convertParams(_params: IBtrSwapParams): Record<string, any> | undefined {
    notImplemented("BtrDex.convertParams");
    return undefined;
  }

  /**
   * Fetches an on-chain swap quote via `Router.getSwapQuote`.
   * @throws {Error} Always — implementation pending (Phase 42J.3b).
   */
  public async getQuote(_params: IBtrSwapParams): Promise<any | undefined> {
    notImplemented("BtrDex.getQuote");
    return undefined;
  }

  /**
   * Builds an `executeSwap` transaction request for the BTR Router.
   * @throws {Error} Always — implementation pending (Phase 42J.3b).
   */
  public async getTransactionRequest(
    _params: IBtrSwapParams,
  ): Promise<ITransactionRequestWithEstimate | undefined> {
    notImplemented("BtrDex.getTransactionRequest");
    return undefined;
  }
}

export const btrDexAggregator = new BtrDex();
