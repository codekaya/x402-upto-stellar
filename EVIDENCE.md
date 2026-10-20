# Evidence of completion

For the Ambassador Chapter Lead. This page follows section 6 of the accepted
Statement of Work: every evidence item it lists, in the same order, with the
link that proves it. Every transaction ran on Stellar testnet on 20 October 2026.

**The cycle in one line:** an agent authorized up to 0.05 USDC, the service
produced 35 tokens, and one transaction paid 0.0035 USDC and returned 0.0465 to
the agent ([`1630e707…`](https://stellar.expert/explorer/testnet/tx/1630e707676f99119fa516ae7a7112d266528eafaebb7f7efa5fba7b4dbb2128)).

## Deliverable 1 · Discovery registry contract

| Evidence the SOW asks for | Where |
|---|---|
| Registry contract ID in a block explorer | [`CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46`](https://stellar.expert/explorer/testnet/contract/CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46) |
| One successful resolution | [`3d9be975…`](https://stellar.expert/explorer/testnet/tx/3d9be975a26ec1b088c35dadf71d4909bf7d5ca0a890d143128f3109ca446972): `resolve(USDC)` returned the canonical deployment |
| Rejected: unregistered record | [`721cfe96…`](https://stellar.expert/explorer/testnet/tx/721cfe96df6293511780eaed7523c6b4fdfb423c3bb4bff68fed06d288ada8be): Failed, `NotRegistered` |
| Rejected: wrong network | [`a7cce56b…`](https://stellar.expert/explorer/testnet/tx/a7cce56bbe2df01abfe6bfe287fe1f282461a3893da34874b7fe65b5774c1b0d): Failed, `WrongNetwork` |
| Rejected: unauthorised write | [`f2c1ae3b…`](https://stellar.expert/explorer/testnet/tx/f2c1ae3bd009a8f066c671e206f13289c72cb9093e9ad99a1f2cb5b56cedae12): Failed, `NotAdmin` |
| Test suite | [`contracts/registry/src/test.rs`](contracts/registry/src/test.rs): 13 tests |
| Resource profile | [`contracts/registry/README.md`](contracts/registry/README.md#resource-profile) |
| CI run | [green, both jobs](https://github.com/codekaya/x402-upto-stellar/actions/runs/39440694287) |

The explorer shows a refused transaction as "Failed". Which error each one
failed with was read from RPC the same day and is recorded in the
[registry README](contracts/registry/README.md#evidence).

## Deliverable 2 · Facilitator and conformance suite

| Evidence the SOW asks for | Where |
|---|---|
| Public repository | [github.com/codekaya/x402-upto-stellar](https://github.com/codekaya/x402-upto-stellar) |
| Conformance vector suite | [`conformance/vectors.json`](conformance/vectors.json): 34 cases |
| Runner output | [`conformance/RESULTS.md`](conformance/RESULTS.md): **34 of 34 passed** against testnet, one line per case |
| A verification against the live deployment | case `valid-verifies`: the simulated settlement at zero passed. A simulation leaves no transaction, which is the point of verifying before any money moves |
| A settlement against the live deployment, with its hash | [`6af2aa56…`](https://stellar.expert/explorer/testnet/tx/6af2aa56a1387c403e9341273d99353e2137e4553e1a1e458bf729c2ed30b6bd): 0.2 of a 0.5 USDC cap paid, 0.3 refunded |

## Deliverable 3 · Client package and metered service

| Evidence the SOW asks for | Where |
|---|---|
| npm package at v0.1.0 | [`@codekaya/x402-upto-stellar`](https://www.npmjs.com/package/@codekaya/x402-upto-stellar): types, 45 tests, README |
| The demo service | [`examples/metered-service`](examples/metered-service): a paid proxy in front of a local model |
| A metered settlement below the cap | [`1630e707…`](https://stellar.expert/explorer/testnet/tx/1630e707676f99119fa516ae7a7112d266528eafaebb7f7efa5fba7b4dbb2128): 35 tokens, 0.0035 of 0.05 USDC, 0.0465 returned |
| 3-minute demo video | not produced: the chapter said it was not required. Offered instead as a live run at the review |
| README | [repository README](README.md) and [package README](packages/x402-upto-stellar/README.md) |

## Success criteria

All ten criteria checked on day 30 are met, each with its link, in the
[README](README.md#success-criteria). Every transaction this project produced
is listed in the [on-chain record](README.md#on-chain-record).
