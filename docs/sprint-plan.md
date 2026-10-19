# Sprint plan

Instaward sprint, 10 November to 9 December 2026. Three deliverables: a
self-verifying deployment registry, a facilitator with a conformance suite, and
a client package with a live metered service.

The settlement contract is live on testnet at
`CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB` and is a dependency,
not part of this sprint.

## Where the work slots in

`@x402/stellar` (2.28.0 on npm) publishes exactly three entry points:

```
@x402/stellar/exact/client
@x402/stellar/exact/facilitator
@x402/stellar/exact/server
```

That is the shape to mirror. The sprint produces the `upto` triplet with the
same split, plus the registry contract underneath it:

| This sprint | Mirrors |
|---|---|
| `upto/facilitator` — verify and settle | `exact/facilitator` |
| `upto/client` — payload, signing, `X-PAYMENT` | `exact/client` |
| `upto/server` — 402 response with an `upto` accepts entry | `exact/server` |
| registry contract | nothing yet; `exact` trusts the address in the 402 |

Publishing goes to our own scope first. An upstream pull request is deliberately
**not** a deliverable: Instawards rules forbid deliverables that depend on
outside maintainers. It happens after the sprint, on its own timeline.

## Before day 1: three spikes

These are the only real unknowns. Each is a few hours and each one, if it
fails, changes the plan. Do them before 10 November, not inside the sprint.

### Spike 1 — off-chain authorization signing (the critical one)

Sign a `settle_signed` payload as the payer in TypeScript, submit it as the
settler, against the live contract. The payer signs the payload but not the
settled amount, so two different signers appear in one transaction.

- `authorizeEntry` from `@stellar/stellar-sdk` for the payer's entry
- the settler signs the transaction itself
- target: one successful settlement on testnet with a refund

**If this fails**, the one-shot HTTP path is not reachable from a browser or an
agent, and the sprint pivots to the session path: the payer submits `lock`
themselves and the facilitator only calls `settle`. Deliverables survive, the
client gets simpler, the facilitator gets one more endpoint.

### Spike 2 — the admission probe

A throwaway Soroban test that calls another contract's view with
`env.try_invoke_contract` and handles the case where the target has no such
function or traps. This is the mechanism the registry is built on.

**If this fails**, fall back to probing at read time: the registry stores
candidate addresses and the resolution view runs the probe before answering, so
an address that stops matching stops resolving.

### Spike 3 — the ground rules

- Read `exact/client` and `exact/facilitator` in `@x402/stellar` and write down
  the interfaces to mirror.
- Pick the settlement token on testnet: the published USDC SAC if it is usable,
  otherwise deploy a test SAC and say so in the README.
- Pick what the metered service actually meters. It must be free to run and
  deterministic: units served, bytes returned, rows queried. Nothing that needs
  paid model credits.

## The 30 days

Hour budget is 100, roughly 25 per week. Two days are already spoken for by
Pacta gates (13 and 27 November), so they are left empty here.

### Week 1, 10 to 16 November — registry contract (28 h)

| Day | Work | Done when |
|---|---|---|
| 10–11 Nov | Contract skeleton: storage model for records, resolution view, typed errors, events. Port the id derivation so the registry can compute the expected answer itself. | `make test` green on the happy path |
| 12 Nov | The admission probe: call the candidate's derivation view with a fixed vector, compare, record or refuse. | A wrong-answer candidate is refused in a test |
| 13 Nov | *Pacta gate, no sprint work* | |
| 14 Nov | Negative tests: wrong answer refused, unregistered address does not resolve, a record admitted for one network does not resolve on another. TTL strategy for records. | Three negative tests green |
| 15–16 Nov | Deploy to testnet, publish the contract ID, measure the resource profile for admission and resolution, write the contract README including the stated limitation of the probe. | Contract ID in the README, first admission and resolution transactions public |

**Week 1 evidence:** contract ID, one admission tx, one resolution tx, three
rejection txs, resource profile committed.

### Week 2, 17 to 23 November — facilitator verify (20 h)

