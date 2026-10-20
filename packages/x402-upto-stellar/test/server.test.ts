import assert from "node:assert/strict";
import { test } from "node:test";

import { UptoStellarScheme } from "../src/upto/server/index.js";
import { ESCROW, USDC, facilitatorKey, requirements } from "./helpers.js";

const server = new UptoStellarScheme();

test("a dollar price is a USDC cap in atomic units", async () => {
  assert.deepEqual(await server.parsePrice("$0.50", "stellar:testnet"), { asset: USDC, amount: "5000000" });
  assert.deepEqual(await server.parsePrice(2, "stellar:testnet"), { asset: USDC, amount: "20000000" });
});

test("a registered money parser wins", async () => {
  const custom = new UptoStellarScheme().registerMoneyParser(async (amount) => ({ asset: "X", amount: `${amount}!` }));
  assert.deepEqual(await custom.parsePrice("1", "stellar:testnet"), { asset: "X", amount: "1!" });
});

test("requirements gain the escrow contract and the facilitator address", async () => {
  const base = requirements({ extra: {} });
  const enhanced = await server.enhancePaymentRequirements(
    base,
    { x402Version: 2, scheme: "upto", network: "stellar:testnet", extra: { facilitatorAddress: facilitatorKey.publicKey(), areFeesSponsored: true } },
    [],
  );
  assert.equal(enhanced.extra.contract, ESCROW);
  assert.equal(enhanced.extra.facilitatorAddress, facilitatorKey.publicKey());
  assert.equal(enhanced.extra.areFeesSponsored, true);
});
