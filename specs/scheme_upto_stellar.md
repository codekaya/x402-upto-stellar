# `upto` scheme — Stellar

**Status:** draft · **Scheme:** `upto` · **x402 version:** 2 · **Networks:** `stellar:pubnet`, `stellar:testnet`
**Reference implementation:** [`contracts/upto`](../contracts/upto) (Apache-2.0)

## Abstract

The `exact` scheme covers payments whose price is known before the request is
served. Metered services break that assumption: an agent calling an inference
endpoint knows its budget, not its bill. `upto` closes the gap — the client
authorizes a ceiling, the resource server settles what was actually consumed,
and the difference returns to the client.

This document specifies `upto` on Stellar for x402 version 2. It is the
Stellar counterpart to `upto` on EVM and SVM, which `@x402/evm` and `@x402/svm`
ship as `upto/client`, `upto/server` and `upto/facilitator`, and it follows
their conventions wherever Stellar allows, so facilitators can treat the
networks uniformly at the HTTP layer. Where Stellar differs, the difference is
named in [Differences from `upto` on EVM](#differences-from-upto-on-evm).

## Motivation: why a contract is required

On EVM, `upto` is expressed with a signed Permit2 authorization that a
facilitator redeems for an amount at or below the signed maximum. Stellar has no
equivalent primitive at the token layer. SEP-41 offers `approve`, and it is
insufficient on three counts:

1. **No recipient binding.** An allowance names a *spender*, not a destination.
   The spender may call `transfer_from` toward any address, so a compromised or
   dishonest facilitator can redirect a client's funds.
2. **No single-settlement guarantee.** An allowance remains drainable up to its
   limit until it is explicitly reduced. Nothing confines one authorization to
   one settlement, which is exactly the property a metered payment needs.
3. **No binding to the paid-for resource.** An allowance carries no commitment
   to *what* was purchased, so a client and a server cannot prove they agreed on
   the same payment requirements.

A Soroban contract supplies all three. The remainder of this document defines
the payload, the contract interface, and the facilitator behaviour that together
constitute the scheme.

## Terminology

| Term | Meaning |
|---|---|
| payer | Account funding the payment. The x402 client. |
| payee | Sole account that may receive settled funds. `payTo`. |
| facilitator | Submits settlement and pays its fee. Its address is the `settler` the payer authorizes. |
| escrow contract | The `upto` contract deployment named in `extra.contract`. |
| cap | The `amount` of the accepted requirements: the most the payer can be charged. |
| settled amount | What the resource server charges after serving, `0` to the cap. |
| authorization id | `sha256(domain ‖ contract ‖ payload)`, the scheme's unique handle for one authorization. |
| registry | A contract that names the canonical escrow deployment per network and token. |

All amounts are in the asset's atomic units, as decimal strings.

## Payment requirements

A resource server answers an unpaid request with `402` and a `PAYMENT-REQUIRED`
header carrying base64-encoded JSON. For `upto`, `amount` is the cap the client
is asked to authorize, not the price.

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/v1/completions",
    "description": "Metered inference, billed per output token",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "upto",
      "network": "stellar:testnet",
      "amount": "5000000",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payTo": "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      "maxTimeoutSeconds": 600,
      "extra": {
        "contract": "CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB",
        "facilitatorAddress": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        "areFeesSponsored": true
      }
    }
  ]
}
```

`extra` is mandatory for this scheme:

- **`contract`** — the escrow contract the payer must authorize against. The
  authorization id is bound to this address. Clients should check it against
  the registry; see [Discovery](#discovery).
- **`facilitatorAddress`** — the account that will submit settlement, which the
  payer binds as `settler`. The facilitator publishes it through its supported
  kinds (`getExtra`) and the resource server copies it into the requirements, as
  `upto` on EVM does. Clients must reject requirements without it.
- **`areFeesSponsored`** — always `true`. The facilitator is the source of the
  settlement transaction and pays its fee; the payer never submits anything.

## Discovery

Without discovery, "pay this contract" is an instruction from the party being
paid, and a substituted `extra.contract` is a stolen payment that no client can
detect. A registry contract on each network answers one question: for this
token, which `upto` deployment is canonical?

```
resolve(token: Address) -> Address
```

Each record carries the network id it was registered for, and `resolve`
compares it with `env.ledger().network_id()`, the SHA-256 of the network
passphrase. `resolve` refuses, with a distinct error for each, a token that was
never registered and a record registered for a different network.

- **Clients** should resolve `asset` and refuse requirements whose
  `extra.contract` differs from the result.
- **Facilitators** must refuse a payload whose `extra.contract` does not resolve
  for `asset` through the registry (`invalid_upto_stellar_contract_not_canonical`).

The registry advises; it does not gate. The escrow contract never reads it, so
it cannot block a settlement that is already authorized; a facilitator refusing
a non-canonical contract does so as policy, before any funds move. The registry
stores address records only, never funds, and its write path is admin-gated.
Registry addresses are published alongside the reference implementation.

## Payment payload

The client retries the request with a `PAYMENT-SIGNATURE` header carrying a
base64-encoded `PaymentPayload`:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/v1/completions",
    "description": "Metered inference, billed per output token",
    "mimeType": "application/json"
  },
  "accepted": { "scheme": "upto", "network": "stellar:testnet", "amount": "5000000", "...": "the accepts entry exactly as received" },
  "payload": {
    "authorization": {
      "payer": "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4",
      "payee": "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      "settler": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      "token": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "maxAmount": "5000000",
      "validAfter": "1792490222",
      "validBefore": "1792490882",
      "nonce": "9c1185a5c5e9fc54612808977ee8f548b2258d31ddadef4e1f1e2f0a1d4e4b7c",
      "resource": "4bf6e6dbd1f4b2a1c3d5e7f9a0b2c4d6e8fa0c1e3f5a7b9d1c3e5f7a9b0d2c4e"
    },
    "signature": "AAAAAQAAAAAAAAAA..."
  }
}
```

