import { expect } from "chai";

import { BtrDex } from "@/core/BtrDex/client";
import {
  SELECTOR_EXECUTE_SWAP,
  SELECTOR_GET_COMMON_POOLS,
  SELECTOR_GET_SWAP_QUOTE,
  encAddress,
  encUint,
} from "@/core/BtrDex/abi";
import { AggId } from "@/core/types";

/** Build a fake `eth_call` return for `getCommonPools` → address[] */
function mockGetCommonPoolsRet(pools: string[]): string {
  // offset (0x20) + length + N × 32-byte addresses
  let hex = "0x" + encUint(0x20n) + encUint(BigInt(pools.length));
  for (const p of pools) hex += encAddress(p);
  return hex;
}

/** Build a fake `eth_call` return for `getSwapQuote` → SwapQuote tuple.
 *  We only care about amountOut; pad the rest with zeros for the static head.
 *  Static head fields before the first dynamic offset (10 head words for safety). */
function mockGetSwapQuoteRet(amountOut: bigint): string {
  // amountOut, amountIn, spreadBps, protoFee, lpFee, skewIn, skewOut, +3 dynamic offsets
  const words: string[] = [
    encUint(amountOut),
    encUint(0n),
    encUint(0n),
    encUint(0n),
    encUint(0n),
    encUint(0n),
    encUint(0n),
    encUint(0n),
    encUint(0n),
    encUint(0n),
  ];
  return "0x" + words.join("");
}

const ROUTER = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x2222222222222222222222222222222222222222";
const POOL_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POOL_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_IN = "0xcccccccccccccccccccccccccccccccccccccccc";
const TOKEN_OUT = "0xdddddddddddddddddddddddddddddddddddddddd";
const PAYER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const baseParams = () => ({
  input: { chainId: 1, address: TOKEN_IN, decimals: 18, name: "IN", symbol: "IN" },
  output: { chainId: 1, address: TOKEN_OUT, decimals: 18, name: "OUT", symbol: "OUT" },
  inputAmountWei: 1_000_000_000_000_000_000n.toString(),
  payer: PAYER,
});

describe("BtrDex aggregator (Phase 42J.3b)", () => {
  it("registers chain config and exposes router/approval addresses", () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });
    expect(agg.getRouterAddress(1)).to.equal(ROUTER);
    expect(agg.getApprovalAddress(1)).to.equal(ROUTER);
    expect(agg.isChainSupported(1)).to.equal(true);
    expect(agg.id).to.equal(AggId.BTR_DEX);
  });

  it("getQuote picks best pool by amountOut", async () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });

    const calls: Array<{ to: string; data: string }> = [];
    agg.ethCall = async (_url, to, data) => {
      calls.push({ to, data });
      if (data.startsWith(SELECTOR_GET_COMMON_POOLS)) {
        return mockGetCommonPoolsRet([POOL_A, POOL_B]);
      }
      if (data.startsWith(SELECTOR_GET_SWAP_QUOTE)) {
        // Pool A → low quote, Pool B → high quote
        if (data.toLowerCase().includes(POOL_A.slice(2))) return mockGetSwapQuoteRet(1000n);
        if (data.toLowerCase().includes(POOL_B.slice(2))) return mockGetSwapQuoteRet(2500n);
      }
      throw new Error(`unexpected call: ${data}`);
    };

    const q = await agg.getQuote(baseParams() as any);
    expect(q, "quote").to.not.equal(undefined);
    expect(q!.pool.toLowerCase()).to.equal(POOL_B.toLowerCase());
    expect(q!.amountOut).to.equal(2500n);
    expect(calls[0].to.toLowerCase()).to.equal(FACTORY);
    expect(calls.slice(1).every((c) => c.to.toLowerCase() === ROUTER)).to.equal(true);
  });

  it("getQuote honours customData.pool override (skips factory)", async () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });
    let factoryHit = false;
    agg.ethCall = async (_url, to, data) => {
      if (to.toLowerCase() === FACTORY) {
        factoryHit = true;
        return mockGetCommonPoolsRet([]);
      }
      if (data.startsWith(SELECTOR_GET_SWAP_QUOTE)) return mockGetSwapQuoteRet(777n);
      throw new Error("unexpected");
    };
    const params: any = { ...baseParams(), customData: { pool: POOL_A } };
    const q = await agg.getQuote(params);
    expect(factoryHit).to.equal(false);
    expect(q!.amountOut).to.equal(777n);
    expect(q!.pool.toLowerCase()).to.equal(POOL_A.toLowerCase());
  });

  it("getTransactionRequest emits executeSwap calldata with caller minOut", async () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });
    agg.ethCall = async (_url, _to, data) => {
      if (data.startsWith(SELECTOR_GET_COMMON_POOLS)) return mockGetCommonPoolsRet([POOL_A]);
      if (data.startsWith(SELECTOR_GET_SWAP_QUOTE)) return mockGetSwapQuoteRet(2000n);
      throw new Error("unexpected");
    };
    const callerMinOut = 1950n;
    const params: any = { ...baseParams(), customData: { minOut: callerMinOut.toString() } };
    const tx = await agg.getTransactionRequest(params);
    expect(tx, "tx").to.not.equal(undefined);
    expect(tx!.to!.toLowerCase()).to.equal(ROUTER);
    expect((tx!.data as string).startsWith(SELECTOR_EXECUTE_SWAP)).to.equal(true);
    expect(tx!.value).to.equal("0");
    // calldata must contain the caller-supplied minOut padded as uint256
    expect((tx!.data as string).toLowerCase()).to.contain(encUint(callerMinOut));
  });

  it("getTransactionRequest defaults minOut from maxSlippage when caller omits it", async () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });
    agg.ethCall = async (_url, _to, data) => {
      if (data.startsWith(SELECTOR_GET_COMMON_POOLS)) return mockGetCommonPoolsRet([POOL_A]);
      if (data.startsWith(SELECTOR_GET_SWAP_QUOTE)) return mockGetSwapQuoteRet(1000n);
      throw new Error("unexpected");
    };
    // 5% default slippage → minOut = 950
    const tx = await agg.getTransactionRequest(baseParams() as any);
    expect(tx).to.not.equal(undefined);
    expect((tx!.data as string).toLowerCase()).to.contain(encUint(950n));
  });

  it("getTransactionRequest tags Permit2 intent in customData", async () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });
    agg.ethCall = async (_url, _to, data) => {
      if (data.startsWith(SELECTOR_GET_COMMON_POOLS)) return mockGetCommonPoolsRet([POOL_A]);
      if (data.startsWith(SELECTOR_GET_SWAP_QUOTE)) return mockGetSwapQuoteRet(1000n);
      throw new Error("unexpected");
    };
    const params: any = { ...baseParams(), customData: { usePermit2: true } };
    const tx = await agg.getTransactionRequest(params);
    expect(tx!.customData?.usePermit2).to.equal(true);
  });

  it("getQuote returns undefined when no pools exist", async () => {
    const agg = new BtrDex();
    agg.registerChain(1, { router: ROUTER, poolFactory: FACTORY, rpcUrl: "http://rpc" });
    agg.ethCall = async () => mockGetCommonPoolsRet([]);
    const q = await agg.getQuote(baseParams() as any);
    expect(q).to.equal(undefined);
  });
});
