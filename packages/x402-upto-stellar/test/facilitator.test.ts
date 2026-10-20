import assert from "node:assert/strict";
import { test } from "node:test";
import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { contractCall, type UptoAuthorization } from "../src/shared/encoding.js";
import { buildSignedPayload } from "../src/shared/payload.js";
import { Reason, UptoStellarScheme } from "../src/upto/facilitator/index.js";
import {
  CHAIN_STATE,
  LEDGER,
  NOW,
  facilitatorSigner,
  paymentPayload,
  payerSigner,
  randomContract,
  requirements,
  stubServer,
} from "./helpers.js";
import { Networks } from "@stellar/stellar-sdk";

const facilitator = new UptoStellarScheme([facilitatorSigner], { server: stubServer, registry: false });

async function signed(r: PaymentRequirements, options: Partial<Parameters<typeof buildSignedPayload>[0]> = {}) {
  return buildSignedPayload({ signer: payerSigner, requirements: r, server: stubServer, passphrase: Networks.TESTNET, ...options });
}

async function reason(payload: PaymentPayload, r: PaymentRequirements) {
  const result = await facilitator.verify(payload, r);
  assert.equal(result.isValid, false);
  return result.invalidReason;
}

/** A valid payload passes every offline check and stops where chain state is needed. */
test("a valid payload passes every check up to chain state", async () => {
  const r = requirements();
  const result = await facilitator.verify(paymentPayload(r, await signed(r)), r);
  assert.equal(result.invalidReason, Reason.unexpectedVerify);
  assert.match(result.invalidMessage ?? "", new RegExp(CHAIN_STATE));
});

test("the facilitator publishes itself as the settler and sponsors fees", () => {
  assert.deepEqual(facilitator.getExtra("stellar:testnet"), { areFeesSponsored: true, facilitatorAddress: facilitatorSigner.address });
  assert.deepEqual(facilitator.getSigners("stellar:testnet"), [facilitatorSigner.address]);
});

const cases: [string, string, () => Promise<[PaymentPayload, PaymentRequirements]>][] = [
  ["x402 version 1", Reason.invalidVersion, async () => {
    const r = requirements();
    return [{ ...paymentPayload(r, await signed(r)), x402Version: 1 }, r];
  }],
  ["another scheme", Reason.unsupportedScheme, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r)), { ...r, scheme: "exact" }];
  }],
  ["accepted on another network", Reason.networkMismatch, async () => {
    const r = requirements();
    return [paymentPayload({ ...r, network: "stellar:pubnet" }, await signed(r)), r];
  }],
  ["an unsupported network", Reason.invalidNetwork, async () => {
    const r = requirements({ network: "eip155:8453" });
    return [paymentPayload(r, {}), r];
  }],
  ["a payload missing fields", Reason.malformed, async () => {
    const r = requirements();
    return [paymentPayload(r, { authorization: {}, signature: "" }), r];
  }],
  ["a signature that is not an entry", Reason.malformed, async () => {
    const r = requirements();
    return [paymentPayload(r, { ...(await signed(r)), signature: "bm90IHhkcg==" }), r];
  }],
  ["accepted differs from the requirements", Reason.requirementsMismatch, async () => {
    const r = requirements();
    return [paymentPayload({ ...r, maxTimeoutSeconds: 601 }, await signed(r)), r];
  }],
  ["payee redirected", Reason.wrongPayee, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { payee: Keypair.random().publicKey() } })), r];
  }],
  ["another token", Reason.wrongAsset, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { token: randomContract() } })), r];
  }],
  ["a settler that is not this facilitator", Reason.wrongSettler, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { settler: Keypair.random().publicKey() } })), r];
  }],
  ["the facilitator as payer", Reason.facilitatorIsPayer, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { signer: facilitatorSigner })), r];
  }],
  ["a cap below the requirements", Reason.wrongAmount, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { maxAmount: "4999999" } })), r];
  }],
  ["a resource commitment to other terms", Reason.wrongResource, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { resource: "00".repeat(32) } })), r];
  }],
  ["a window longer than maxTimeoutSeconds", Reason.windowTooLong, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { validBefore: String(NOW + 3600) } })), r];
  }],
  ["a window that has not opened", Reason.notYetValid, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { validAfter: String(NOW + 10), validBefore: String(NOW + 100) } })), r];
  }],
  ["a window that has closed", Reason.expired, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { overrides: { validAfter: String(NOW - 600), validBefore: String(NOW) } })), r];
  }],
  ["source-account credentials", Reason.unsupportedCredentialType, async () => {
    const r = requirements();
    const p = await signed(r);
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(p.signature, "base64");
    const source = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: entry.rootInvocation(),
    });
    return [paymentPayload(r, { ...p, signature: source.toXDR("base64") }), r];
  }],
  ["an entry for another address", Reason.wrongSigner, async () => {
    const r = requirements();
    const p = await signed(r);
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(p.signature, "base64");
    entry.credentials().address().address(new Address(Keypair.random().publicKey()).toScAddress());
    return [paymentPayload(r, { ...p, signature: entry.toXDR("base64") }), r];
  }],
  ["an unsigned entry", Reason.missingPayerSignature, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { unsigned: true })), r];
  }],
  ["a tree that signs the settled amount", Reason.wrongInvocation, async () => {
    const r = requirements();
    const p = await signed(r, {
      invocation: (contract, a: UptoAuthorization) => contractCall(contract, "settle_signed", [xdr.ScVal.scvVoid(), xdr.ScVal.scvVoid()]),
    });
    return [paymentPayload(r, p), r];
  }],
  ["a signature that outlives the window", Reason.signatureExpirationTooFar, async () => {
    const r = requirements();
    return [paymentPayload(r, await signed(r, { expirationLedger: LEDGER + 10_000 })), r];
  }],
];

for (const [name, expected, build] of cases) {
  test(`refuses ${name}: ${expected}`, async () => {
    const [payload, r] = await build();
    assert.equal(await reason(payload, r), expected);
  });
}

test("settle refuses an amount above the cap before touching the chain", async () => {
  const r = requirements();
  const result = await facilitator.settle(paymentPayload(r, await signed(r)), { ...r, amount: "5000001" });
  assert.equal(result.success, false);
  assert.equal(result.errorReason, Reason.settlementExceedsAmount);
});

test("settle refuses requirements that changed more than the amount", async () => {
  const r = requirements();
  const result = await facilitator.settle(paymentPayload(r, await signed(r)), { ...r, amount: "1", payTo: Keypair.random().publicKey() });
  assert.equal(result.errorReason, Reason.requirementsMismatch);
});

