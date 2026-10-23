# @codekaya/x402-upto-stellar

The x402 `upto` payment scheme for Stellar: pay for a metered service with an
enforced spending cap. The client authorizes a ceiling, the server settles what
was actually used, and the rest goes back to the payer, in one Soroban
transaction.

Three entry points, mirroring `upto` in `@x402/evm` and `@x402/svm` and built on
`@x402/core` v2 and the signer types of `@x402/stellar`:

| Import | Implements | Role |
|---|---|---|
| `@codekaya/x402-upto-stellar/upto/client` | `SchemeNetworkClient` | builds the authorization and signs the payer's Soroban auth entry |
| `@codekaya/x402-upto-stellar/upto/server` | `SchemeNetworkServer` | prices in USDC, adds the escrow contract and facilitator address to the requirements |
| `@codekaya/x402-upto-stellar/upto/facilitator` | `SchemeNetworkFacilitator` | verifies in 26 cheapest-first checks, settles as the transaction source |

**Testnet only. Not audited.**

## Install

```bash
npm install @codekaya/x402-upto-stellar @x402/core @x402/stellar
```

## Client

Any wallet that implements `signAuthEntry` works, since the client takes the
same `ClientStellarSigner` as `exact`.

```ts
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { createEd25519Signer } from "@x402/stellar";
import { UptoStellarScheme } from "@codekaya/x402-upto-stellar/upto/client";

const client = new x402Client().register("stellar:*", new UptoStellarScheme(createEd25519Signer(secret, "stellar:testnet")));

const unpaid = await fetch(url, { method: "POST", body });
const payment = await client.createPaymentPayload(decodePaymentRequiredHeader(unpaid.headers.get("PAYMENT-REQUIRED")!));
const paid = await fetch(url, { method: "POST", body, headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) } });
```

The payer signs the payload and the cap, never the settled amount, and never
submits a transaction. Before signing, the client checks `extra.contract`
against the on-chain registry and refuses any other escrow address.

## Server

```ts
import { UptoStellarScheme as UptoServer } from "@codekaya/x402-upto-stellar/upto/server";

const scheme = new UptoServer();
const { asset, amount } = await scheme.parsePrice("$0.05", "stellar:testnet"); // the cap
const requirements = await scheme.enhancePaymentRequirements(
  { scheme: "upto", network: "stellar:testnet", asset, amount, payTo, maxTimeoutSeconds: 300, extra: {} },
  { x402Version: 2, scheme: "upto", network: "stellar:testnet", extra: facilitator.getExtra("stellar:testnet") },
  [],
);
```

After serving, settle for what was used: `requirements.amount` set to the
metered amount, never more than the cap.

## Facilitator

```ts
import { createEd25519Signer } from "@x402/stellar";
import { UptoStellarScheme as UptoFacilitator } from "@codekaya/x402-upto-stellar/upto/facilitator";

const facilitator = new UptoFacilitator([createEd25519Signer(facilitatorSecret, "stellar:testnet")]);

const verified = await facilitator.verify(payment, requirements);
// ... serve, meter ...
const settlement = await facilitator.settle(payment, { ...requirements, amount: used.toString() });
// settlement.transaction is the hash, settlement.amount the settled amount
```

Options: `rpcUrl`, `registry` (an address, or `false` to skip the canonical
check), `maxTransactionFeeStroops` (default 1,000,000, i.e. 0.1 XLM), `inclusionFeeStroops`,
`registryCacheSeconds`.

Behaviour worth knowing:

- **Verification ends in a simulated `settle_signed` at zero**, in enforcing
  auth mode, after checking that the payer can fund the cap and the payee can
  receive the asset.
- **A settlement of zero is submitted**, which burns the authorization.
- **An authorization is never resubmitted.** Settling it again for the same
  amount returns the first transaction; for another amount it is refused.
- **Contract errors are attributed to the contract that raised them**, since the
  escrow and the token share one error-code space.

Every refusal reason is exported as `Reason` from the package root, and listed
with its check in the [scheme specification](https://github.com/codekaya/x402-upto-stellar/blob/main/specs/scheme_upto_stellar.md).

## Deployments

| Network | Escrow contract | Registry |
|---|---|---|
| `stellar:testnet` | `CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB` | `CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46` |

The settlement asset on testnet is Circle's USDC,
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

## Conformance

A second implementation can check itself against the
[conformance vectors](https://github.com/codekaya/x402-upto-stellar/tree/main/conformance):
34 cases, each a single change to a valid payment, with the expected outcome.
This package passes all 34 against testnet.

## License

Apache-2.0
