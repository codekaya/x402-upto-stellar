import assert from "node:assert/strict";
import { test } from "node:test";
import { xdr } from "@stellar/stellar-sdk";

import { resourceCommitment, type UptoStellarPayload } from "../src/shared/encoding.js";
import { UptoStellarScheme } from "../src/upto/client/index.js";
import { LEDGER, NOW, facilitatorKey, payee, payerSigner, requirements, stubServer } from "./helpers.js";

const client = new UptoStellarScheme(payerSigner, { server: stubServer, registry: false });

test("the payload is derived from the accepted requirements", async () => {
  const r = requirements();
  const { payload } = await client.createPaymentPayload(2, r);
  const { authorization: a, signature } = payload as unknown as UptoStellarPayload;
  assert.equal(a.payer, payerSigner.address);
  assert.equal(a.payee, payee);
  assert.equal(a.settler, facilitatorKey.publicKey());
  assert.equal(a.maxAmount, r.amount);
  assert.equal(a.validAfter, String(NOW - 60));
  assert.equal(a.validBefore, String(NOW + 600));
  assert.equal(a.resource, resourceCommitment(r));

  const entry = xdr.SorobanAuthorizationEntry.fromXDR(signature, "base64");
  const credentials = entry.credentials().address();
  assert.equal(credentials.signatureExpirationLedger(), LEDGER + 120);
  assert.ok(credentials.signature().vec()!.length > 0, "signed");
});

test("two payloads for the same terms never share a nonce", async () => {
  const one = (await client.createPaymentPayload(2, requirements())).payload as unknown as UptoStellarPayload;
  const two = (await client.createPaymentPayload(2, requirements())).payload as unknown as UptoStellarPayload;
  assert.notEqual(one.authorization.nonce, two.authorization.nonce);
});

test("requirements without a facilitator address are refused", async () => {
  await assert.rejects(client.createPaymentPayload(2, requirements({ extra: { contract: "C" } })), /facilitatorAddress/);
});

test("a cap above the client's spend limit is refused", async () => {
  await assert.rejects(client.createPaymentPayload(2, requirements(), { maxAmountPerPayment: "1000" }), /spend limit/);
});

test("other schemes are refused", async () => {
  await assert.rejects(client.createPaymentPayload(2, requirements({ scheme: "exact" })), /unsupported scheme/);
});
