# x402 `upto` for Stellar

A Soroban contract and a scheme specification that let a client pay for a
metered service with an enforced spending cap.

The `exact` x402 scheme covers payments whose price is known before the request
is served. Metered services break that assumption: an agent calling an inference
endpoint knows its budget, not its bill. The `upto` scheme closes the gap.
Authorize a ceiling, settle the actual usage, refund the difference. It has EVM
and SVM specifications; this repository supplies the Stellar one.

Built under a Stellar Türkiye Instaward. Testnet only, not audited.

| Piece | Where |
|---|---|
| Settlement contract (dependency, live before the sprint) | [`contracts/upto`](contracts/upto) |
| **D1** Discovery registry contract | [`contracts/registry`](contracts/registry) |
| **D2** Facilitator: verify and settle | [`packages/x402-upto-stellar/src/upto/facilitator`](packages/x402-upto-stellar/src/upto/facilitator) |
| **D2** Conformance vectors and runner | [`conformance`](conformance) |
| **D3** Client and server, npm package [`@codekaya/x402-upto-stellar`](https://www.npmjs.com/package/@codekaya/x402-upto-stellar) | [`packages/x402-upto-stellar`](packages/x402-upto-stellar) |
| **D3** Metered inference service and paying agent | [`examples/metered-service`](examples/metered-service) |
| Scheme specification, x402 v2 | [`specs/scheme_upto_stellar.md`](specs/scheme_upto_stellar.md) |

## Evidence

| What | Tx |
|---|---|
| Registry registration: USDC → upto, for testnet | [`f580528c…`](https://stellar.expert/explorer/testnet/tx/f580528c3a602e4a7511bcfe35fc516dd72e81726a28e76d91f823514272fdd0) |
| Registry resolution: `resolve(USDC)` returns the upto deployment | [`3d9be975…`](https://stellar.expert/explorer/testnet/tx/3d9be975a26ec1b088c35dadf71d4909bf7d5ca0a890d143128f3109ca446972) |
| Rejected, unregistered token: `Error(Contract, #1)` `NotRegistered` | [`721cfe96…`](https://stellar.expert/explorer/testnet/tx/721cfe96df6293511780eaed7523c6b4fdfb423c3bb4bff68fed06d288ada8be) |
| Rejected, wrong network: `Error(Contract, #2)` `WrongNetwork` | [`a7cce56b…`](https://stellar.expert/explorer/testnet/tx/a7cce56bbe2df01abfe6bfe287fe1f282461a3893da34874b7fe65b5774c1b0d) |
| Rejected, non-admin write: `Error(Contract, #3)` `NotAdmin` | [`f2c1ae3b…`](https://stellar.expert/explorer/testnet/tx/f2c1ae3bd009a8f066c671e206f13289c72cb9093e9ad99a1f2cb5b56cedae12) |
| Verification simulation: `settle_signed` at zero, in enforcing mode | a simulation, so no transaction: case `valid-verifies` in [`conformance/RESULTS.md`](conformance/RESULTS.md) |
| Settlement with refund: 0.2 of a 0.5 USDC cap paid, 0.3 refunded | [`6af2aa56…`](https://stellar.expert/explorer/testnet/tx/6af2aa56a1387c403e9341273d99353e2137e4553e1a1e458bf729c2ed30b6bd) |
| Metered settlement below the cap: 35 tokens, 0.0035 of a 0.05 USDC cap, 0.0465 returned | [`1630e707…`](https://stellar.expert/explorer/testnet/tx/1630e707676f99119fa516ae7a7112d266528eafaebb7f7efa5fba7b4dbb2128) |

Every other transaction is in the [on-chain record](#on-chain-record).

## Success criteria

| Criterion | Status |
|---|---|
| Registry deployed, contract ID in the README | done: [`CAC3XLU6…DVF46`](#deployments) |
| A resolution call returns the canonical deployment, visible in an explorer | done: [evidence](#evidence) |
| All three negative cases fail as specified, each with a published hash | done: [evidence](#evidence), codes decoded the same day in [`contracts/registry`](contracts/registry#evidence) |
| Test suite and resource profile committed, CI green | done: 13 registry tests, [resource profile](contracts/registry#resource-profile) |
| Verification returns the correct reason for every malformed payload | done: 27 verify cases in [`conformance/RESULTS.md`](conformance/RESULTS.md) |
| Settlement returns a hash on success and the mapped reason on each error | done: 7 settle cases, same file |
| A payload failing the registry check is refused | done: case `contract-not-canonical` |
| The conformance runner reports every case passing against testnet | done: 34 / 34 |
| Client package published at v0.1.0 with types, tests and README | done: [`@codekaya/x402-upto-stellar@0.1.0`](https://www.npmjs.com/package/@codekaya/x402-upto-stellar), 45 tests |
| The metered service completes a cycle below the cap, hash published | done: [evidence](#evidence) |

## Why a contract is needed

SEP-41 allowances cannot express `upto` safely:

| Requirement | With a bare SEP-41 allowance |
|---|---|
| Funds reach only the agreed recipient | An allowance names a *spender*, not a destination, so the spender can send anywhere |
| One authorization settles exactly once | An allowance stays drainable up to its limit until explicitly reduced |
| Payer and server provably agreed on terms | An allowance carries no commitment to what was purchased |

The contract supplies all three: recipient binding, single settlement, and
replay protection, on top of any SEP-41 token.

## Two settlement paths

Both share one payload type and one id derivation,
`sha256("x402-upto-stellar-v1" ‖ xdr(contract) ‖ xdr(authorization))`.

**One-shot**, the HTTP flow. The payer signs the payload offline, it travels in
the `PAYMENT-SIGNATURE` header, and a facilitator submits the only transaction. Escrow
and payout happen atomically, leaving no contract balance behind.

```
settle_signed(authorization, settled)
```

The payer's signature covers the payload but deliberately **not** the settled
amount, which is what keeps one signature valid for any outcome within the cap.

**Session**, escrow now and settle later. Suits an agent making many metered
calls against one budget.

```
lock(authorization) -> id     # payer escrows the cap
settle(id, settled)           # settler pays out and refunds the remainder
reclaim(id)                   # permissionless, after the window closes
```

`reclaim` is permissionless on purpose: the funds can only go back to the payer,
so the payer never depends on a cooperative counterparty.

## Layout

```
contracts/upto/          settlement contract: settle_signed, lock / settle / reclaim (27 tests)
contracts/registry/      discovery registry: canonical deployment per token, network-checked (13 tests)
packages/x402-upto-stellar/
  src/upto/client/       SchemeNetworkClient: builds and signs the payment
  src/upto/server/       SchemeNetworkServer: prices and requirements
  src/upto/facilitator/  SchemeNetworkFacilitator: 26-step verify, settle
  src/shared/            encoding, chain reads, reasons and error attribution
  test/                  45 offline tests
conformance/             vectors.json, run.ts, RESULTS.md
examples/metered-service/ server.ts (402 proxy in front of Ollama), agent.ts (pays it)
scripts/                 registry-evidence.ts: lands the three refusals, measures resources
specs/                   the scheme specification
spikes/                  the three pre-build spikes and their findings
```

## Getting started

Contracts need Rust 1.85+ and the `wasm32v1-none` target; the TypeScript side
needs Node 20+.

```bash
make check                 # contracts: fmt, clippy -D warnings, tests
npm install && npm test    # package: 45 offline tests
npx tsx conformance/run.ts # 34 conformance cases against testnet, writes RESULTS.md
```

The metered demo needs a local model:

```bash
brew install ollama && ollama serve &
ollama pull qwen2.5:0.5b
npm run build
npx tsx examples/metered-service/server.ts   # terminal 1
npx tsx examples/metered-service/agent.ts    # terminal 2
```

## Deployments

| Contract | Network | Address | Deployed |
|---|---|---|---|
| Settlement (`upto`) | Testnet | [`CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB`](https://stellar.expert/explorer/testnet/contract/CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB) | [tx](https://stellar.expert/explorer/testnet/tx/c838a72ac74fad5735f1807ad0ee1761143f6faad0fb76f29ec9d3eaa2920a5e) |
| Registry | Testnet | [`CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46`](https://stellar.expert/explorer/testnet/contract/CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46) | [tx](https://stellar.expert/explorer/testnet/tx/486a485e177f44dd532cfa9798ef7756d131f9bcb81f2d2300e2e1e30333dd1a) |

Read the live interface with
`stellar contract info interface --id CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB --network testnet`.

## On-chain record

Every testnet transaction this project produces, appended the day it lands.

| Date | What | Tx |
|---|---|---|
| 2026-10-09 | Settlement contract deployed | [`c838a72a…`](https://stellar.expert/explorer/testnet/tx/c838a72ac74fad5735f1807ad0ee1761143f6faad0fb76f29ec9d3eaa2920a5e) |
| 2026-10-20 | Spike 1: `settle_signed`, payer signed offline, settler submitted; 2 of 5 XLM paid, 3 refunded. Also restored the archived instance and wasm | [`a8917bfe…`](https://stellar.expert/explorer/testnet/tx/a8917bfeb6b77cef1b028c56ebef743ac39193d5bfa7bdbfaeec8e7d189d2399) |
| 2026-10-20 | Spike 1 again, contract warm: same split, 0.0029 XLM fee | [`2380de64…`](https://stellar.expert/explorer/testnet/tx/2380de648f78d01b16ca5b98a6623d3cb88c918d48718b3542f7d76ca290e6a1) |
| 2026-10-20 | Settlement contract instance TTL extended to ledger 8,403,997 (about April 2027) | [`97f17dc2…`](https://stellar.expert/explorer/testnet/tx/97f17dc29f71e265a9ad6a7eb869abdf6ce5f5d05dfd2da4e385afb207696c2c) |
| 2026-10-20 | Settlement contract wasm TTL extended to ledger 8,404,001 | [`4a07b4b1…`](https://stellar.expert/explorer/testnet/tx/4a07b4b1c3476586886668a6c7c87592f4d72d9550ecde742a040fac2524def3) |
| 2026-10-20 | Spike 2: network-id probe wasm uploaded | [`492a7684…`](https://stellar.expert/explorer/testnet/tx/492a76846ac352edacb721118323304d84fe88105d86f85e331f7211df3e7094) |
| 2026-10-20 | Spike 2: probe deployed as `CAEZC6F4DKZJU5IEOLBQ5XKQWGCNZA6U45KHPKEDKPB35UF3DJCK4WMX` | [`078a7a46…`](https://stellar.expert/explorer/testnet/tx/078a7a46ab1e536178f56544867f3be4251ac6b43695e3e8d904d9674bbdc7b3) |
| 2026-10-20 | Spike 2: refusal landed on-chain, `require_network(pubnet id)` failed with `Error(Contract, #1)` | [`3ef1d4ba…`](https://stellar.expert/explorer/testnet/tx/3ef1d4baaa0d0ed0dc50cc662a444a5a1cd8a630755728baf3f768814d323c0c) |
| 2026-10-20 | Spike 3 setup: payer USDC trustline and 100 XLM → USDC on the DEX | [`8a4367ff…`](https://stellar.expert/explorer/testnet/tx/8a4367ff4526baf56de47897f5e9d7b1d21d1313c62964369ea3659859b395bf) |
| 2026-10-20 | Spike 3 setup: payee USDC trustline | [`ea7520fc…`](https://stellar.expert/explorer/testnet/tx/ea7520fca72d7e94354a79ebc210bd08c30227bd5defc0f80e29bd9c9dca78bd) |
| 2026-10-20 | Spike 3: `settle_signed` on testnet USDC, 2 of 5 paid, 3 refunded; created the contract's USDC balance entry | [`4df50792…`](https://stellar.expert/explorer/testnet/tx/4df50792a16a6f778c814e25e17d5b5b6df28adc6bb404d4524d733040c1ca83) |
| 2026-10-20 | Spike 3 setup: second payer USDC trustline and purchase | [`73458e38…`](https://stellar.expert/explorer/testnet/tx/73458e3800cd8b210201fdbaecb9eced648c29a04e13426234745c29f8040287) |
| 2026-10-20 | Spike 3 setup: second payee USDC trustline | [`ff395aed…`](https://stellar.expert/explorer/testnet/tx/ff395aedb6f78fdbef6c2d87a8caf9406bb881ff99bdaf840f9aefd021dc46f0) |
| 2026-10-20 | Spike 3: `settle_signed` on testnet USDC, warm, 0.003 XLM fee | [`bc2b0093…`](https://stellar.expert/explorer/testnet/tx/bc2b00938a8670cba8b6be61b6da45fe672e08a6f717f6a49792eeb4c76ba3b5) |
| 2026-10-20 | Spec rebase check: payer USDC setup for the payee-receivability simulations (run aborted on a script error, simulations only) | [`da76022e…`](https://stellar.expert/explorer/testnet/tx/da76022ec7c71f5f53d42f5be717b18bfa852d8b800b53d8bffd7b7fa6fdd192) |
| 2026-10-20 | Spec rebase check: payer USDC setup; the simulations showed a payee without a trustline passes the zero simulation and fails every positive amount with the token's `TrustlineMissing` | [`17a7ebfc…`](https://stellar.expert/explorer/testnet/tx/17a7ebfc2dfcbcc0ae5de7807f4924b9bdc2c8e50ddeee0bf6723e58769f64cb) |
| 2026-10-20 | D1: registry wasm uploaded | [`52423b31…`](https://stellar.expert/explorer/testnet/tx/52423b31752c2c879d763af90f03f16501848c5672c5c50f933cf9954d5df2e2) |
| 2026-10-20 | D1: registry deployed as `CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46` | [`486a485e…`](https://stellar.expert/explorer/testnet/tx/486a485e177f44dd532cfa9798ef7756d131f9bcb81f2d2300e2e1e30333dd1a) |
| 2026-10-20 | D1 **registration**: USDC → upto, for testnet | [`f580528c…`](https://stellar.expert/explorer/testnet/tx/f580528c3a602e4a7511bcfe35fc516dd72e81726a28e76d91f823514272fdd0) |
| 2026-10-20 | D1 **resolution**: `resolve(USDC)` returned `CCDHT7LJ…VVXQB` | [`3d9be975…`](https://stellar.expert/explorer/testnet/tx/3d9be975a26ec1b088c35dadf71d4909bf7d5ca0a890d143128f3109ca446972) |
| 2026-10-20 | D1 setup: XLM registered under the pubnet id | [`29c2a441…`](https://stellar.expert/explorer/testnet/tx/29c2a441556cac5f8db8e47101dea33873e52f3d4889618996345ffcea22947a) |
| 2026-10-20 | D1 **rejected, unregistered token**: failed with `Error(Contract, #1)` `NotRegistered` | [`721cfe96…`](https://stellar.expert/explorer/testnet/tx/721cfe96df6293511780eaed7523c6b4fdfb423c3bb4bff68fed06d288ada8be) |
| 2026-10-20 | D1 **rejected, wrong network**: failed with `Error(Contract, #2)` `WrongNetwork` | [`a7cce56b…`](https://stellar.expert/explorer/testnet/tx/a7cce56bbe2df01abfe6bfe287fe1f282461a3893da34874b7fe65b5774c1b0d) |
| 2026-10-20 | D1 **rejected, non-admin write**: failed with `Error(Contract, #3)` `NotAdmin` | [`f2c1ae3b…`](https://stellar.expert/explorer/testnet/tx/f2c1ae3bd009a8f066c671e206f13289c72cb9093e9ad99a1f2cb5b56cedae12) |
| 2026-10-20 | D2 conformance run 1 (33/34): `settle-below-cap`, 0.2 of 0.5 USDC paid, 0.3 refunded | [`55a5884d…`](https://stellar.expert/explorer/testnet/tx/55a5884db7a7a3169396de2c190255a48531412e2e8e649becf63f0c15053523) |
| 2026-10-20 | D2 conformance run 1: `settle-zero-burns` | [`e80fb0c1…`](https://stellar.expert/explorer/testnet/tx/e80fb0c19fd8b18872c59f9eaadbc76f7015ae0727c4c7bd17de7141d313819d) |
| 2026-10-20 | D2 conformance run 1: `settle-same-amount-again` | [`7b6b8862…`](https://stellar.expert/explorer/testnet/tx/7b6b8862bd7e5a419cbd1eff8885c08efab4757826c86d492f8d3f2b8121f625) |
| 2026-10-20 | D2 conformance run 1: `settle-other-amount-again`, first settlement | [`cb662c2a…`](https://stellar.expert/explorer/testnet/tx/cb662c2a14f07faff1568cd9b57e02d97f0158d19af443b1e2cbe11dfbb2ccd5) |
| 2026-10-20 | D2 conformance run 1: `settle-replayed-elsewhere`, first settlement | [`08506b28…`](https://stellar.expert/explorer/testnet/tx/08506b28359c396c6d0bd0e0bcd0da79f09b5795bd3b36563ee66f70fe8477c9) |
| 2026-10-20 | D2 conformance run 2 setup: payer USDC trustline and DEX purchase | [`023d6f0c…`](https://stellar.expert/explorer/testnet/tx/023d6f0c029a603b35578323f831df0961ada1d6ac56dd98771aacc6b8e6115d) |
| 2026-10-20 | D2 conformance run 2 setup: payee USDC trustline | [`51598706…`](https://stellar.expert/explorer/testnet/tx/515987060eb59606ba3d11313ce7b7c3b1845b79c7751fe86caf578b3c8a4e98) |
| 2026-10-20 | D2 conformance run 2 (34/34) **settlement with refund**: `settle-below-cap`, 0.2 of 0.5 USDC paid, 0.3 refunded | [`6af2aa56…`](https://stellar.expert/explorer/testnet/tx/6af2aa56a1387c403e9341273d99353e2137e4553e1a1e458bf729c2ed30b6bd) |
| 2026-10-20 | D2 conformance run 2: `settle-zero-burns`, authorization burned at zero | [`7e0e075c…`](https://stellar.expert/explorer/testnet/tx/7e0e075c2a9ef342c8278bb7210fe36ff3feafb8d89659c3a703f2fec53e6aeb) |
| 2026-10-20 | D2 conformance run 2: `settle-same-amount-again`, second call returned this same hash | [`f35f9580…`](https://stellar.expert/explorer/testnet/tx/f35f9580dad2440e25baab71dea148aa6cea16af8b13411766823de26911cba4) |
| 2026-10-20 | D2 conformance run 2: `settle-other-amount-again`, first settlement; the retry was refused | [`d6685860…`](https://stellar.expert/explorer/testnet/tx/d6685860259aebab6a1defc08c3d2ca87a4e8ac46d21179ca991cf976fa09c3c) |
| 2026-10-20 | D2 conformance run 2: `settle-replayed-elsewhere`, first settlement; the replay was refused | [`3c1afdc2…`](https://stellar.expert/explorer/testnet/tx/3c1afdc21162532ccb103ecca9a171d257e2881c0300ca05d16b51805d57f1f7) |
| 2026-10-20 | D3 setup: metered service payee USDC trustline | [`a56e0932…`](https://stellar.expert/explorer/testnet/tx/a56e09325370c2fd1af0a85777d748f9af427c7e2b32f70ef906c458d95abd41) |
| 2026-10-20 | D3 setup: agent payer USDC trustline and DEX purchase | [`7551be20…`](https://stellar.expert/explorer/testnet/tx/7551be208417de26646b452c5dbfc9f33f8bbf2533f7040d401a151c33171a8c) |
| 2026-10-20 | D3 **metered settlement below the cap**: 35 tokens of qwen2.5:0.5b, 0.0035 of a 0.05 USDC cap, 0.0465 returned | [`1630e707…`](https://stellar.expert/explorer/testnet/tx/1630e707676f99119fa516ae7a7112d266528eafaebb7f7efa5fba7b4dbb2128) |

Not logged: the setup transactions (throwaway accounts' USDC trustlines and DEX
purchases) of conformance run 1 and of one single-case debugging run, both on
20 October. They move no funds of this project and settle nothing.

## Status

All three deliverables are built and evidenced on testnet. The settlement
contract predates them and is a dependency. Open questions for the x402 TSC
are listed at the end of the specification. Not audited. Testnet only.

## License

Apache-2.0, matching `@x402/stellar`, so the spec and the reference
implementation can be contributed upstream without a licence conflict.
