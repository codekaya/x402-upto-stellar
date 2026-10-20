# Spike 1: two signers in one transaction

**Result: works. The one-shot path stands; no pivot to the session path.**
Run on 20 October 2026 against the live settlement contract
`CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB`, testnet at
protocol 29, `@stellar/stellar-sdk` 17.2.1.

## The question

Can the payer sign a `settle_signed` payload offline with `authorizeEntry`,
without signing the settled amount, and can a separate settler then name the
amount, sign the transaction and submit it, so that one transaction carries the
payer's authorization entry and the settler's own signature?

## What the script does

[`spike.ts`](spike.ts) splits the two roles the way the HTTP flow will:

1. **Payer.** Builds the payload, builds the invocation tree the spec requires
   (`settle_signed(authorization)` with the nested
   `transfer(payer, upto, maxAmount)`), signs it with `authorizeEntry` and
   encodes an `X-PAYMENT` header. It builds no transaction and submits nothing.
   Its only network read is the latest ledger, to set the signature expiry to
   roughly `validBefore`.
2. **Settler.** Receives only the header string. Checks the entry shape, names
   the amount, adds its own source-account authorization over the full call,
   simulates in enforcing mode, signs the envelope and submits.

Accounts are generated and funded through friendbot on every run, so no secret
is stored. The token is the native XLM SAC, which needs no trustline.
`npm run spike:usdc` runs the identical flow on Circle's testnet USDC, which
Spike 3 picked as the sprint's settlement token, buying the payer's USDC on the
testnet DEX first. Both pass every check below.

```bash
npm install
npm run spike        # native XLM
npm run spike:usdc   # testnet USDC
```

## Checks, all passing

| Check | Outcome |
|---|---|
| Entry is signed by the payer | `addressV2` credentials |
| Entry tree equals the spec tree | exact XDR match |
| Host-recorded payer tree equals the spec tree | exact XDR match, settled amount absent |
| The same entry simulates at 0, 2 and 5 XLM | all succeed: one signature, any amount within the cap |
| Settling 5.0000001 XLM against a 5 XLM cap | `Error(Contract, #9)` `AmountOutOfRange` |
| Settler redirects the payee to itself | `Error(Auth, InvalidAction)` |
| Settler raises the cap | `Error(Auth, InvalidAction)` |
| Legacy v1 address-credential entry | accepted |
| Amount changed after the settler signed | rejected at submission, `txBadAuth` |
| Payee balance | up exactly 2 XLM |
| Payer balance | down exactly 2 XLM: 5 pulled, 3 refunded, fee paid by the settler |
| Contract balance afterwards | 0 |
| `is_consumed(id)` after settlement | `true` |

So neither signer can change the other's half. The payer's entry pins payee,
cap, token, window, resource and settler; the settler's envelope signature pins
the amount.

## Transactions

| Date | What | Tx |
|---|---|---|
| 2026-10-20 | Settlement 2 of 5 XLM, contract cold (instance and wasm restored in the same tx) | [`a8917bfe…`](https://stellar.expert/explorer/testnet/tx/a8917bfeb6b77cef1b028c56ebef743ac39193d5bfa7bdbfaeec8e7d189d2399) |
| 2026-10-20 | Settlement 2 of 5 XLM, contract warm | [`2380de64…`](https://stellar.expert/explorer/testnet/tx/2380de648f78d01b16ca5b98a6623d3cb88c918d48718b3542f7d76ca290e6a1) |
| 2026-10-20 | Settlement 2 of 5 USDC, first in the token (creates the contract's USDC balance entry) | [`4df50792…`](https://stellar.expert/explorer/testnet/tx/4df50792a16a6f778c814e25e17d5b5b6df28adc6bb404d4524d733040c1ca83) |
| 2026-10-20 | Settlement 2 of 5 USDC, warm | [`bc2b0093…`](https://stellar.expert/explorer/testnet/tx/bc2b00938a8670cba8b6be61b6da45fe672e08a6f717f6a49792eeb4c76ba3b5) |

## Findings that change the plan

**1. Exact replay is a host error, not `AlreadyConsumed`.** Replaying the same
header fails with `Error(Auth, ExistingValue)`: the entry's protocol nonce is
already spent, so the host refuses before the contract runs. The contract's
`AlreadyConsumed` (#7) is only reached when the payer signs the same payload
twice under different entry nonces. The spec's settle table maps every host
authorization failure to `invalid_signature`; `ExistingValue` should map to
`invalid_payment` like `AlreadyConsumed`, since it is a replay and not a bad
signature. Verification catches both earlier through `is_consumed`. This goes
into the Deliverable 2 error mapping and the conformance vectors.

**2. Two credential formats.** On protocol 29 the SDK emits CAP-71
`SOROBAN_CREDENTIALS_ADDRESS_V2` by default, and the host still accepts legacy
`SOROBAN_CREDENTIALS_ADDRESS`. The client should emit v2. The facilitator's
signature-shape check must accept both, or it will refuse wallets that have not
moved yet. The spec only says "a `SorobanAuthorizationEntry`" and should name
both.

**3. The settlement contract gets archived.** Its instance and wasm were
archived eleven days after the 9 October deployment, on testnet's 7-day minimum
TTL. The first settlement restored both automatically (`archivedSorobanEntries`
in the transaction data) and cost 11.44 XLM in fees against 0.0029 XLM warm.
The restored entries again lived only 7 days, until ledger 5,414,350, so both
were extended the same day to testnet's maximum, ledger 8,404,001, about April
2027, which covers the sprint
([instance](https://stellar.expert/explorer/testnet/tx/97f17dc29f71e265a9ad6a7eb869abdf6ce5f5d05dfd2da4e385afb207696c2c),
[wasm](https://stellar.expert/explorer/testnet/tx/4a07b4b1c3476586886668a6c7c87592f4d72d9550ecde742a040fac2524def3)). The registry
needs the same instance policy, and the facilitator should report archived
entries rather than quietly paying for them.

## Warm resource profile

One `settle_signed` with a refund, five token movements in all:

| Resource | Value |
|---|---|
| Instructions | 1,904,052 |
| Disk read | 288 B |
| Write | 720 B |
| Resource fee, simulated | 35,726 stroops |
| Fee charged after refund | 29,016 stroops (0.0029 XLM); 30,516 on USDC |
| `X-PAYMENT` header | 2,556 base64 characters |
