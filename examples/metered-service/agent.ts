/**
 * An agent paying the metered service with x402 `upto`.
 *
 * Uses @x402/core's own client with the `upto` scheme registered for
 * `stellar:*`, so the payment is built exactly as any x402 v2 client builds
 * one. Prints what it was charged against the cap, and checks the payer's
 * balance moved by exactly the settled amount.
 *
 *   npx tsx examples/metered-service/agent.ts "your prompt"
 */
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { balanceOf } from "@codekaya/x402-upto-stellar";
import { UptoStellarScheme } from "@codekaya/x402-upto-stellar/upto/client";

import { EXPLORER, NETWORK, PASSPHRASE, USDC, account, buyUsdc, server, submit, trustUsdc, usdc } from "./setup.js";

const URL = process.env.SERVICE_URL ?? "http://localhost:4021/v1/chat/completions";
const prompt = process.argv[2] ?? "In two sentences, why does an AI agent need a spending cap?";

const payer = await account(process.env.PAYER_SECRET);
if (payer.fresh) {
  const hash = await submit(payer.keypair, [trustUsdc(), buyUsdc(payer.keypair.publicKey(), "50")]);
  console.log(`payer ${payer.keypair.publicKey()} funded with USDC ${EXPLORER}/${hash}`);
}
const client = new x402Client().register("stellar:*", new UptoStellarScheme(createEd25519Signer(payer.keypair.secret(), NETWORK)));
const balance = async () => {
  const read = await balanceOf(server, PASSPHRASE, USDC.contractId(PASSPHRASE), payer.keypair.publicKey());
  if (!read.ok) throw new Error(read.message);
  return read.value;
};

const request = { messages: [{ role: "user", content: prompt }] };
const unpaid = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
if (unpaid.status !== 402) throw new Error(`expected 402, got ${unpaid.status}`);
const paymentRequired = decodePaymentRequiredHeader(unpaid.headers.get("PAYMENT-REQUIRED")!);
const offer = paymentRequired.accepts[0];
console.log(`402: scheme ${offer.scheme}, cap ${usdc(offer.amount)}, escrow ${String(offer.extra.contract)}`);

const payment = await client.createPaymentPayload(paymentRequired);
const before = await balance();
const paid = await fetch(URL, {
  method: "POST",
  headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) },
  body: JSON.stringify(request),
});
const body = await paid.json();
if (paid.status !== 200) throw new Error(`paid request failed ${paid.status}: ${JSON.stringify(body)}`);
const settlement = decodePaymentResponseHeader(paid.headers.get("PAYMENT-RESPONSE")!);
const after = await balance();

const cap = BigInt(offer.amount);
const settled = BigInt(settlement.amount ?? "0");
console.log(`\n${body.choices[0].message.content.trim()}\n`);
console.log(`tokens produced  ${body.metering.tokens}`);
console.log(`authorized cap   ${usdc(cap)}`);
console.log(`settled          ${usdc(settled)}`);
console.log(`returned         ${usdc(cap - settled)}`);
console.log(`payer paid       ${usdc(before - after)}`);
console.log(`settlement       ${EXPLORER}/${settlement.transaction}`);

const ok = settlement.success && settled < cap && before - after === settled;
console.log(ok ? "\nsettled below the cap; the payer paid exactly the metered amount" : "\nCHECK FAILED");
process.exitCode = ok ? 0 : 1;
