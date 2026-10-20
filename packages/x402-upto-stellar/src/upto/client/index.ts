import { rpc } from "@stellar/stellar-sdk";
import type {
  Network,
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { findDefaultAsset, getRpcUrl, type ClientStellarSigner } from "@x402/stellar";

import { authorizationId, resolveDeployment } from "../../shared/chain.js";
import { DEPLOYMENTS, NETWORK_PASSPHRASES, SCHEME } from "../../shared/constants.js";
import { authorizationToScVal, type UptoStellarPayload } from "../../shared/encoding.js";
import { buildSignedPayload } from "../../shared/payload.js";

export interface UptoClientOptions {
  /** RPC endpoint. Defaults to the public testnet RPC; required for pubnet. */
  rpcUrl?: string;
  /** Registry to check `extra.contract` against. Defaults to the known one; `false` skips the check. */
  registry?: string | false;
  /** Injected RPC client, for tests. */
  server?: rpc.Server;
}

/**
 * Client side of the `upto` scheme on Stellar: builds the authorization and
 * signs the payer's Soroban authorization entry. The payer signs the payload
 * and the cap, never the settled amount, and never submits a transaction.
 */
export class UptoStellarScheme implements SchemeNetworkClient {
  readonly scheme = SCHEME;
  findDefaultAsset = findDefaultAsset;

  constructor(
    private readonly signer: ClientStellarSigner,
    private readonly options: UptoClientOptions = {},
  ) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    const passphrase = this.validate(requirements);
    if (context?.maxAmountPerPayment !== undefined && BigInt(requirements.amount) > BigInt(context.maxAmountPerPayment)) {
      throw new Error(`upto: cap ${requirements.amount} exceeds the spend limit ${context.maxAmountPerPayment}`);
    }
    const server = this.server(requirements.network);
    await this.checkCanonical(server, passphrase, requirements);

    const payload = await buildSignedPayload({ signer: this.signer, requirements, server, passphrase });
    return { x402Version, payload: payload as unknown as Record<string, unknown> };
  }

  /** The payload's authorization id, derived by the escrow contract's own view. */
  async authorizationId(payload: UptoStellarPayload, requirements: PaymentRequirements): Promise<string> {
    const passphrase = this.validate(requirements);
    const id = await authorizationId(
      this.server(requirements.network),
      passphrase,
      String(requirements.extra.contract),
      authorizationToScVal(payload.authorization),
    );
    return id.toString("hex");
  }

  private validate(requirements: PaymentRequirements): string {
    if (requirements.scheme !== SCHEME) throw new Error(`upto: unsupported scheme ${requirements.scheme}`);
    const passphrase = NETWORK_PASSPHRASES[requirements.network];
    if (!passphrase) throw new Error(`upto: unsupported network ${requirements.network}`);
    if (!/^[1-9][0-9]*$/.test(requirements.amount)) throw new Error(`upto: invalid cap ${requirements.amount}`);
    if (typeof requirements.extra?.contract !== "string") throw new Error("upto: requirements carry no extra.contract");
    if (typeof requirements.extra?.facilitatorAddress !== "string") {
      throw new Error("upto: requirements carry no extra.facilitatorAddress; the facilitator must publish one");
    }
    return passphrase;
  }

  /** Refuses requirements whose escrow contract is not the one the registry names. */
  private async checkCanonical(server: rpc.Server, passphrase: string, requirements: PaymentRequirements) {
    const registry = this.options.registry === false ? undefined : (this.options.registry ?? DEPLOYMENTS[requirements.network]?.registry);
    if (!registry) return;
    const resolved = await resolveDeployment(server, passphrase, registry, requirements.asset);
    if (!resolved.ok) throw new Error(`upto: the registry does not resolve ${requirements.asset}: ${resolved.message}`);
    if (resolved.value !== requirements.extra.contract) {
      throw new Error(`upto: ${String(requirements.extra.contract)} is not the canonical deployment ${resolved.value}`);
    }
  }

  private server(network: Network): rpc.Server {
    return this.options.server ?? new rpc.Server(getRpcUrl(network, { url: this.options.rpcUrl }));
  }
}

export type { UptoStellarPayload, UptoAuthorization } from "../../shared/encoding.js";