| Day | Work | Done when |
|---|---|---|
| 17–18 Nov | Package scaffold mirroring `exact/*`. Verification: the cheapest-first check order from the spec, each failing case returning its specified reason. | Each reason returned against a hand-written bad payload |
| 19 Nov | The registry check: refuse a payload whose contract address does not resolve. | Refusal covered by a test |
| 20–21 Nov | Finish verification with the simulated settlement at zero against the live contract. Draft the conformance vectors from the spec tables. | Simulation path working, first vectors committed |

**Week 2 evidence:** verification output table, vectors in the repository.

### Week 3, 24 to 30 November — settle and the conformance runner (20 h)

| Day | Work | Done when |
|---|---|---|
| 24 Nov | Settlement: submit, return the transaction hash, map every contract error to its x402 reason. Mid-sprint demo with the Chapter Lead. | A settlement hash from the live network |
| 25–26 Nov | The no-retry rule, error mapping tests, edge cases. | Every mapped error reproduced in a test |
| 27 Nov | *Pacta gate, no sprint work* | |
| 28–30 Nov | The conformance runner: executes the vector suite against a given deployment and prints one line per case. | Full suite passing against testnet |

**Week 3 evidence:** settlement tx, runner output in the repository.

### Week 4, 1 to 9 December — client, metered service, evidence (32 h)

| Day | Work | Done when |
|---|---|---|
| 1–2 Dec | Client: payload construction, authorization-entry signing, id derivation through the contract view, registry lookup, `X-PAYMENT` encoding. | A payment produced from the package alone |
| 3 Dec | Signing paths: Stellar Wallets Kit for a browser payer, local key for a server-side one. | Both paths exercised |
| 4–5 Dec | The metered service: 402 with an `upto` entry, serve, count units, settle for that count below the ceiling. | A full cycle on testnet with the refund visible |
| 6–7 Dec | npm publish at v0.1.0 with types, tests and README. Developer documentation. | Package installable from a clean directory |
| 8–9 Dec | Evidence pack: the transaction table, the runner output, a short screen recording of the cycle. Final review against the success criteria. | Every success criterion ticked |

**Week 4 evidence:** npm link, metered settlement tx below the ceiling,
recording, and a clean-room run where only the published package is used.

## Evidence discipline

Capture as you go, not at the end. One table in the repository README, appended
the day each transaction happens:

| What | Network | Tx |
|---|---|---|
| Registry admission | testnet | |
| Registry resolution | testnet | |
| Rejected: wrong derivation | testnet | |
| Rejected: unregistered address | testnet | |
| Rejected: wrong network | testnet | |
| Verification simulation | testnet | |
| Settlement with refund | testnet | |
| Metered settlement below ceiling | testnet | |

A transaction that is not in this table on the day it happens is a transaction
that will be hunted for on day 30.

## Chapter obligations

- Weekly progress update in the Stellar Türkiye channel, every Monday.
- Mid-sprint check-in and live demo with the Chapter Lead, 24 November.
- End-of-sprint review against the success criteria, plus a short session on
  charging for a metered API on Stellar.

None of this is billed.

## Risks

| Risk | Signal | Response |
|---|---|---|
| Off-chain authorization signing does not work as specified | Spike 1 fails before the sprint | Pivot to the session path; the payer submits `lock`, the facilitator settles |
| The admission probe traps in a way that cannot be caught | Spike 2 fails | Probe at read time instead of write time |
| Week 3 slips | Runner not green by 30 November | Narrow the runner to this deployment rather than any deployment; keep the vectors published |
| Pacta work bleeds into sprint days | Two gates missed or moved | The gates are fixed; sprint work moves, and the Chapter Lead is told early rather than on day 30 |

## After the sprint

- Upstream: propose the Stellar `upto` specification next to the EVM and SVM
  ones, and the triplet to `@x402/stellar`. Not a sprint deliverable.
- Follow-on Instaward if the chapter judges the sprint delivered. The lifetime
  cap across Instawards is $15,000.
- Developer tooling of this kind is supported through the RFP Track and the
  Public Goods Award rather than a Build Award.