`resource` is required for `upto`, because the payload commits to it.

### `authorization`

Field names map one-to-one onto the contract's `UptoAuthorization` type, and
each is derived from the accepted requirements:

| Field | Value |
|---|---|
| `payer` | the client's address |
| `payee` | `accepted.payTo` |
| `settler` | `accepted.extra.facilitatorAddress` |
| `token` | `accepted.asset` |
| `maxAmount` | `accepted.amount` |
| `validAfter` | client time minus 60 seconds, to tolerate a lagging clock |
| `validBefore` | client time plus `accepted.maxTimeoutSeconds` |
| `nonce` | 32 random bytes |
| `resource` | the resource commitment, below |

`maxAmount`, `validAfter` and `validBefore` are decimal strings to survive
JSON's 53-bit integer limit; times are Unix seconds compared against ledger
close time. `nonce` and `resource` are 32-byte hex without a `0x` prefix.

### Resource commitment

```
resource = sha256( JCS({ "accepted": accepted, "url": resource.url }) )
```

`JCS` is the JSON Canonicalization Scheme, RFC 8785. The commitment covers the
requirements as the client accepted them, with `amount` still the cap, and the
URL being paid for. The contract does not interpret it; it guarantees payer and
settler agreed on the same value, which is what lets a dispute be resolved
against the advertised terms.

### `signature`

Base64 XDR of a `SorobanAuthorizationEntry` signed by the payer. This is where
Stellar diverges most from EVM, and the divergence is load-bearing: the entry
is a protocol-level object, so the payer's key never signs a raw
scheme-defined digest, and smart-contract accounts (passkey wallets,
policy-gated accounts implementing `__check_auth`) work with no scheme changes.
Clients sign through the `signAuthEntry` of a `ClientStellarSigner`, the same
signer `exact` uses, so wallets need no new code.

The credentials must be address credentials. All three forms are valid:
`SOROBAN_CREDENTIALS_ADDRESS`, `SOROBAN_CREDENTIALS_ADDRESS_V2` (CAP-71, the
default of recent SDKs, which binds the address into the signed payload) and
`SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES`. Facilitators must accept each;
the host verifies them all. Source-account credentials are never valid, since
the payer is not the transaction source.

The entry's invocation tree must be exactly:

```
root:  { contract: <extra.contract>, function: "settle_signed", args: [authorization] }
  └─   { contract: <asset>,          function: "transfer",      args: [payer, <extra.contract>, maxAmount] }
```

Two properties of this tree are what make `upto` work on Stellar:

- **The settled amount is absent from the root args.** The contract calls
  `require_auth_for_args` with the payload alone, so one signature stays valid
  for any outcome within the cap. Had the payer signed the real invocation args,
  the amount would have been fixed at signing time and the scheme would collapse
  into `exact`.
