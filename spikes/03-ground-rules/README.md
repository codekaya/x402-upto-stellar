# Spike 3: the ground rules

Read on 20 October 2026 from `@x402/stellar`, `@x402/evm`, `@x402/svm` and
`@x402/core`, all at 2.28.0. Three questions: which interfaces to mirror, which
token to settle in, and what the metered demo runs on.

**Results.** Mirror the `upto` triplet that EVM and SVM already ship, on
`@x402/core` v2 types. Settle in Circle's testnet USDC. Target
`@stellar/stellar-sdk` 16, as `@x402/stellar` does. The local model is still
open, pending a runtime install.

## 1. The interfaces to mirror

### Package shape

| Package | Exports |
|---|---|
| `@x402/stellar` | `exact/client`, `exact/server`, `exact/facilitator` |
| `@x402/evm` | `exact/*`, **`upto/client`, `upto/server`, `upto/facilitator`**, `batch-settlement/*`, … |
| `@x402/svm` | `exact/*`, **`upto/*`**, `batch-settlement/*` |

So the Stellar `upto` triplet is `upto/client`, `upto/server` and
`upto/facilitator`, each exporting a class `UptoStellarScheme`, after
`ExactStellarScheme`, `UptoEvmScheme` and `UptoSvmScheme`. Each implements the
matching `@x402/core/types` interface:

| Entry point | Implements | Surface |
|---|---|---|
| `upto/client` | `SchemeNetworkClient` | `constructor(signer: ClientStellarSigner, rpcConfig?)`, `createPaymentPayload(x402Version, requirements)` |
| `upto/server` | `SchemeNetworkServer` | `parsePrice`, `enhancePaymentRequirements`, `getAssetDecimals`, `registerMoneyParser`, `paymentFlows` |
| `upto/facilitator` | `SchemeNetworkFacilitator` | `constructor(signers: FacilitatorStellarSigner[], options)`, `verify`, `settle`, `getExtra`, `getSigners`, `caipFamily = "stellar:*"` |

The signer types come from `@x402/stellar` and should be reused, not
redefined. `ClientStellarSigner` is `{ address, signAuthEntry, signTransaction? }`,
the shape wallets already implement, so a Freighter user can pay through `upto`
with no new wallet code. The facilitator options worth copying from
`exact/facilitator`: `rpcConfig`, `areFeesSponsored`,
`maxTransactionFeeStroops` (default 50,000), `inclusionFeeStroops`,
`selectSigner`, `feeBumpSigner`.

### Core v2 types

```ts
type PaymentRequirements = { scheme; network /* CAIP-2 */; asset; amount; payTo; maxTimeoutSeconds; extra };
type PaymentPayload      = { x402Version; resource?; accepted: PaymentRequirements; payload; extensions? };
type VerifyResponse      = { isValid; invalidReason?; invalidMessage?; payer?; ... };
type SettleResponse      = { success; errorReason?; errorMessage?; payer?; transaction; network; amount?; ... };
```

`SettleResponse.amount` is documented as present "for schemes like `upto`",
the actual amount settled. Networks are `stellar:testnet` and `stellar:pubnet`.
Headers are `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`;
`X-PAYMENT` survives only on the v1 path.

### Conventions `upto` on EVM already settled

From `@x402/evm/upto/facilitator`:

1. **Verify:** the signed maximum must equal `requirements.amount` exactly.
2. **Settle:** the resource server passes `requirements.amount` set to the
   actual usage. The facilitator re-verifies against the signed maximum and
   refuses anything above it.
3. **Zero:** a settlement of `0` returns success with an empty `transaction`
   and touches nothing on-chain.
4. **The facilitator is bound into the signature.** The payer signs
   `witness.facilitator`. That is exactly our `settler` field, which answers
   the spec's first open question: the role already exists upstream.
5. **Idempotency:** a pending-settlement store keyed by signature returns the
   in-flight transaction instead of submitting twice. That is how the
   no-retry rule is enforced in code.
6. **Reasons:** scheme-specific constants such as
   `invalid_upto_evm_payload_settlement_exceeds_amount`, alongside the generic
   ones.

`exact` on Stellar sends `payload: { transaction }`, a whole transaction built
against a null source with the payer's auth entry signed through
`signAuthEntries`. The facilitator re-sources it and pays the fee, and
`areFeesSponsored` must be `true`.

## 2. Consequences

**The spec is written against x402 v1 and has to be rebased on v2** before
Deliverable 2 builds on it: `network: "stellar-testnet"` becomes
`stellar:testnet`, `maxAmountRequired` becomes `amount` (the cap),
`x402Version: 1` becomes 2, the payload carries `accepted`, the header becomes
`PAYMENT-SIGNATURE`, the settled amount arrives in `requirements.amount` at
settle time and leaves in `SettleResponse.amount`.

**One decision for week 3: what settling zero means.** EVM skips the chain.
On Stellar, skipping leaves the payer's entry valid until its window closes, so
a settler could still settle up to the cap later. Calling
`settle_signed(…, 0)` costs about 0.003 XLM and burns the authorization for
good. The facilitator should pick one, and the conformance vectors should pin
it.

**The fee ceiling fits.** A warm `settle_signed` costs 29,016 to 30,516
stroops, under `exact`'s 50,000 default. A cold one, where the instance or a
balance entry needs restoring, does not fit, and should fail verification with a
clear reason rather than pay the restore silently.

## 3. SDK version

| | `@stellar/stellar-sdk` 16.3.1 | 17.2.1 |
|---|---|---|
| Used by `@x402/stellar` 2.28.0 | yes, `^16.3.0` | no |
| XDR accessors | getters, `entry.rootInvocation()` | immutable properties, `entry.rootInvocation` |
| `authorizeInvocation` default | legacy v1 credentials | CAP-71 v2 credentials |

**Decision: the packages target `^16.3`, matching `@x402/stellar`.** A
facilitator that serves `exact` and `upto` side by side then loads one SDK, and
the upstream contribution after the sprint needs no SDK migration. Verification
accepts both credential formats either way, as Spike 1 showed both settle. The
spikes stay on 17; they are throwaway.

## 4. Settlement token

**Decision: Circle's testnet USDC**, SAC
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, issuer
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. It is the default
asset `@x402/stellar` uses for `stellar:testnet`. No test SAC is needed.

| Check | Outcome |
|---|---|
| SAC deployed | yes |
| `auth_required` | false: any account can open a trustline |
| Obtainable without a faucet form | yes: 100 XLM buys about 88 USDC on the testnet DEX |
| Full `settle_signed` cycle | passes, `npm run spike:usdc` in [`01-two-signers`](../01-two-signers) |
| First settlement in the token | 801,012 stroops: creates the contract's USDC balance entry, once |
| Warm settlement | 30,516 stroops |
| Balance entry lifetime | SAC extends it to 30 days on every touch |

## 5. The local model

Open. The machine is an Apple M2 with 16 GB, enough for a small model, but no
runtime is installed (no Ollama, llama.cpp, LM Studio or MLX). Proposed:
Ollama with a sub-2 GB model, because its responses already report the tokens
produced (`eval_count`, or `usage.completion_tokens` on the OpenAI-compatible
endpoint). That count is exactly what the meter needs, and it means the proxy
never has to tokenize anything itself.
