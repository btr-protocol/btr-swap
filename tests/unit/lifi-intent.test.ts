/**
 * LiFi Intent type-shape + module-surface tests.
 *
 * Goal: zero network calls. We only validate that:
 *   1. The intent module exports the documented entry points.
 *   2. The request/response types are structurally compatible with the
 *      authoritative Li.Fi intent spec.
 *   3. The base URL resolver honours `LIFI_INTENT_API_BASE_URL`.
 *   4. `getIntentStatus` rejects empty params synchronously.
 */

import { expect } from "chai";

import {
  getIntentApiBase,
  requestIntentQuote,
  submitIntentOrder,
  getIntentStatus,
  getIntentChains,
  getIntentRoutes,
} from "@/core/LiFi/intent";
import type {
  ILifiIntentQuoteRequest,
  ILifiIntentQuote,
  ILifiIntentSubmitRequest,
  IStandardOrder,
  IMandateOutput,
} from "@/core/LiFi/intent-types";

describe("LiFi Intent module surface", () => {
  it("exposes the documented request fns", () => {
    expect(typeof requestIntentQuote).to.equal("function");
    expect(typeof submitIntentOrder).to.equal("function");
    expect(typeof getIntentStatus).to.equal("function");
    expect(typeof getIntentChains).to.equal("function");
    expect(typeof getIntentRoutes).to.equal("function");
  });

  it("default base URL points at https://order.li.fi", () => {
    delete process.env.LIFI_INTENT_API_BASE_URL;
    expect(getIntentApiBase()).to.equal("https://order.li.fi");
  });

  it("honors LIFI_INTENT_API_BASE_URL env override (dev host)", () => {
    process.env.LIFI_INTENT_API_BASE_URL = "https://order-dev.li.fi";
    expect(getIntentApiBase()).to.equal("https://order-dev.li.fi");
    delete process.env.LIFI_INTENT_API_BASE_URL;
  });

  it("getIntentStatus rejects when neither order id is supplied", async () => {
    let threw = false;
    try {
      await getIntentStatus({});
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.match(/onChainOrderId|catalystOrderId/);
    }
    expect(threw).to.equal(true);
  });
});

describe("LiFi Intent type-shape contracts", () => {
  it("ILifiIntentQuoteRequest matches /quote/request body shape", () => {
    const req: ILifiIntentQuoteRequest = {
      user: "0x0000000000000000000000000000000000000001",
      intent: {
        intentType: "oif-swap",
        inputs: [
          {
            user: "0x0000000000000000000000000000000000000001",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            amount: "1000000",
          },
        ],
        outputs: [
          {
            receiver: "0x0000000000000000000000000000000000000001",
            asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            amount: "1000000",
          },
        ],
        swapType: "exact-input",
        metadata: { integrator: "btr" },
      },
      supportedTypes: ["oif-escrow-v0"],
    };
    expect(req.intent.intentType).to.equal("oif-swap");
    expect(req.intent.inputs[0]!.amount).to.equal("1000000");
    expect(req.supportedTypes).to.include("oif-escrow-v0");
  });

  it("ILifiIntentQuote response shape is consumable", () => {
    const quote: ILifiIntentQuote = {
      quoteId: "q_abc123",
      validUntil: 1_700_000_000,
      preview: {
        inputs: [
          {
            user: "0x0000000000000000000000000000000000000001",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            amount: "1000000",
          },
        ],
        outputs: [
          {
            receiver: "0x0000000000000000000000000000000000000001",
            asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            amount: "999500",
          },
        ],
      },
      metadata: { exclusiveFor: null },
      partialFill: false,
      failureHandling: "refund",
    };
    expect(quote.quoteId).to.match(/^q_/);
    expect(quote.partialFill).to.equal(false);
  });

  it("StandardOrder w/ MandateOutput round-trips through the submit shape", () => {
    const out: IMandateOutput = {
      oracle: "0x0000000000000000000000000000000000000010",
      settler: "0x0000000000000000000000000000000000000011",
      chainId: 8453,
      token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      amount: "999500",
      recipient: "0x0000000000000000000000000000000000000001",
      call: "0x",
      context: "0x",
    };
    const order: IStandardOrder = {
      user: "0x0000000000000000000000000000000000000001",
      nonce: "1",
      originChainId: 8453,
      expires: 1_700_000_300,
      fillDeadline: 1_700_000_240,
      inputOracle: "0x0000000000000000000000000000000000000020",
      inputs: [["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "1000000"]],
      outputs: [out],
    };
    const submit: ILifiIntentSubmitRequest = {
      orderType: "CatalystCompactOrder",
      inputSettler: "0x0000000000000000000000000000000000000030",
      quoteId: "q_abc123",
      order,
      signature: "0xdeadbeef",
    };
    expect(submit.orderType).to.equal("CatalystCompactOrder");
    expect(submit.order.outputs[0]!.token).to.equal(out.token);
    expect(submit.order.inputs[0]![1]).to.equal("1000000");
  });
});
