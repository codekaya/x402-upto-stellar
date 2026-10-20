/**
 * A metered inference service paid with x402 `upto` on Stellar.
 *
 * Proxies an OpenAI-compatible chat endpoint in front of a local model served
 * by Ollama. An unpaid request gets 402 with an `upto` entry: a cap, not a
 * price. A paid request is verified, served with generation limited to what
 * the cap can buy, metered by the tokens the model reports it produced, and
 * settled for exactly that, below the cap. The rest of the cap stays with the
 * payer: it is pulled and refunded in the same settlement transaction.
 *
 *   npx tsx examples/metered-service/server.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { UptoStellarScheme as UptoFacilitator } from "x402-upto-stellar/upto/facilitator";
import { UptoStellarScheme as UptoServer } from "x402-upto-stellar/upto/server";

import { EXPLORER, NETWORK, RPC_URL, account, submit, trustUsdc, usdc } from "./setup.js";

const PORT = Number(process.env.PORT ?? 4021);
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.MODEL ?? "qwen2.5:0.5b";
const CAP = process.env.CAP ?? "$0.05";
/** 0.0001 USDC per output token, in atomic units. */
const PRICE_PER_TOKEN = BigInt(process.env.PRICE_PER_TOKEN ?? 1_000);

// The facilitator runs in-process: it verifies, and settles as the transaction source.
const facilitatorAccount = await account(process.env.FACILITATOR_SECRET);
const payeeAccount = await account(process.env.PAYEE_SECRET);
if (payeeAccount.fresh) {
  const hash = await submit(payeeAccount.keypair, [trustUsdc()]);
  console.log(`payee USDC trustline ${EXPLORER}/${hash}`);
}
const facilitator = new UptoFacilitator([createEd25519Signer(facilitatorAccount.keypair.secret(), NETWORK)], { rpcUrl: RPC_URL });
const scheme = new UptoServer();

const { asset, amount } = await scheme.parsePrice(CAP, NETWORK);
const requirements = await scheme.enhancePaymentRequirements(
  { scheme: "upto", network: NETWORK, asset, amount, payTo: payeeAccount.keypair.publicKey(), maxTimeoutSeconds: 300, extra: {} },
  { x402Version: 2, scheme: "upto", network: NETWORK, extra: facilitator.getExtra(NETWORK) },
  [],
);
const paymentRequired: PaymentRequired = {
  x402Version: 2,
  resource: {
    url: `http://localhost:${PORT}/v1/chat/completions`,
    description: `Metered inference on ${MODEL}, ${usdc(PRICE_PER_TOKEN)} per output token`,
    mimeType: "application/json",
  },
  accepts: [requirements],
};
const maxTokens = Number(BigInt(requirements.amount) / PRICE_PER_TOKEN);

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") return send(res, 404, { error: "not found" });
  const body = await readJson(req);

  const header = req.headers["payment-signature"];
  if (typeof header !== "string") {
    return send(res, 402, { ...paymentRequired, error: "PAYMENT-SIGNATURE header is required" }, {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
    });
  }

  const payment = decodePaymentSignatureHeader(header);
  const verified = await facilitator.verify(payment, requirements);
  if (!verified.isValid) {
    console.log(`refused ${verified.invalidReason}`);
    return send(res, 402, { ...paymentRequired, error: verified.invalidReason }, {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ ...paymentRequired, error: verified.invalidReason }),
    });
  }

  // Serve, never producing more than the cap can buy.
  const limit = Math.min(Number(body.max_tokens ?? maxTokens), maxTokens);
  const upstream = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: body.messages, max_tokens: limit, stream: false }),
  });
  const completion = await upstream.json();

  // Meter: the tokens the model reports it produced.
  const tokens = BigInt(completion.usage?.completion_tokens ?? 0);
  const settled = tokens * PRICE_PER_TOKEN;
  const settlement = await facilitator.settle(payment, { ...requirements, amount: settled.toString() });
  if (!settlement.success) {
    console.log(`settlement failed ${settlement.errorReason}`);
    return send(res, 402, { error: settlement.errorReason });
  }

  const cap = BigInt(requirements.amount);
  console.log(`served ${tokens} tokens, settled ${usdc(settled)} of ${usdc(cap)} cap ${EXPLORER}/${settlement.transaction}`);
  send(
    res,
    200,
    { ...completion, metering: { tokens: Number(tokens), pricePerToken: PRICE_PER_TOKEN.toString(), cap: cap.toString(), settled: settled.toString(), refunded: (cap - settled).toString(), transaction: settlement.transaction } },
    { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settlement) },
  );
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    send(res, 500, { error: String(error) });
  });
}).listen(PORT, () => {
  console.log(`metered ${MODEL} on http://localhost:${PORT}/v1/chat/completions`);
  console.log(`cap ${usdc(requirements.amount)} (${maxTokens} tokens), payee ${payeeAccount.keypair.publicKey()}, facilitator ${facilitatorAccount.keypair.publicKey()}`);
});
