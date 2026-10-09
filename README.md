# x402 `upto` for Stellar

A Soroban contract and a scheme specification that let a client pay for a
metered service with an enforced spending cap.

The `exact` x402 scheme covers payments whose price is known before the request
is served. Metered services break that assumption: an agent calling an inference
endpoint knows its budget, not its bill. The `upto` scheme closes the gap.
Authorize a ceiling, settle the actual usage, refund the difference. It has EVM
and SVM specifications; this repository supplies the Stellar one.

- **Spec draft:** [`specs/scheme_upto_stellar.md`](specs/scheme_upto_stellar.md), written for upstream review
- **Reference implementation:** [`contracts/upto`](contracts/upto)

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
the `X-PAYMENT` header, and a facilitator submits the only transaction. Escrow
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
contracts/upto/src/
  lib.rs       contract entry points and payload validation
  types.rs     UptoAuthorization, Lock, Settlement
  error.rs     contract error codes
  storage.rs   replay markers (temporary) and escrows (persistent), with TTLs
  events.rs    Locked / Settled / Reclaimed
  test.rs      27 tests: settlement paths, validation, authorization binding
specs/
  scheme_upto_stellar.md   the scheme draft intended for upstream
```

## Getting started

Requires Rust 1.85+ and the `wasm32v1-none` target. The Stellar CLI is only
needed for deployment, and `optimize` and `deploy` need stellar-cli 23 or newer.

```bash
rustup target add wasm32v1-none
make test      # contract tests in the Soroban host emulator, no network needed
make build     # release wasm
make check     # fmt + clippy -D warnings + tests
```

Deploying to testnet. The contract takes no constructor arguments and has no
admin: it is permissionless infrastructure, so one deployment per network is
enough.

```bash
stellar keys generate --global deployer --network testnet --fund
make deploy NETWORK=testnet SOURCE=deployer
```

## Status

The settlement contract and its test suite are complete and green, and the
scheme draft is written for upstream review with its open questions listed at
the end of that document.

What is missing is everything around it. Nothing can discover which deployment
is canonical for a network, no facilitator implements verification or
settlement, no client builds and signs a payment, and there are no conformance
vectors for a second implementation to check itself against. That work is next.

Not audited. Testnet only.

## License

Apache-2.0, matching `@x402/stellar`, so the spec and the reference
implementation can be contributed upstream without a licence conflict.
