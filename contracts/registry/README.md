# `upto` discovery registry

A Soroban contract that answers one question: **for this token, which `upto`
deployment is canonical on this network?**

Without it, "pay this contract" is an instruction from the party being paid:
the resource server writes `extra.contract` into its own `402` response, and a
substituted address is a stolen payment that no client can detect. Clients and
facilitators resolve the token here and refuse any other address.

The registry advises; it does not gate. The escrow contract never reads it, so
it cannot block a settlement that is already authorized. It stores address
records only, never funds.

## Deployment

| Network | Contract | Admin |
|---|---|---|
| Testnet | [`CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46`](https://stellar.expert/explorer/testnet/contract/CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46) | `GAL26X6L2267AGMQ7JL647JDVTWPUV7BJ4U4VVQ7N3IY7NKLUZJXWPM6` |

| Token | Resolves to | Registered for |
|---|---|---|
| USDC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB` | testnet |
| XLM `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | `CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB` | pubnet, on purpose: the wrong-network case |

## Interface

```rust
fn __constructor(admin: Address);

fn register(caller: Address, token: Address, deployment: Address, network_id: BytesN<32>) -> Result<(), Error>;
fn unregister(caller: Address, token: Address) -> Result<(), Error>;
fn set_admin(caller: Address, admin: Address) -> Result<(), Error>;

fn resolve(token: Address) -> Result<Address, Error>;
fn record(token: Address) -> Option<Record>;   // raw, without the network check
fn admin() -> Address;
```

`network_id` is the SHA-256 of the network passphrase the deployment belongs
to: `cee0302d…28ecd472` for testnet, `7ac33997…1045a979` for pubnet. It is
supplied rather than read from the ledger, so a record is an explicit claim the
admin makes, and `resolve` checks that claim against `env.ledger().network_id()`.
A record stamped with the ledger's own id could never be on the wrong network,
and the check would be untestable.

## Errors

One per refusal reason:

| Code | Error | When |
|---|---|---|
| 1 | `NotRegistered` | `resolve` or `unregister` on a token with no record |
| 2 | `WrongNetwork` | `resolve` on a record registered for another network |
| 3 | `NotAdmin` | a write whose `caller` is not the admin |

Writes take the caller explicitly and call `caller.require_auth()` before
comparing it with the stored admin. A stranger can always authorize their own
address, so a non-admin write ends in the typed `NotAdmin` rather than an
opaque host authorization failure.

## Events

| Topics | Data | Emitted by |
|---|---|---|
| `registry`, `registered`, token | `deployment`, `network_id`, `previous` | every `register`; `previous` is `None` on first registration and the replaced deployment on a change |
| `registry`, `unregistered`, token | `deployment` | `unregister` |
| `registry`, `admin_changed` | `previous`, `admin` | `set_admin` |

## TTL

Records are persistent. Every `register` and every successful `resolve`
extends the record and the instance to 30 days whenever they have fallen below
7 days. A registry that is read at least monthly never archives; one that goes
quiet longer is restored automatically by the next transaction that touches it,
at a higher fee.

## Key policy

- The admin is a single testnet key, `upto-deployer`, held in the Stellar CLI
  keystore on hardware the builder owns. It is never committed.
- It can register, replace and remove records, and nothing else. It cannot
  touch funds: the registry holds none and the escrow contract never reads it.
- Rotation is `set_admin`, which requires the current admin and emits
  `admin_changed`.
- A compromised admin can point a token at a hostile deployment. Clients that
  pin `extra.contract` themselves are unaffected, and every change is a public
  event, so the exposure is visible. A mainnet registry would put the admin
  behind a multisig account; this sprint is testnet only.

## Resource profile

Simulated on testnet on 20 October 2026:

| Call | Instructions | Disk read | Write | Footprint | Resource fee |
|---|---|---|---|---|---|
| `register`, new token | 598,302 | 0 B | 288 B | 2 read-only, 1 read-write | 1,148,735 stroops, mostly 30 days of rent for the new record |
| `resolve` | 520,781 | 0 B | 0 B | 3 read-only | 6,750 stroops |

Measured by [`scripts/registry-evidence.ts`](../../scripts/registry-evidence.ts).

## Evidence

Every hash below was produced on 20 October 2026, with its error decoded from
RPC the same day.

| What | Outcome | Tx |
|---|---|---|
| Wasm upload | success | [`52423b31…`](https://stellar.expert/explorer/testnet/tx/52423b31752c2c879d763af90f03f16501848c5672c5c50f933cf9954d5df2e2) |
| Deploy, admin set by the constructor | success | [`486a485e…`](https://stellar.expert/explorer/testnet/tx/486a485e177f44dd532cfa9798ef7756d131f9bcb81f2d2300e2e1e30333dd1a) |
| Registration: USDC → upto, testnet | success, `registered` event | [`f580528c…`](https://stellar.expert/explorer/testnet/tx/f580528c3a602e4a7511bcfe35fc516dd72e81726a28e76d91f823514272fdd0) |
| Resolution: `resolve(USDC)` | returns `CCDHT7LJ…VVXQB` | [`3d9be975…`](https://stellar.expert/explorer/testnet/tx/3d9be975a26ec1b088c35dadf71d4909bf7d5ca0a890d143128f3109ca446972) |
| Setup: XLM registered under the pubnet id | success | [`29c2a441…`](https://stellar.expert/explorer/testnet/tx/29c2a441556cac5f8db8e47101dea33873e52f3d4889618996345ffcea22947a) |
| Rejected: unregistered token | failed, `Error(Contract, #1)` `NotRegistered` | [`721cfe96…`](https://stellar.expert/explorer/testnet/tx/721cfe96df6293511780eaed7523c6b4fdfb423c3bb4bff68fed06d288ada8be) |
| Rejected: wrong network | failed, `Error(Contract, #2)` `WrongNetwork` | [`a7cce56b…`](https://stellar.expert/explorer/testnet/tx/a7cce56bbe2df01abfe6bfe287fe1f282461a3893da34874b7fe65b5774c1b0d) |
| Rejected: non-admin write | failed, `Error(Contract, #3)` `NotAdmin` | [`f2c1ae3b…`](https://stellar.expert/explorer/testnet/tx/f2c1ae3bd009a8f066c671e206f13289c72cb9093e9ad99a1f2cb5b56cedae12) |

The explorer shows a refused transaction as "Failed" without the code; the
code column above is what RPC reported for each.

## Tests

`cargo test -p x402-upto-registry`: 13 tests, covering the three refusals,
caller authorization, a forged admin write, replacement, events, removal,
admin rotation and TTL.
