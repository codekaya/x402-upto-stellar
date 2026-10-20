# Sprint plan

Instaward sprint, 30 days from 10 November 2026. This plan follows the accepted
Statement of Work exactly: three deliverables, 100 hours, eleven success
criteria checked on day 30.

The settlement contract is live on testnet at
`CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB` and is a dependency,
not part of this sprint.

## Where the work slots in

`@x402/stellar` (2.28.0 on npm) publishes exactly three entry points:
`exact/client`, `exact/facilitator`, `exact/server`. That is the shape to
mirror. This sprint produces the `upto` side of the same split, plus the
registry contract underneath it, which `exact` has no equivalent of because it
trusts the contract address written into the 402 response.

Publishing goes to our own scope. An upstream pull request is deliberately not
a deliverable, because a deliverable may not depend on outside maintainers. It
happens after the sprint.

## Before day 1: three spikes

The only real unknowns. A few hours each, and each one changes the plan if it
fails. They belong before 10 November, not inside the sprint.

**Spike 1, the critical one. Two signers in one transaction.** Sign a
`settle_signed` payload as the payer in TypeScript with `authorizeEntry`,
submit it as the settler, against the live contract. The payer signs the
payload and deliberately not the settled amount, so the transaction carries the
payer's authorization entry and the settler's own signature.

Target: one settlement on testnet where the payee is paid, the remainder
returns to the payer, and neither signer could have changed the other's half.

If it fails, the one-shot HTTP path is unreachable from a browser or an agent
and the sprint pivots to the session path: the payer submits `lock` themselves
and the facilitator only calls `settle`. All three deliverables survive; the
client gets simpler and the facilitator gains an endpoint.

**Spike 2. Reading the network identity inside a contract.** Confirm
`env.ledger().network_id()` is what a record should be keyed against, so a
record admitted on one network refuses to resolve on another. This is one of
the three negative cases the award is checked against.

**Spike 3. The ground rules.** Read `exact/client` and `exact/facilitator` and
write down the interfaces to mirror. Pick the settlement token on testnet: the
published USDC SAC if it is usable, otherwise deploy a test SAC and say so.
Stand up the local model the metered demo will proxy, so the meter has
something real to count without paid credits.

## Deliverable 1, registry contract, 28 hours

A Soroban contract that answers: for this network and token, which `upto`
deployment is canonical?

| Piece | Shape |
|---|---|
| Storage | persistent record keyed by token address, carrying the deployment address and the network id it was registered under |
| Write path | `register` behind `require_auth` of a stored admin address, with the key policy documented in the README |
| Read path | `resolve(token)` returning the deployment, refusing when the stored network id is not the ledger's own |
| Errors | typed, one per refusal reason |
| Events | emitted on every registration and change |
| TTL | records bumped on access, documented |

Three negative cases, each one a published transaction:

1. resolving a token that was never registered fails
2. a record registered under another network id does not resolve
3. a write from an address that is not the admin is rejected

Finishes with the contract deployed to testnet, the contract ID in the README,
and a measured resource profile for registration and resolution.

## Deliverable 2, facilitator and conformance suite, 40 hours

**Verification**, in the spec's cheapest-first order, each failure returning its
specified reason:

scheme and network, payload contract against the advertised contract, payee and
token, cap against the advertised minimum, resource match, validity window,
signature shape, replay state through `is_consumed`, payer balance, and finally
a simulated `settle_signed` at zero, which checks authorization and solvency
without committing to a price.

**The registry check**: a payload naming a contract address that does not
resolve through Deliverable 1 is refused before anything else happens.

**Settlement**: submit, return the transaction hash, map every contract error to
its x402 reason:

| Contract error | Reason |
|---|---|
| `AlreadyConsumed` | `invalid_payment` |
| `Expired`, `NotYetValid` | `invalid_timing` |
| `AmountOutOfRange` | `invalid_amount` |
| `InvalidMaxAmount`, `InvalidValidityWindow`, `ValidityWindowTooLong`, `PayerIsPayee` | `invalid_payment_requirements` |
| host authorization failure | `invalid_signature` |
| token transfer failure | `insufficient_funds` |

