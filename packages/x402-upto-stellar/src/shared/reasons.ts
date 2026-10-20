/**
 * Every reason the facilitator returns, as the spec names them. Envelope
 * reasons are the generic x402 v2 ones; the rest are scheme-prefixed.
 */
export const Reason = {
  invalidVersion: "invalid_x402_version",
  unsupportedScheme: "unsupported_scheme",
  networkMismatch: "network_mismatch",
  invalidNetwork: "invalid_network",

  malformed: "invalid_upto_stellar_payload_malformed",
  requirementsMismatch: "invalid_upto_stellar_payload_requirements_mismatch",
  contractNotCanonical: "invalid_upto_stellar_contract_not_canonical",
  wrongPayee: "invalid_upto_stellar_payload_wrong_payee",
  wrongAsset: "invalid_upto_stellar_payload_wrong_asset",
  wrongSettler: "invalid_upto_stellar_payload_wrong_settler",
  facilitatorIsPayer: "invalid_upto_stellar_payload_facilitator_is_payer",
  wrongAmount: "invalid_upto_stellar_payload_wrong_amount",
  wrongResource: "invalid_upto_stellar_payload_wrong_resource",
  windowTooLong: "invalid_upto_stellar_payload_window_too_long",
  notYetValid: "invalid_upto_stellar_payload_not_yet_valid",
  expired: "invalid_upto_stellar_payload_expired",
  unsupportedCredentialType: "invalid_upto_stellar_payload_unsupported_credential_type",
  wrongSigner: "invalid_upto_stellar_payload_wrong_signer",
  missingPayerSignature: "invalid_upto_stellar_payload_missing_payer_signature",
  wrongInvocation: "invalid_upto_stellar_payload_wrong_invocation",
  signatureExpirationTooFar: "invalid_upto_stellar_signature_expiration_too_far",
  alreadyConsumed: "invalid_upto_stellar_payload_already_consumed",
  insufficientFunds: "invalid_upto_stellar_insufficient_funds",
  payeeCannotReceive: "invalid_upto_stellar_payee_cannot_receive",
  simulationFailed: "invalid_upto_stellar_simulation_failed",
  feeExceedsMaximum: "invalid_upto_stellar_fee_exceeds_maximum",
  invalidSignature: "invalid_upto_stellar_invalid_signature",
  settlementExceedsAmount: "invalid_upto_stellar_settlement_exceeds_amount",

  submissionFailed: "settle_upto_stellar_transaction_submission_failed",
  transactionFailed: "settle_upto_stellar_transaction_failed",
  unexpectedVerify: "unexpected_verify_error",
  unexpectedSettle: "unexpected_settle_error",
} as const;

export type UptoReason = (typeof Reason)[keyof typeof Reason];

/** Escrow contract error codes (contracts/upto/src/error.rs). */
export const EscrowError = {
  InvalidMaxAmount: 1,
  InvalidValidityWindow: 2,
  ValidityWindowTooLong: 3,
  PayerIsPayee: 4,
  NotYetValid: 5,
  Expired: 6,
  AlreadyConsumed: 7,
  LockNotFound: 8,
  AmountOutOfRange: 9,
  NotExpiredYet: 10,
} as const;

/** Stellar Asset Contract error codes that mean an account cannot hold the asset. */
const TOKEN_CANNOT_RECEIVE = new Set([6, 11, 13]); // AccountMissing, BalanceDeauthorized, TrustlineMissing

/** A host error, attributed to the contract that raised it. */
export interface HostError {
  /** "Contract", "Auth", "Budget", … */
  type: string;
  /** Contract error number, or the host error code name. */
  code: string;
  /** The contract the first error event came from, if any. */
  raisedBy?: string;
}

/**
 * Maps a host error to a reason. Escrow and token errors share one code space,
 * so the raising contract decides which table applies.
 */
export function reasonForHostError(error: HostError, escrow: string, asset: string): UptoReason | undefined {
  if (error.type === "Auth") {
    return error.code === "ExistingValue" ? Reason.alreadyConsumed : Reason.invalidSignature;
  }
  if (error.type !== "Contract") return undefined;
  const code = Number(error.code);

  if (error.raisedBy === asset) {
    return TOKEN_CANNOT_RECEIVE.has(code) ? Reason.payeeCannotReceive : Reason.insufficientFunds;
  }
  if (error.raisedBy !== undefined && error.raisedBy !== escrow) return undefined;

  switch (code) {
    case EscrowError.InvalidMaxAmount:
    case EscrowError.InvalidValidityWindow:
    case EscrowError.PayerIsPayee:
      return Reason.malformed;
    case EscrowError.ValidityWindowTooLong:
      return Reason.windowTooLong;
    case EscrowError.NotYetValid:
      return Reason.notYetValid;
    case EscrowError.Expired:
      return Reason.expired;
    case EscrowError.AlreadyConsumed:
      return Reason.alreadyConsumed;
    case EscrowError.AmountOutOfRange:
      return Reason.settlementExceedsAmount;
    default:
      return undefined;
  }
}