- **The nested transfer commits to `maxAmount`, and to the escrow contract as
  destination.** Only the cap is knowable when the payer signs, so the cap is
  what moves; the contract then splits it. The payee never appears in the
  transfer args, which is why the payload signature — not the transfer — is what
  binds the recipient.

Note the two independent nonces. `authorization.nonce` is scheme-level and feeds
the authorization id. The address credentials carry their own protocol-level
nonce and `signatureExpirationLedger`, enforced by the network. Clients set
`signatureExpirationLedger` to the current ledger plus
`ceil(maxTimeoutSeconds / ledger close time)`, as `exact` does, so an entry
cannot outlive the window it was written for.

## Authorization id

```
id = sha256( "x402-upto-stellar-v1" ‖ xdr(contract_address) ‖ xdr(authorization) )
```

`xdr(authorization)` is the XDR encoding of the Soroban map representation of
the payload, so the derivation is canonical without a separately specified
serialization. Including the contract address means an id has no meaning against
another deployment; the network passphrase is already covered by the signed
authorization entry. The domain string versions the contract's payload layout,
not the x402 protocol, and is unchanged by this rebase.

Clients and facilitators should obtain ids from the contract's
`authorization_id` view function rather than reimplementing the hash.

## Contract interface

```rust
fn authorization_id(authorization: UptoAuthorization) -> BytesN<32>;

// one-shot path — the HTTP flow
fn settle_signed(authorization: UptoAuthorization, settled: i128) -> Result<Settlement, Error>;

// session path — escrow now, settle later
fn lock(authorization: UptoAuthorization) -> Result<BytesN<32>, Error>;
fn settle(id: BytesN<32>, settled: i128) -> Result<Settlement, Error>;
fn reclaim(id: BytesN<32>) -> Result<i128, Error>;

// views
fn lock_of(id: BytesN<32>) -> Option<Lock>;
fn is_consumed(id: BytesN<32>) -> bool;
```

`settled = 0` is valid and means the payer is made whole: a metered call that
produced nothing owes nothing.

### One-shot path

Used for a single HTTP request. The payer never submits a transaction.

1. The client selects an `accepts` entry, builds the authorization, signs the
   entry, and retries with `PAYMENT-SIGNATURE`.
2. The resource server asks the facilitator to verify, then serves the request
   and measures usage.
3. The resource server asks the facilitator to settle with
   `requirements.amount` set to the measured usage.
4. The facilitator submits `settle_signed(authorization, settled)` as the
   transaction source, attaching the payer's signed entry and its own
   source-account authorization over the full call, amount included.
5. In one transaction the contract consumes the id, pulls `maxAmount` into
   escrow, pays `settled` to the payee, and refunds the remainder.
6. The resource server returns the response with a `PAYMENT-RESPONSE` header
   carrying the `SettleResponse`, whose `amount` is the settled amount.

The escrow round trip costs two extra token calls versus a direct transfer. That
is the price of never asking the payer to sign for more than a ceiling, and it
leaves no residue: the contract's balance returns to zero within the same
transaction. On testnet a warm `settle_signed` with a refund costs about
1.9 million instructions and 0.003 XLM in fees.

### Session path

Used when one budget covers many metered calls — the common shape for an agent
working through a task. It has no representation in the x402 request flow
yet; see the open questions.

1. Payer submits `lock(authorization)`, escrowing the cap. The resource server
   can now treat the budget as funded without trusting the payer to stay solvent.
2. Calls proceed against the id; the server meters cumulatively.
3. Settler submits `settle(id, total)` before `validBefore`.
4. If settlement never happens, anyone may call `reclaim(id)` after
   `validBefore` to return the cap. It is permissionless because the funds can
   only go back to the payer, so the payer never depends on a cooperative
   counterparty.

## Facilitator behaviour

The facilitator implements `SchemeNetworkFacilitator` for `stellar:*`. Its
supported kind for `upto` carries `extra: { areFeesSponsored: true,
facilitatorAddress }`, where `facilitatorAddress` is one of its signers.

### Verify

Return `isValid: false` with the listed `invalidReason` at the first check that
fails. Checks are ordered cheapest-first: the first block needs no network,
the registry result can be cached, and only the last block simulates.