A failed settlement is never retried with a different amount: the first
successful call consumes the id permanently.

**Conformance vectors**: a published suite of valid and invalid payloads with
their expected outcomes, and a runner that executes them against a given
deployment and prints one line per case.

## Deliverable 3, client package and metered service, 32 hours

**Client**: payload construction, authorization-entry signing, id derivation
through the contract view, registry lookup, `X-PAYMENT` encoding. Published to
npm at v0.1.0 with types, tests and a README.

**Metered service**: a proxy in front of a locally hosted model that answers 402
with an `upto` entry, serves the request, counts the tokens it actually
produced, and is settled for that count below the authorized cap, with the
remainder returning to the payer.

The SOW also lists a three-minute recording of the cycle. The chapter has said
it is not required, so it is not planned here. If that changes it is an hour of
work on the last day.

## The 30 days

25 hours a week, four weeks.

| Week | Work | Output |
|---|---|---|
| 1 | Registry: storage, write path, resolution, errors, events, TTL. Negative tests. Deploy, resource profile, README. | Contract ID published, first registration and resolution on-chain, three rejection transactions |
| 2 | Package scaffold mirroring `exact/*`. Verification through the full check order, ending in the zero simulation. Registry check. First conformance vectors. | Every specified reason reproduced against a bad payload |
| 3 | Settlement with the full error mapping and the no-retry rule. Conformance runner. Mid-sprint demo with the Chapter Lead. | A settlement hash from the live network, suite passing |
| 4 | Client, signing paths, npm publish. Metered service and the full cycle. Evidence pack. | npm v0.1.0, metered settlement below the cap, transaction table complete |

## Evidence, captured the day it happens

One table in the README, appended as each transaction lands. Chasing eight
hashes on day 30 is the most avoidable hour of the sprint.

| What | Tx |
|---|---|
| Registry registration | |
| Registry resolution | |
| Rejected: unregistered token | |
| Rejected: wrong network | |
| Rejected: non-admin write | |
| Verification simulation | |
| Settlement with refund | |
| Metered settlement below the cap | |

## Day 30 checklist

The criteria the award is measured against:

- [ ] Registry deployed, contract ID in the README
- [ ] A resolution call returns the canonical deployment, visible in an explorer
- [ ] All three negative cases fail as specified, each with a published hash
- [ ] Test suite and resource profile committed, CI green
- [ ] Verification returns the correct reason for every malformed payload
- [ ] Settlement returns a hash on success and the mapped reason on each error
- [ ] A payload failing the registry check is refused
- [ ] The conformance runner reports every case passing against testnet
- [ ] Client package published at v0.1.0 with types, tests and README
- [ ] The metered service completes a cycle below the cap, hash published

## Chapter obligations, not billed

Weekly progress update in the Stellar Türkiye channel. Mid-sprint check-in and
live demo with the Chapter Lead around day 15. End-of-sprint review against the
success criteria, plus a short session on charging for a metered API on
Stellar.

## Risks

| Risk | Signal | Response |
|---|---|---|
| Off-chain authorization signing does not work as specified | Spike 1 fails | Pivot to the session path; the payer submits `lock`, the facilitator settles |
| Network identity is not readable or not stable | Spike 2 fails | Key records by an explicit network tag supplied at registration, and document the trust that places in the admin |
| Week 3 slips | Runner not green by the end of week 3 | Narrow the runner to this deployment rather than any deployment; the vectors still publish |
| The metered demo needs more than the hardware available | Model too large to serve | Meter a cheaper unit: bytes returned from a local data service, same payment path |

## After the sprint

Propose the Stellar `upto` specification upstream next to the EVM and SVM ones,
and the triplet to `@x402/stellar`. A follow-on Instaward is possible if the
chapter judges this one delivered; the lifetime cap across Instawards is
$15,000. Developer tooling of this kind is supported through the RFP Track and
the Public Goods Award.
