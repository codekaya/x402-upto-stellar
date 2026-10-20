import assert from "node:assert/strict";
import { test } from "node:test";

import { Reason, reasonForHostError } from "../src/shared/reasons.js";
import { ESCROW, USDC } from "./helpers.js";

const map = (type: string, code: string, raisedBy?: string) => reasonForHostError({ type, code, raisedBy }, ESCROW, USDC);

test("escrow errors map to their reasons", () => {
  assert.equal(map("Contract", "7", ESCROW), Reason.alreadyConsumed);
  assert.equal(map("Contract", "9", ESCROW), Reason.settlementExceedsAmount);
  assert.equal(map("Contract", "6", ESCROW), Reason.expired);
  assert.equal(map("Contract", "5", ESCROW), Reason.notYetValid);
  assert.equal(map("Contract", "3", ESCROW), Reason.windowTooLong);
  assert.equal(map("Contract", "1", ESCROW), Reason.malformed);
  assert.equal(map("Contract", "4", ESCROW), Reason.malformed);
});

test("the same code means something else when the token raised it", () => {
  assert.equal(map("Contract", "6", USDC), Reason.payeeCannotReceive, "AccountMissing, not Expired");
  assert.equal(map("Contract", "13", USDC), Reason.payeeCannotReceive);
  assert.equal(map("Contract", "11", USDC), Reason.payeeCannotReceive);
  assert.equal(map("Contract", "10", USDC), Reason.insufficientFunds);
});

test("an exact replay is a consumed authorization, not a bad signature", () => {
  assert.equal(map("Auth", "ExistingValue"), Reason.alreadyConsumed);
  assert.equal(map("Auth", "InvalidAction"), Reason.invalidSignature);
});

test("errors from an unknown contract are not guessed", () => {
  assert.equal(map("Contract", "7", "CAEZC6F4DKZJU5IEOLBQ5XKQWGCNZA6U45KHPKEDKPB35UF3DJCK4WMX"), undefined);
  assert.equal(map("Budget", "ExceededLimit"), undefined);
});