| # | Check | `invalidReason` |
|---|---|---|
| 1 | `x402Version` is 2 | `invalid_x402_version` |
| 2 | `accepted.scheme` and `requirements.scheme` are `upto` | `unsupported_scheme` |
| 3 | `accepted.network` equals `requirements.network` | `network_mismatch` |
| 4 | the network is a supported `stellar:*` network | `invalid_network` |
| 5 | `payload` has every `authorization` field, `signature` decodes as an entry, `extra.contract` and `extra.facilitatorAddress` are present | `invalid_upto_stellar_payload_malformed` |
| 6 | `accepted` equals `requirements` | `invalid_upto_stellar_payload_requirements_mismatch` |
| 7 | `extra.contract` is what the registry resolves for `asset` | `invalid_upto_stellar_contract_not_canonical` |
| 8 | `payee` equals `payTo` | `invalid_upto_stellar_payload_wrong_payee` |
| 9 | `token` equals `asset` | `invalid_upto_stellar_payload_wrong_asset` |
| 10 | `settler` equals `extra.facilitatorAddress` and is one of this facilitator's signers | `invalid_upto_stellar_payload_wrong_settler` |
| 11 | `payer` is not one of this facilitator's addresses | `invalid_upto_stellar_payload_facilitator_is_payer` |
| 12 | `maxAmount` equals `amount` | `invalid_upto_stellar_payload_wrong_amount` |
| 13 | `resource` equals the resource commitment | `invalid_upto_stellar_payload_wrong_resource` |
| 14 | `validBefore − validAfter` is at most `maxTimeoutSeconds` plus 60 | `invalid_upto_stellar_payload_window_too_long` |
| 15 | ledger time is not before `validAfter` | `invalid_upto_stellar_payload_not_yet_valid` |
| 16 | ledger time is before `validBefore` | `invalid_upto_stellar_payload_expired` |
| 17 | the entry has address credentials | `invalid_upto_stellar_payload_unsupported_credential_type` |
| 18 | the credential address is `payer` | `invalid_upto_stellar_payload_wrong_signer` |
| 19 | the entry carries a signature | `invalid_upto_stellar_payload_missing_payer_signature` |
| 20 | the invocation tree is exactly the required tree | `invalid_upto_stellar_payload_wrong_invocation` |
| 21 | `signatureExpirationLedger` is no later than the current ledger plus `ceil(maxTimeoutSeconds / ledger close time)` | `invalid_upto_stellar_signature_expiration_too_far` |
| 22 | `is_consumed(id)` is false | `invalid_upto_stellar_payload_already_consumed` |
| 23 | the payer's `asset` balance is at least `maxAmount` | `invalid_upto_stellar_insufficient_funds` |
| 24 | `balance(payTo)` on `asset` succeeds | `invalid_upto_stellar_payee_cannot_receive` |
| 25 | simulating `settle_signed(authorization, 0)` with the facilitator as source, in enforcing auth mode, succeeds | the mapped reason from the settle table, else `invalid_upto_stellar_simulation_failed` |
| 26 | the simulated fee is within the facilitator's ceiling | `invalid_upto_stellar_fee_exceeds_maximum` |

Notes on the checks that are not self-explanatory:

- **25, the zero simulation.** Simulating with `settled = 0` verifies
  authorization, escrow solvency and replay state without committing to a
  price, which is the point of verifying before the work is done. Enforcing
  mode checks every signature in the entry, not only its shape.
- **24, the payee.** A zero settlement never moves funds to the payee, so the
  simulation cannot see a payee that is unable to receive the asset. On testnet,
  with a payee that has no USDC trustline, `settle_signed(…, 0)` succeeds and
  every positive amount fails with the token's `TrustlineMissing` error. The
  token's `balance(payTo)` fails the same way and costs one read, so verify
  catches it before the work is done rather than at settlement.
- **26, the fee ceiling.** Contract instances, code and balance entries are
  archived when their TTL lapses, and a transaction touching them restores them
  automatically at many times the normal fee. On testnet one such settlement
  cost 11.44 XLM against 0.003 XLM warm. A facilitator should refuse rather
  than pay that silently; `exact` defaults its ceiling to 50,000 stroops, which
  a warm `upto` settlement fits.

### Settle

The resource server calls settle with the payload and with requirements whose
`amount` is the settled amount, the usage it measured.

1. Every field of `requirements` other than `amount` must equal
   `payload.accepted`, else `invalid_upto_stellar_payload_requirements_mismatch`.
2. `requirements.amount` must not exceed `payload.accepted.amount`, the cap,
   else `invalid_upto_stellar_settlement_exceeds_amount`.
