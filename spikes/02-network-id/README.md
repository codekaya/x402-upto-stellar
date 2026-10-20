# Spike 2: the network identity inside a contract

**Result: works. `env.ledger().network_id()` is the right key; no fallback to
an explicit network tag is needed.** Run on 20 October 2026 on testnet with
soroban-sdk 27.0.6.

## The question

Can a contract read the network it runs on, so that a registry record admitted
for one network refuses to resolve on another? And since every negative case
in the award needs a published transaction hash, can a refusal be landed
on-chain at all, given that a failing simulation returns no footprint?

## What was built

A throwaway probe, deliberately not the registry, which is sprint work:

- [`probe/`](probe/src/lib.rs), a contract with two functions:
  `network_id()` returns what the host reports, and
  `require_network(expected)` fails with a typed `WrongNetwork` error when
  `expected` is not that id. It has its own Cargo workspace so CI and the
  deliverables are untouched.
- [`spike.ts`](spike.ts) reads the id on testnet, compares it with both
  passphrase hashes, and submits a refusing call as a real transaction.

```bash
cd probe && cargo test          # the id follows the ledger in the emulator
cd .. && npm install && npm run spike
```

## Checks, all passing

| Check | Outcome |
|---|---|
| `network_id()` on testnet | `cee0302d…28ecd472` |
| equals `sha256("Test SDF Network ; September 2015")` | yes |
| differs from `sha256("Public Global Stellar Network ; September 2015")` = `7ac33997…1045a979` | yes |
| `require_network(testnet id)` | succeeds |
| `require_network(pubnet id)` | `Error(Contract, #1)` |
| Refusal submitted as a transaction | accepted, landed as `txFailed`, 1,699 stroops |
| The failure is the typed error, not a resource limit | diagnostic event carries `contractCode: 1` |

## Transactions

| Date | What | Tx |
|---|---|---|
| 2026-10-20 | Probe wasm uploaded | [`492a7684…`](https://stellar.expert/explorer/testnet/tx/492a76846ac352edacb721118323304d84fe88105d86f85e331f7211df3e7094) |
| 2026-10-20 | Probe deployed as `CAEZC6F4DKZJU5IEOLBQ5XKQWGCNZA6U45KHPKEDKPB35UF3DJCK4WMX` | [`078a7a46…`](https://stellar.expert/explorer/testnet/tx/078a7a46ab1e536178f56544867f3be4251ac6b43695e3e8d904d9674bbdc7b3) |
| 2026-10-20 | `require_network(pubnet id)` refused on testnet, `WrongNetwork` | [`3ef1d4ba…`](https://stellar.expert/explorer/testnet/tx/3ef1d4baaa0d0ed0dc50cc662a444a5a1cd8a630755728baf3f768814d323c0c) |

## Findings that shape Deliverable 1

**1. The record must carry the network it is for, supplied at registration.**
A contract only ever executes on one network, so a registry that stamps each
record with the ledger's own id can never hold a record for another network,
and the second negative case ("a record registered under another network id
does not resolve") could never be produced. `register` therefore takes the
network id the deployment is meant for, and `resolve` compares it with
`env.ledger().network_id()` and refuses with its own typed error on mismatch.
Keying records by token alone, with the network id as a field, keeps
"not registered" and "wrong network" distinguishable, which the award requires
as one error per refusal reason.

**2. Refusals have to be submitted with a borrowed footprint.** A failing
simulation returns no transaction data, so neither the CLI nor
`assembleTransaction` will send it. The working technique: simulate a
succeeding call on the same contract, reuse its footprint with headroom on
instructions and resource fee, and submit the failing call. It lands as a
failed transaction with a hash, for under 0.0002 XLM. Headroom matters: too
little and the transaction fails on a resource limit instead of the specified
error, so the check has to read the error, not only the failed status.

**3. The explorer shows "Failed", not which error.** stellar.expert lists the
status, the function and its arguments, but not the contract error code. The
code is in the diagnostic events that RPC returns, and testnet RPC keeps
history for 120,960 ledgers, seven days. So each negative-case hash has to be
paired with its decoded error in the README on the day it lands; a week later
the public RPC can no longer show it.

**4. Testnet resets do not change the id.** The id is the passphrase hash, and
resets keep the passphrase, so records stay correctly keyed; only the state is
wiped. A reset during the sprint would mean redeploying, not rekeying.
