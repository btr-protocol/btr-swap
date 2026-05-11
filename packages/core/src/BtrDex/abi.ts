/**
 * Minimal hand-rolled ABI encoder/decoder + JSON-RPC helper for the BtrDex
 * aggregator. We avoid pulling in `viem` / `ethers` to keep `@btr-supply/swap`
 * dependency-free.
 *
 * Selectors are precomputed (canonical signatures from
 * `@btr-protocol/sdk/abis/Router` v0.4.3 and `PoolFactory`):
 *
 * - `getCommonPools(address,address)`                                       → 0xe6a72044
 * - `getSwapQuote(address,address,address,uint256)`                         → 0xd96825ea
 * - `executeSwap(((address,address,address,uint256)[],uint256,uint256),uint256,uint256,address)` → 0x0bb56928
 *
 * Only the surface required by `BtrDex.getQuote` / `getTransactionRequest` is
 * implemented (static-typed args + dynamic `address[]` decoding +
 * single-tuple-with-dynamic-array encoding for `executeSwap`).
 */

export const SELECTOR_GET_COMMON_POOLS = "0xe6a72044";
export const SELECTOR_GET_SWAP_QUOTE = "0xd96825ea";
export const SELECTOR_EXECUTE_SWAP = "0x0bb56928";

const HEX = "0123456789abcdef";

/** Strip a leading `0x` if present. */
const strip0x = (s: string): string => (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s);

/** Left-pad a hex string to `len` chars (no `0x` prefix). */
const padLeft = (hex: string, len = 64): string => hex.padStart(len, "0");

/** Encode an address as a left-padded 32-byte hex word (no prefix). */
export const encAddress = (addr: string): string => {
  const h = strip0x(addr).toLowerCase();
  if (h.length !== 40 || !/^[0-9a-f]{40}$/.test(h)) {
    throw new Error(`Invalid address: ${addr}`);
  }
  return padLeft(h, 64);
};

/** Encode a uint256 as a 32-byte hex word (no prefix). */
export const encUint = (v: bigint | string | number): string => {
  const big = typeof v === "bigint" ? v : BigInt(v);
  if (big < 0n) throw new Error(`uint256 must be >= 0, got ${big.toString()}`);
  return padLeft(big.toString(16), 64);
};

/**
 * Encode calldata for `PoolFactory.getCommonPools(address,address)`.
 */
export const encGetCommonPools = (tokenA: string, tokenB: string): string =>
  SELECTOR_GET_COMMON_POOLS + encAddress(tokenA) + encAddress(tokenB);

/**
 * Encode calldata for `Router.getSwapQuote(pool, tokenIn, tokenOut, amountIn)`.
 */
export const encGetSwapQuote = (
  pool: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): string =>
  SELECTOR_GET_SWAP_QUOTE +
  encAddress(pool) +
  encAddress(tokenIn) +
  encAddress(tokenOut) +
  encUint(amountIn);

/** Route step input for `executeSwap`. */
export interface IEncRouteStep {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  minOut: bigint;
}

/**
 * Encode calldata for
 * `Router.executeSwap((RouteStep[], amountOut, gasEstimate), amountIn, minAmountOut, recipient)`.
 *
 * Layout (ABI v2):
 *   selector
 *   head:
 *     [0]  offset to Route tuple (= 0x80 since 4 fixed words follow)
 *     [1]  amountIn
 *     [2]  minAmountOut
 *     [3]  recipient
 *   tail (Route tuple body, dynamic because `steps` is dynamic):
 *     [4]  offset to steps[] (= 0x60)
 *     [5]  amountOut
 *     [6]  gasEstimate
 *     [7]  steps.length
 *     [8...] each step: pool, tokenIn, tokenOut, minOut (4 words)
 */
export const encExecuteSwap = (
  steps: IEncRouteStep[],
  amountOut: bigint,
  gasEstimate: bigint,
  amountIn: bigint,
  minAmountOut: bigint,
  recipient: string,
): string => {
  const stepsBody = steps
    .map((s) => encAddress(s.pool) + encAddress(s.tokenIn) + encAddress(s.tokenOut) + encUint(s.minOut))
    .join("");

  const routeTuple =
    encUint(0x60n) + // offset to steps[] inside the tuple body
    encUint(amountOut) +
    encUint(gasEstimate) +
    encUint(BigInt(steps.length)) +
    stepsBody;

  const head =
    encUint(0x80n) + // offset to Route tuple = 4 * 32
    encUint(amountIn) +
    encUint(minAmountOut) +
    encAddress(recipient);

  return SELECTOR_EXECUTE_SWAP + head + routeTuple;
};

/**
 * Decode an `address[]` return value (canonical ABI dynamic-array layout).
 *
 * Input is the raw hex string (with or without `0x`) of the eth_call output.
 */
export const decAddressArray = (hex: string): string[] => {
  const h = strip0x(hex);
  if (h.length < 128) return [];
  // First 32 bytes = offset to array (always 0x20 for top-level dynamic).
  // Next 32 bytes = length.
  const len = Number(BigInt("0x" + h.slice(64, 128)));
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const start = 128 + i * 64;
    const word = h.slice(start, start + 64);
    // Address occupies the low 20 bytes.
    out.push("0x" + word.slice(24));
  }
  return out;
};

/**
 * Decode just the `amountOut` (first uint256 of the SwapQuote tuple) from
 * `Router.getSwapQuote` return data.
 *
 * The struct is statically-laid-out for its head: `amountOut` is at byte 0.
 * (Dynamic fields like `routeHops`/`hopAmounts`/`hopPrices` come later via
 * offsets — we ignore them at the aggregator layer.)
 */
export const decSwapQuoteAmountOut = (hex: string): bigint => {
  const h = strip0x(hex);
  if (h.length < 64) return 0n;
  return BigInt("0x" + h.slice(0, 64));
};

/**
 * Minimal JSON-RPC `eth_call` over `fetch`. Returns the raw hex result.
 */
export const ethCall = async (
  rpcUrl: string,
  to: string,
  data: string,
): Promise<string> => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) {
    throw new Error(`eth_call failed: HTTP ${res.status}`);
  }
  const j = (await res.json()) as { result?: string; error?: { message?: string } };
  if (j.error) throw new Error(`eth_call RPC error: ${j.error.message ?? "unknown"}`);
  return j.result ?? "0x";
};