3. Re-run verification against `payload.accepted`, so the checks see the cap
   the payer signed rather than the settled amount.
4. Submit `settle_signed(authorization, requirements.amount)` with the
   facilitator as transaction source.
5. Return `{ success: true, transaction, network, payer, amount }`, where
   `transaction` is the hash and `amount` the settled amount.

**A settlement of zero is submitted, not skipped.** `settle_signed(…, 0)`
consumes the authorization id, pulls the cap and refunds all of it, for about
0.003 XLM. Skipping it would leave the payer's signed entry valid until
`validBefore`, settleable for anything up to the cap. Burning the authorization
is what makes "the call cost nothing" final. This differs from `upto` on EVM,
which returns success without a transaction.

**Never retry with a different amount.** The first successful call consumes the
id permanently, so a retry with another amount either races a live settlement
or fails on a consumed id. A facilitator keeps a pending-settlement record per
authorization id; when the outcome of a submission is unknown, it polls that
transaction's hash rather than submitting again.

On failure, map the error to `errorReason`:

| Raised by | Error | `errorReason` |
|---|---|---|
| escrow contract | `InvalidMaxAmount` (1), `InvalidValidityWindow` (2), `PayerIsPayee` (4) | `invalid_upto_stellar_payload_malformed` |
| escrow contract | `ValidityWindowTooLong` (3) | `invalid_upto_stellar_payload_window_too_long` |
| escrow contract | `NotYetValid` (5) | `invalid_upto_stellar_payload_not_yet_valid` |
| escrow contract | `Expired` (6) | `invalid_upto_stellar_payload_expired` |
| escrow contract | `AlreadyConsumed` (7) | `invalid_upto_stellar_payload_already_consumed` |
| escrow contract | `AmountOutOfRange` (9) | `invalid_upto_stellar_settlement_exceeds_amount` |
| host | `Error(Auth, ExistingValue)`: the entry's nonce is already spent | `invalid_upto_stellar_payload_already_consumed` |
| host | any other `Error(Auth, …)` | `invalid_upto_stellar_invalid_signature` |
| asset contract | `AccountMissing` (6), `BalanceDeauthorized` (11) or `TrustlineMissing` (13) on the transfer to the payee | `invalid_upto_stellar_payee_cannot_receive` |
| asset contract | any other error on a transfer from the payer | `invalid_upto_stellar_insufficient_funds` |
| network | submission rejected | `settle_upto_stellar_transaction_submission_failed` |
| network | landed as failed for any other reason | `settle_upto_stellar_transaction_failed` |

`LockNotFound` (8) and `NotExpiredYet` (10) belong to the session path and
cannot come from `settle_signed`.

**Attribute a contract error to the contract that raised it.** The escrow
contract and the asset contract share one error-code space: a token failure
inside `settle_signed` surfaces as `Error(Contract, #n)` with the token's code,
which can collide with an escrow code. The diagnostic events name the contract
that raised the error, and the mapping must use it. Exact replay of a header is
the other trap: the host refuses the spent entry nonce before the contract
runs, so a replay arrives as `Error(Auth, ExistingValue)`, not as
`AlreadyConsumed`. `AlreadyConsumed` is reached only when the payer signs the
same payload twice under different entry nonces.

## Server behaviour

The resource server implements `SchemeNetworkServer`. Its
`enhancePaymentRequirements` copies `facilitatorAddress` and `areFeesSponsored`
from the facilitator's supported kind into `extra`, alongside `contract`. After
serving, it settles with `requirements.amount` set to the measured usage
converted to atomic units, and returns the facilitator's `SettleResponse` in
`PAYMENT-RESPONSE`.

A server should bound the work it does by the cap before it starts, not only
rely on settlement refusing an overcharge. For a token-metered model this is
direct: set the generation limit to `floor(cap / price per token)`, so usage
can never exceed what the payer authorized.

## Security considerations

**Recipient binding.** Settled funds can only reach `payee`, because the payee
is part of the payload the payer authorized and the contract reads the
destination from that payload. A facilitator that substitutes a payee produces a
payload the payer's entry does not cover, and the host rejects the call.

**Settler binding.** The payer names the facilitator in `settler`, and the
contract requires that address's authorization for the call that names the
amount. A different party holding the payload cannot settle it. This is the
same binding `upto` on EVM achieves with `witness.facilitator`.

