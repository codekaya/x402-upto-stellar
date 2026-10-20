import { randomBytes } from "node:crypto";
import { Address, authorizeEntry, rpc, xdr } from "@stellar/stellar-sdk";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientStellarSigner } from "@x402/stellar";

import { CLOCK_ALLOWANCE_SECONDS, LEDGER_SECONDS } from "./constants.js";
import { payerInvocation, resourceCommitment, type UptoAuthorization, type UptoStellarPayload } from "./encoding.js";

export interface BuildPayloadOptions {
  signer: ClientStellarSigner;
  requirements: PaymentRequirements;
  server: rpc.Server;
  passphrase: string;
  /** Field overrides applied before signing. For conformance vectors. */
  overrides?: Partial<UptoAuthorization>;
  /** Override the signature expiry ledger. For conformance vectors. */
  expirationLedger?: number;
  /** Override the signed tree. For conformance vectors. */
  invocation?: (contract: string, authorization: UptoAuthorization) => xdr.SorobanAuthorizedInvocation;
  /** Leave the entry unsigned. For conformance vectors. */
  unsigned?: boolean;
}

/**
 * Builds the authorization from the accepted requirements and signs the
 * payer's entry through `signer.signAuthEntry`. No transaction is built and
 * nothing is submitted; the only network read is the latest ledger, for the
 * validity window and the signature expiry.
 */
export async function buildSignedPayload(options: BuildPayloadOptions): Promise<UptoStellarPayload> {
  const { signer, requirements, server, passphrase } = options;
  const contract = String(requirements.extra.contract);
  const latest = await server.getLatestLedger();
  const now = Number(latest.closeTime);

  const authorization: UptoAuthorization = {
    payer: signer.address,
    payee: requirements.payTo,
    settler: String(requirements.extra.facilitatorAddress),
    token: requirements.asset,
    maxAmount: requirements.amount,
    validAfter: String(now - CLOCK_ALLOWANCE_SECONDS),
    validBefore: String(now + requirements.maxTimeoutSeconds),
    nonce: randomBytes(32).toString("hex"),
    resource: resourceCommitment(requirements),
    ...options.overrides,
  };

  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(authorization.payer).toScAddress(),
        nonce: xdr.Int64.fromString(randomBytes(8).readBigInt64BE().toString()),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: (options.invocation ?? payerInvocation)(contract, authorization),
  });

  const expiration =
    options.expirationLedger ?? latest.sequence + Math.ceil(requirements.maxTimeoutSeconds / LEDGER_SECONDS);

  const signed = options.unsigned
    ? entry
    : await authorizeEntry(
        entry,
        async (preimage) => {
          const result = await signer.signAuthEntry(preimage.toXDR("base64"), {
            networkPassphrase: passphrase,
            address: signer.address,
          });
          if (result.error) throw new Error(`signAuthEntry: ${result.error.message}`);
          return Buffer.from(result.signedAuthEntry, "base64");
        },
        expiration,
        passphrase,
      );

  return { authorization, signature: signed.toXDR("base64") };
}
