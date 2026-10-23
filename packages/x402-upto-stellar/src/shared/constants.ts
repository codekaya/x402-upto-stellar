import { Networks } from "@stellar/stellar-sdk";

export const SCHEME = "upto";
export const X402_VERSION = 2;

/** Domain separator of the escrow contract's authorization id. */
export const SCHEME_DOMAIN = "x402-upto-stellar-v1";

/** Client time tolerance applied to `validAfter`, and allowed on top of `maxTimeoutSeconds`. */
export const CLOCK_ALLOWANCE_SECONDS = 60;

/** Nominal ledger close time, used to size signature expiry. */
export const LEDGER_SECONDS = 5;

/**
 * Fee ceiling for a settlement, 0.1 XLM. Soroban rent is priced dynamically: a
 * warm settle_signed cost about 36,000 stroops on testnet on 20 October 2026 and
 * 136,000 on 23 October, so `exact`'s 50,000 is too tight for a scheme that
 * writes a replay marker. 0.1 XLM still refuses a settlement that would pay to
 * restore archived state, which costs whole XLM.
 */
export const DEFAULT_MAX_TRANSACTION_FEE_STROOPS = 1_000_000;

export interface UptoDeployment {
  /** The canonical `upto` escrow contract. */
  contract?: string;
  /** The discovery registry that names it. */
  registry?: string;
}

/** Known deployments per CAIP-2 network. */
export const DEPLOYMENTS: Record<string, UptoDeployment> = {
  "stellar:testnet": {
    contract: "CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB",
    registry: "CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46",
  },
  "stellar:pubnet": {},
};

export const NETWORK_PASSPHRASES: Record<string, string> = {
  "stellar:testnet": Networks.TESTNET,
  "stellar:pubnet": Networks.PUBLIC,
};
