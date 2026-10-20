import { Networks } from "@stellar/stellar-sdk";

export const SCHEME = "upto";
export const X402_VERSION = 2;

/** Domain separator of the escrow contract's authorization id. */
export const SCHEME_DOMAIN = "x402-upto-stellar-v1";

/** Client time tolerance applied to `validAfter`, and allowed on top of `maxTimeoutSeconds`. */
export const CLOCK_ALLOWANCE_SECONDS = 60;

/** Nominal ledger close time, used to size signature expiry. */
export const LEDGER_SECONDS = 5;

/** Fee ceiling for a settlement, as in `exact`. A warm settle_signed costs about 30,000. */
export const DEFAULT_MAX_TRANSACTION_FEE_STROOPS = 50_000;

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
