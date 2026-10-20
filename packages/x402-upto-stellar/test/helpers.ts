import { Keypair, StrKey, rpc } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { randomBytes } from "node:crypto";

export const NOW = 1_792_490_000;
export const LEDGER = 5_300_000;
export const ESCROW = "CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB";
export const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const payerKey = Keypair.random();
export const facilitatorKey = Keypair.random();
export const payee = Keypair.random().publicKey();
export const payerSigner = createEd25519Signer(payerKey.secret(), "stellar:testnet");
export const facilitatorSigner = createEd25519Signer(facilitatorKey.secret(), "stellar:testnet");

/** An RPC stand-in: a fixed ledger, and a marker error once a check needs chain state. */
export const CHAIN_STATE = "offline stub: chain state reached";
export const stubServer = {
  getLatestLedger: async () => ({ id: "x", sequence: LEDGER, protocolVersion: "29", closeTime: String(NOW) }),
  simulateTransaction: async () => {
    throw new Error(CHAIN_STATE);
  },
  getAccount: async () => {
    throw new Error(CHAIN_STATE);
  },
} as unknown as rpc.Server;

export function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "upto",
    network: "stellar:testnet",
    asset: USDC,
    amount: "5000000",
    payTo: payee,
    maxTimeoutSeconds: 600,
    extra: { contract: ESCROW, facilitatorAddress: facilitatorKey.publicKey(), areFeesSponsored: true },
    ...overrides,
  };
}

export function paymentPayload(accepted: PaymentRequirements, payload: unknown): PaymentPayload {
  return { x402Version: 2, accepted, payload: payload as Record<string, unknown> };
}

export const randomContract = () => StrKey.encodeContract(randomBytes(32));