**Amount binding.** The settled amount is in the transaction the facilitator
signs as source, not in the payer's entry. Changing it after signing
invalidates the transaction, and raising it above the cap is refused by the
contract.

**Single settlement.** The id is consumed before any token call. In the session
path the lock entry is removed at the same point, so a second `settle` fails
with `LockNotFound`. There is no ordering in which two settlements can occur.

**Replay.** Consumed ids are recorded in Soroban temporary storage with a TTL
covering the validity window. Temporary storage is sufficient rather than
sloppy: an id only needs remembering until `validBefore`, after which the window
check rejects it regardless. The contract caps windows at seven days, which
bounds both the TTL and how long a payer's funds can sit escrowed.

**Settler trust.** The settler decides the final amount within the cap, so the
payer's exposure is the cap, and the cap alone. This is the same trust boundary
as any metered service: the client bounds the loss, the meter is the server's.
Clients should therefore size caps per request, not per relationship.

**Discovery.** A resource server controls `extra.contract`. A client that
checks it against the registry, and a facilitator that refuses non-canonical
contracts, remove the need to trust that value. The registry's admin key is the
trust it introduces; its key policy is documented with the deployment, and any
client can read the registry and check an address itself.

**Rent and eviction.** Locks are persistent (funds are at stake) and are removed
on settlement or reclaim, returning their rent. Replay markers are temporary and
expire on their own. A completed authorization leaves no permanent footprint.
The escrow contract's instance and code, and its balance entry in each asset,
are persistent and archive when not extended: operators should keep them
extended, and the facilitator's fee ceiling keeps an archived deployment from
silently charging the restore to every settlement.

**Token assumptions.** The contract calls SEP-41 `transfer` and holds no
balance between transactions. It does not defend against tokens with transfer
hooks or non-standard accounting; facilitators should restrict `asset` to
audited tokens, in practice Stellar Asset Contracts.

## Differences from `upto` on EVM

| | EVM | Stellar |
|---|---|---|
| What the payer signs | Permit2 authorization with a witness | Soroban authorization entry over `settle_signed(authorization)` |
| Facilitator binding | `witness.facilitator` | `authorization.settler` |
| Where the cap sits until settlement | stays with the payer under the permit | moved through the escrow contract in the settling transaction |
| Settling zero | success, no transaction | `settle_signed(…, 0)` submitted, burning the authorization |
| Smart accounts | via the account's EIP-1271 support | native: `__check_auth` and delegated credentials |
| Discovery | Permit2 address is fixed per chain | escrow deployment named by a registry |

## Open questions for the TSC

1. **Session path in the HTTP layer.** `lock` / `settle` has no representation
   in the request flow. `upto` on SVM models a payment channel; should the
   Stellar session path follow its shape?
2. **Window ceiling.** Seven days is an implementation choice, not a protocol
   constant. Should the scheme mandate a bound?
3. **Settling zero.** This draft burns the authorization on-chain; EVM skips
   the chain. Should the shared vocabulary say which, or is it per network?
4. **Resource commitment.** Should schemes that commit to the paid-for resource
   share one definition, such as the JCS digest used here?

Two questions from the v1 draft are closed. The amount-naming party already
exists upstream as `facilitatorAddress`, which this draft adopts. Discovery is
answered by the registry rather than by a Bazaar entry.

## Changes from the x402 v1 draft

- `x402Version` 1 → 2; networks `stellar` and `stellar-testnet` →
  `stellar:pubnet` and `stellar:testnet`.
- `maxAmountRequired` → `amount`; it is the cap at verification and the
  settled amount at settlement, which leaves in `SettleResponse.amount`.
- `X-PAYMENT` → `PAYMENT-SIGNATURE`, with `PAYMENT-REQUIRED` and
  `PAYMENT-RESPONSE`; the payload carries `accepted` and `resource`, and
  `payload.contract` is dropped in favour of `accepted.extra.contract`.
- `extra.settler` → `extra.facilitatorAddress`; `extra.decimals` dropped;
  `extra.areFeesSponsored` added.
- Resource commitment defined over `accepted` and the URL with RFC 8785.
- Reasons follow the v2 convention: generic for the envelope, otherwise
  prefixed `invalid_upto_stellar_` or `settle_upto_stellar_`.
- Verification gains the registry check, settler and payee-receivability checks,
  credential-type rules covering CAP-71, and the fee ceiling.
- Settlement of zero is submitted; contract errors are attributed to the
  contract that raised them; exact replay maps to `already_consumed`.
