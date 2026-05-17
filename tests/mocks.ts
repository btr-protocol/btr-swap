import { AggId, StepType, ITransactionRequestWithEstimate } from "@/core/types";
import { getToken } from "@/core/utils";

export const mockLifiTr: ITransactionRequestWithEstimate = {
  params: {
    input: getToken("WETH", 1),
    output: getToken("DAI", 1),
    inputAmountWei: "1000000000000000000",
    aggIds: [AggId.LIFI],
    payer: "0x789",
  },
  steps: [
    {
      type: StepType.SWAP,
      estimates: {
        output: 1000,
        exchangeRate: 1,
        gasCostUsd: 10,
        feeCostUsd: 1,
        gasCostWei: 100000n,
        feeCostWei: 10000n,
        outputWei: 1000000000000000000000n,
      },
      protocol: { id: "uniswap", name: "Uniswap" },
      input: getToken("WETH", 1),
      output: getToken("DAI", 1),
    },
  ],
  globalEstimates: {
    input: 1,
    inputWei: 1000000000000000000n,
    output: 1000,
    outputWei: 1000000000000000000000n,
    slippage: 0.01,
    exchangeRate: 1,
    gasCostUsd: 10,
    gasCostWei: 100000n,
    feeCostUsd: 1,
    feeCostWei: 10000n,
  },
  latencyMs: 100,
  aggId: AggId.LIFI,
  to: "0xrouterLifi",
  from: "0x789",
  data: "0xcalldataLifi",
  value: "0",
  chainId: 1,
};

export const mockBtrDexTr: ITransactionRequestWithEstimate = {
  ...mockLifiTr,
  aggId: AggId.BTR_DEX,
  params: { ...mockLifiTr.params, aggIds: [AggId.BTR_DEX] },
  globalEstimates: {
    ...mockLifiTr.globalEstimates,
    output: 1010,
    outputWei: 1010000000000000000000n,
    exchangeRate: 1.01,
    gasCostUsd: 8,
    feeCostUsd: 0,
    gasCostWei: 80000n,
    feeCostWei: 0n,
  },
  latencyMs: 80,
  to: "0xrouterBtrDex",
  data: "0xcalldataBtrDex",
  steps: [
    {
      ...mockLifiTr.steps[0],
      protocol: { id: "btr-dex", name: "BTR DEX" },
      estimates: {
        ...mockLifiTr.steps[0].estimates!,
        output: 1010,
        outputWei: 1010000000000000000000n,
        exchangeRate: 1.01,
        gasCostUsd: 8,
        feeCostUsd: 0,
        gasCostWei: 80000n,
        feeCostWei: 0n,
      },
    },
  ],
};

export const mockQuotePerformance = {
  aggId: "LIFI",
  exchangeRate: 1,
  output: 1000,
  gasCostUsd: 10,
  feeCostUsd: 1,
  latencyMs: 100,
  steps: 1,
  protocols: ["Uniswap"],
};
