# Conformance results

Run on 2026-10-20 against Stellar testnet by `npx tsx conformance/run.ts`.

- Escrow contract: `CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB`
- Registry: `CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46`
- Facilitator: `GCKVXPZLCMAEN7XGLM5IY7G5KOVOMD6DYPNTKNPIWGNH6HRM4KHUI23F`, payer `GB46XFJRANKWOOW6Y3MLF4YCBKFL45SFB6DIBMX637J4722SRJY5NEVS`, payee `GDZLO4WDTENTYFH3JV5NPIPENE47Y35HKFCBLP4BGKMODETN7FQLHLHU`

**34 of 34 cases passed.**

| Case | Phase | Result | Outcome | Tx |
|---|---|---|---|---|
| `valid-verifies` | verify | pass | `{"isValid":true}` |  |
| `envelope-version-1` | verify | pass | `{"isValid":false,"invalidReason":"invalid_x402_version"}` |  |
| `envelope-other-scheme` | verify | pass | `{"isValid":false,"invalidReason":"unsupported_scheme"}` |  |
| `envelope-network-mismatch` | verify | pass | `{"isValid":false,"invalidReason":"network_mismatch"}` |  |
| `envelope-unsupported-network` | verify | pass | `{"isValid":false,"invalidReason":"invalid_network"}` |  |
| `shape-missing-fields` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_malformed"}` |  |
| `shape-signature-not-an-entry` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_malformed"}` |  |
| `accepted-differs` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_requirements_mismatch"}` |  |
| `contract-not-canonical` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_contract_not_canonical"}` |  |
| `payee-redirected` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_payee"}` |  |
| `asset-swapped` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_asset"}` |  |
| `settler-not-this-facilitator` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_settler"}` |  |
| `facilitator-as-payer` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_facilitator_is_payer"}` |  |
| `cap-below-requirements` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_amount"}` |  |
| `resource-other-terms` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_resource"}` |  |
| `window-too-long` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_window_too_long"}` |  |
| `window-not-open` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_not_yet_valid"}` |  |
| `window-closed` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_expired"}` |  |
| `credentials-source-account` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_unsupported_credential_type"}` |  |
| `entry-for-another-address` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_signer"}` |  |
| `entry-unsigned` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_missing_payer_signature"}` |  |
| `tree-signs-the-amount` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payload_wrong_invocation"}` |  |
| `signature-outlives-window` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_signature_expiration_too_far"}` |  |
| `payer-without-funds` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_insufficient_funds"}` |  |
| `payee-cannot-receive` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_payee_cannot_receive"}` |  |
| `signature-forged` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_invalid_signature"}` |  |
| `fee-over-ceiling` | verify | pass | `{"isValid":false,"invalidReason":"invalid_upto_stellar_fee_exceeds_maximum"}` |  |
| `settle-below-cap` | settle | pass | `{"amount":"2000000","payeeReceives":"2000000","payerPays":"2000000","consumed":true,"success":true}` | [`6af2aa56…`](https://stellar.expert/explorer/testnet/tx/6af2aa56a1387c403e9341273d99353e2137e4553e1a1e458bf729c2ed30b6bd) |
| `settle-zero-burns` | settle | pass | `{"amount":"0","payeeReceives":"0","payerPays":"0","consumed":true,"success":true}` | [`7e0e075c…`](https://stellar.expert/explorer/testnet/tx/7e0e075c2a9ef342c8278bb7210fe36ff3feafb8d89659c3a703f2fec53e6aeb) |
| `settle-above-cap` | settle | pass | `{"success":false,"errorReason":"invalid_upto_stellar_settlement_exceeds_amount"}` |  |
| `settle-changed-terms` | settle | pass | `{"success":false,"errorReason":"invalid_upto_stellar_payload_requirements_mismatch"}` |  |
| `settle-same-amount-again` | settle | pass | `{"amount":"1000000","payeeReceives":"1000000","payerPays":"1000000","consumed":true,"sameTransaction":true,"success":true}` | [`f35f9580…`](https://stellar.expert/explorer/testnet/tx/f35f9580dad2440e25baab71dea148aa6cea16af8b13411766823de26911cba4) |
| `settle-other-amount-again` | settle | pass | `{"amount":"1000000","payeeReceives":"1000000","payerPays":"1000000","consumed":true,"success":false,"errorReason":"invalid_upto_stellar_payload_already_consumed"}` | [`d6685860…`](https://stellar.expert/explorer/testnet/tx/d6685860259aebab6a1defc08c3d2ca87a4e8ac46d21179ca991cf976fa09c3c) |
| `settle-replayed-elsewhere` | settle | pass | `{"amount":"1000000","payeeReceives":"1000000","payerPays":"1000000","consumed":true,"success":false,"errorReason":"invalid_upto_stellar_payload_already_consumed"}` | [`3c1afdc2…`](https://stellar.expert/explorer/testnet/tx/3c1afdc21162532ccb103ecca9a171d257e2881c0300ca05d16b51805d57f1f7) |

Setup transactions:

- payer: USDC trustline, 100 XLM → USDC: [`023d6f0c…`](https://stellar.expert/explorer/testnet/tx/023d6f0c029a603b35578323f831df0961ada1d6ac56dd98771aacc6b8e6115d)
- payee: USDC trustline: [`51598706…`](https://stellar.expert/explorer/testnet/tx/515987060eb59606ba3d11313ce7b7c3b1845b79c7751fe86caf578b3c8a4e98)
