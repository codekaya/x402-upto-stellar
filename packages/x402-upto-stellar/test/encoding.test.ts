import assert from "node:assert/strict";
import { test } from "node:test";
import { xdr } from "@stellar/stellar-sdk";

import {
  authorizationToScVal,
  canonicalJson,
  isUptoPayload,
  payerInvocation,
  resourceCommitment,
  sameRequirements,
  type UptoAuthorization,
} from "../src/shared/encoding.js";
import { ESCROW, USDC, payee, payerKey, requirements } from "./helpers.js";

const authorization: UptoAuthorization = {
  payer: payerKey.publicKey(),
  payee,
  settler: payee,
  token: USDC,
  maxAmount: "5000000",
  validAfter: "100",
  validBefore: "700",
  nonce: "11".repeat(32),
  resource: "22".repeat(32),
};

test("JCS sorts keys at every depth and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" }, u: undefined }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
});

test("JCS follows RFC 8785 for numbers and strings", () => {
  assert.equal(canonicalJson({ n: 1e21, f: 0.5, s: "é\n" }), '{"f":0.5,"n":1e+21,"s":"é\\n"}');
});

test("the resource commitment ignores key order", () => {
  const r = requirements();
  const reordered = Object.fromEntries(Object.entries(r).reverse()) as typeof r;
  assert.equal(resourceCommitment(r), resourceCommitment(reordered));
  assert.match(resourceCommitment(r), /^[0-9a-f]{64}$/);
});

test("the resource commitment changes with any term", () => {
  assert.notEqual(resourceCommitment(requirements()), resourceCommitment(requirements({ amount: "5000001" })));
});

test("requirements compare with or without the amount", () => {
  assert.ok(sameRequirements(requirements(), requirements()));
  assert.ok(!sameRequirements(requirements(), requirements({ amount: "1" })));
  assert.ok(sameRequirements(requirements(), requirements({ amount: "1" }), true));
  assert.ok(!sameRequirements(requirements(), requirements({ payTo: ESCROW }), true));
});

test("the authorization encodes as the contract's sorted map", () => {
  const keys = authorizationToScVal(authorization).map()!.map((e) => e.key().sym().toString());
  assert.deepEqual(keys, ["max_amount", "nonce", "payee", "payer", "resource", "settler", "token", "valid_after", "valid_before"]);
});

test("the payer's tree is settle_signed(authorization) over transfer(payer, escrow, cap)", () => {
  const tree = payerInvocation(ESCROW, authorization);
  const root = tree.function().contractFn();
  assert.equal(root.functionName().toString(), "settle_signed");
  assert.equal(root.args().length, 1, "the settled amount is not signed");
  const [transfer] = tree.subInvocations();
  const call = transfer.function().contractFn();
  assert.equal(call.functionName().toString(), "transfer");
  assert.equal(call.args()[2].switch(), xdr.ScValType.scvI128());
});

test("payload shape validation", () => {
  assert.ok(isUptoPayload({ authorization, signature: "AAAA" }));
  assert.ok(!isUptoPayload({ authorization: { ...authorization, maxAmount: "5.0" }, signature: "AAAA" }));
  assert.ok(!isUptoPayload({ authorization: { ...authorization, nonce: "0x11" }, signature: "AAAA" }));
  assert.ok(!isUptoPayload({ authorization }));
});
