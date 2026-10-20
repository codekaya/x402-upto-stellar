# Metered inference, paid with x402 `upto`

A proxy in front of a local model that charges for the tokens it actually
produced, below a cap the agent authorized up front.

```
agent ── POST ─────────────────────────▶ service          402 + PAYMENT-REQUIRED: upto, cap 0.05 USDC
agent ── POST + PAYMENT-SIGNATURE ─────▶ service ─ verify ─▶ Ollama (max_tokens = cap / price)
                                         service ◀─ completion, usage.completion_tokens
                                         service ─ settle(tokens × price) ─▶ Stellar testnet
agent ◀─ 200 + PAYMENT-RESPONSE ──────── service          settled amount and transaction hash
```

- **Cap:** 0.05 USDC per request, so at most 500 tokens.
- **Price:** 0.0001 USDC per output token.
- **Meter:** `usage.completion_tokens` as Ollama reports it. The proxy never
  tokenizes anything itself.
- **Bound:** generation is limited to what the cap can buy, so usage cannot
  exceed what the payer authorized, before settlement ever runs.
- **Settlement:** one `settle_signed` transaction pulls the cap, pays the
  metered amount and returns the rest.

The facilitator runs in-process. The agent uses `@x402/core`'s own
`x402Client` with the `upto` scheme registered for `stellar:*`.

## Run

```bash
brew install ollama && ollama serve &
ollama pull qwen2.5:0.5b
npm install && npm run build
npx tsx examples/metered-service/server.ts   # funds a fresh payee and facilitator on testnet
npx tsx examples/metered-service/agent.ts    # funds a fresh payer, pays, checks its balance
```

`FACILITATOR_SECRET`, `PAYEE_SECRET` and `PAYER_SECRET` reuse existing testnet
keys instead. `CAP`, `PRICE_PER_TOKEN` and `MODEL` change the terms.

## A recorded cycle, 20 October 2026

```
402: scheme upto, cap 0.0500000 USDC, escrow CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB

tokens produced  35
authorized cap   0.0500000 USDC
settled          0.0035000 USDC
returned         0.0465000 USDC
payer paid       0.0035000 USDC
settlement       https://stellar.expert/explorer/testnet/tx/1630e707676f99119fa516ae7a7112d266528eafaebb7f7efa5fba7b4dbb2128

settled below the cap; the payer paid exactly the metered amount
```
