import {
  Address,
  BASE_FEE,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { getAddressCredentials, getRpcUrl, type FacilitatorStellarSigner } from "@x402/stellar";

import { authorizationId, balanceOf, hostErrorOf, isConsumed, resolveDeployment } from "../../shared/chain.js";
import {
  CLOCK_ALLOWANCE_SECONDS,
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEPLOYMENTS,
  LEDGER_SECONDS,
  NETWORK_PASSPHRASES,
  SCHEME,
  X402_VERSION,
} from "../../shared/constants.js";
import {
  authorizationToScVal,
  i128,
  isUptoPayload,
  payerInvocation,
  resourceCommitment,
  sameRequirements,
  settlerEntry,
  type UptoAuthorization,
} from "../../shared/encoding.js";
import { Reason, reasonForHostError, type UptoReason } from "../../shared/reasons.js";

export interface UptoFacilitatorOptions {
  /** RPC endpoint. Defaults to the public testnet RPC; required for pubnet. */
  rpcUrl?: string;
  /** Registry that names canonical deployments. Defaults to the known one; `false` skips the check. */
  registry?: string | false;
  /** Refuse a settlement whose simulated fee exceeds this. Default 50,000 stroops, as `exact`. */
  maxTransactionFeeStroops?: number;
  /** Inclusion fee bid on top of the resource fee. Default 100 stroops. */
  inclusionFeeStroops?: number;
  /** How long a registry resolution is trusted. Default 300 seconds. */
  registryCacheSeconds?: number;
  /** Injected RPC client, for tests. */
  server?: rpc.Server;
}

/** Everything verification learned, reused by settlement. */
interface Checked {
  network: Network;
  passphrase: string;
  server: rpc.Server;
  contract: string;
  authorization: UptoAuthorization;
  entry: xdr.SorobanAuthorizationEntry;
  settler: FacilitatorStellarSigner;
  id: Buffer;
}

type Outcome = { ok: true; checked: Checked } | { ok: false; reason: UptoReason; message?: string; payer?: string };

const refuse = (reason: UptoReason, message?: string, payer?: string): Outcome => ({ ok: false, reason, message, payer });

/**
 * Facilitator side of the `upto` scheme on Stellar. Verifies in the spec's
 * cheapest-first order, ending in a simulated settlement at zero, and settles
 * by submitting `settle_signed` as the transaction source, so fees are always
 * sponsored. A settlement of zero is submitted, which burns the authorization.
 */
export class UptoStellarScheme implements SchemeNetworkFacilitator {
  readonly scheme = SCHEME;
  readonly caipFamily = "stellar:*";

  private readonly signers: Map<string, FacilitatorStellarSigner>;
  private readonly maxFee: number;
  private readonly inclusionFee: number;
  private readonly registryTtlMs: number;
  private readonly registryCache = new Map<string, { contract: string; at: number }>();
  /** Settlements submitted, by authorization id: the no-retry record. */
  private readonly submitted = new Map<string, { hash: string; amount: string }>();

  constructor(
    signers: FacilitatorStellarSigner[],
    private readonly options: UptoFacilitatorOptions = {},
  ) {
    if (signers.length === 0) throw new Error("upto: a facilitator needs at least one signer");
    this.signers = new Map(signers.map((signer) => [signer.address, signer]));
    this.maxFee = options.maxTransactionFeeStroops ?? DEFAULT_MAX_TRANSACTION_FEE_STROOPS;
    this.inclusionFee = options.inclusionFeeStroops ?? Number(BASE_FEE);
    this.registryTtlMs = (options.registryCacheSeconds ?? 300) * 1000;
  }

  getExtra(_network: Network): Record<string, unknown> | undefined {
    return { areFeesSponsored: true, facilitatorAddress: this.signers.keys().next().value };
  }

  getSigners(_network: string): string[] {
    return [...this.signers.keys()];
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    try {
      const outcome = await this.check(payload, requirements);
      if (!outcome.ok) {
        return { isValid: false, invalidReason: outcome.reason, invalidMessage: outcome.message, payer: outcome.payer };
      }
      return { isValid: true, payer: outcome.checked.authorization.payer };
    } catch (error) {
      return { isValid: false, invalidReason: Reason.unexpectedVerify, invalidMessage: String(error) };
    }
  }

  /**
   * Settles for `requirements.amount`, the measured usage. Every other field
   * must equal what the payer accepted, and the amount may not exceed the cap.
   */
  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const network = requirements.network as Network;
    const fail = (reason: string, message?: string, payer?: string): SettleResponse => ({
      success: false,
      errorReason: reason,
      errorMessage: message,
      payer,
      transaction: "",
      network,
    });

    try {
      const accepted = payload.accepted;
      if (!accepted || !sameRequirements(accepted, requirements, true)) return fail(Reason.requirementsMismatch);
      if (!/^(0|[1-9][0-9]*)$/.test(requirements.amount)) return fail(Reason.malformed, "settled amount is not an integer");
      if (BigInt(requirements.amount) > BigInt(accepted.amount)) return fail(Reason.settlementExceedsAmount);

      // An authorization this facilitator already submitted is polled, never resubmitted.
      const previous = await this.previousSubmission(payload, accepted);
      if (previous) {
        if (previous.amount !== requirements.amount) {
          return fail(Reason.alreadyConsumed, `already settled for ${previous.amount}; never retried with another amount`);
        }
        return this.await(previous.hash, network, payload, requirements.amount);
      }

      const outcome = await this.check(payload, accepted);
      if (!outcome.ok) return fail(outcome.reason, outcome.message, outcome.payer);
      const { checked } = outcome;
      const payer = checked.authorization.payer;

      const tx = await this.settlementTransaction(checked, requirements.amount);
      const sim = await checked.server.simulateTransaction(tx, undefined, "enforce");
      if (rpc.Api.isSimulationError(sim)) {
        const reason = reasonForHostError(hostErrorOf(sim.events, sim.error) ?? { type: "", code: "" }, checked.contract, checked.authorization.token);
        return fail(reason ?? Reason.transactionFailed, sim.error, payer);
      }
      if (!rpc.Api.isSimulationSuccess(sim)) return fail(Reason.transactionFailed, "simulation returned no result", payer);
      if (Number(sim.minResourceFee) + this.inclusionFee > this.maxFee) {
        return fail(Reason.feeExceedsMaximum, `fee ${Number(sim.minResourceFee) + this.inclusionFee} > ${this.maxFee}`, payer);
      }

      const assembled = rpc.assembleTransaction(tx, sim).build();
      const signed = await checked.settler.signTransaction(assembled.toXDR(), { networkPassphrase: checked.passphrase });
      if (signed.error) return fail(Reason.submissionFailed, signed.error.message, payer);
      const ready = TransactionBuilder.fromXDR(signed.signedTxXdr, checked.passphrase) as Transaction;

      const sent = await checked.server.sendTransaction(ready);
      if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
        return fail(Reason.submissionFailed, `${sent.status} ${sent.errorResult?.result().switch().name ?? ""}`.trim(), payer);
      }
      this.submitted.set(checked.id.toString("hex"), { hash: sent.hash, amount: requirements.amount });
      return this.await(sent.hash, network, payload, requirements.amount, checked);
    } catch (error) {
      return fail(Reason.unexpectedSettle, String(error));
    }
  }

  // --- verification ------------------------------------------------------

  private async check(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Outcome> {
    // 1–4: the envelope.
    if (payload.x402Version !== X402_VERSION) return refuse(Reason.invalidVersion);
    if (payload.accepted?.scheme !== SCHEME || requirements.scheme !== SCHEME) return refuse(Reason.unsupportedScheme);
    if (payload.accepted.network !== requirements.network) return refuse(Reason.networkMismatch);
    const network = requirements.network as Network;
    const passphrase = NETWORK_PASSPHRASES[network];
    if (!passphrase) return refuse(Reason.invalidNetwork);

    // 5: shape.
    const raw = payload.payload;
    const contract = requirements.extra?.contract;
    if (!isUptoPayload(raw) || typeof contract !== "string" || typeof requirements.extra?.facilitatorAddress !== "string") {
      return refuse(Reason.malformed);
    }
    const a = raw.authorization;
    let entry: xdr.SorobanAuthorizationEntry;
    try {
      entry = xdr.SorobanAuthorizationEntry.fromXDR(raw.signature, "base64");
      for (const address of [a.payer, a.payee, a.settler, a.token, contract]) new Address(address);
    } catch (error) {
      return refuse(Reason.malformed, String(error), a.payer);
    }

    // 6: the payload accepted exactly these requirements.
    if (!sameRequirements(payload.accepted, requirements)) return refuse(Reason.requirementsMismatch, undefined, a.payer);

    // 7: the escrow contract is the canonical one. First network read; cached.
    const server = this.options.server ?? new rpc.Server(getRpcUrl(network, { url: this.options.rpcUrl }));
    const canonical = await this.canonicalContract(server, network, passphrase, requirements.asset);
    if (canonical !== undefined && canonical !== contract) {
      return refuse(Reason.contractNotCanonical, `canonical deployment is ${canonical || "unregistered"}`, a.payer);
    }

    // 8–14: the authorization against the requirements.
    if (a.payee !== requirements.payTo) return refuse(Reason.wrongPayee, undefined, a.payer);
    if (a.token !== requirements.asset) return refuse(Reason.wrongAsset, undefined, a.payer);
    const settler = this.signers.get(a.settler);
    if (a.settler !== requirements.extra.facilitatorAddress || !settler) return refuse(Reason.wrongSettler, undefined, a.payer);
    if (this.signers.has(a.payer)) return refuse(Reason.facilitatorIsPayer, undefined, a.payer);
    if (a.maxAmount !== requirements.amount) return refuse(Reason.wrongAmount, undefined, a.payer);
    if (a.resource !== resourceCommitment(requirements)) return refuse(Reason.wrongResource, undefined, a.payer);
    if (BigInt(a.validBefore) - BigInt(a.validAfter) > BigInt(requirements.maxTimeoutSeconds + CLOCK_ALLOWANCE_SECONDS)) {
      return refuse(Reason.windowTooLong, undefined, a.payer);
    }

    // 15–16: the window against ledger time.
    const latest = await server.getLatestLedger();
    const now = BigInt(latest.closeTime);
    if (now < BigInt(a.validAfter)) return refuse(Reason.notYetValid, undefined, a.payer);
    if (now >= BigInt(a.validBefore)) return refuse(Reason.expired, undefined, a.payer);

    // 17–21: the entry.
    const credentials = getAddressCredentials(entry.credentials());
    if (!credentials) return refuse(Reason.unsupportedCredentialType, undefined, a.payer);
    if (Address.fromScAddress(credentials.address()).toString() !== a.payer) return refuse(Reason.wrongSigner, undefined, a.payer);
    if (!signaturePresent(credentials.signature())) return refuse(Reason.missingPayerSignature, undefined, a.payer);
    if (entry.rootInvocation().toXDR("base64") !== payerInvocation(contract, a).toXDR("base64")) {
      return refuse(Reason.wrongInvocation, undefined, a.payer);
    }
    const latestExpiry = latest.sequence + Math.ceil(requirements.maxTimeoutSeconds / LEDGER_SECONDS);
    if (credentials.signatureExpirationLedger() > latestExpiry) return refuse(Reason.signatureExpirationTooFar, undefined, a.payer);

    // 22–24: chain state.
    const authorization = authorizationToScVal(a);
    const id = await authorizationId(server, passphrase, contract, authorization);
    if (await isConsumed(server, passphrase, contract, id)) return refuse(Reason.alreadyConsumed, undefined, a.payer);
    const funds = await balanceOf(server, passphrase, a.token, a.payer);
    if (!funds.ok || funds.value < BigInt(a.maxAmount)) {
      return refuse(Reason.insufficientFunds, funds.ok ? `balance ${funds.value}` : funds.message, a.payer);
    }
    const payee = await balanceOf(server, passphrase, a.token, a.payee);
    if (!payee.ok) return refuse(Reason.payeeCannotReceive, payee.message, a.payer);

    // 25–26: settle at zero, in enforcing mode, under the fee ceiling.
    const checked: Checked = { network, passphrase, server, contract, authorization: a, entry, settler, id };
    const sim = await server.simulateTransaction(await this.settlementTransaction(checked, "0"), undefined, "enforce");
    if (rpc.Api.isSimulationError(sim)) {
      const reason = reasonForHostError(hostErrorOf(sim.events, sim.error) ?? { type: "", code: "" }, contract, a.token);
      return refuse(reason ?? Reason.simulationFailed, sim.error, a.payer);
    }
    if (Number(sim.minResourceFee) + this.inclusionFee > this.maxFee) {
      return refuse(Reason.feeExceedsMaximum, `simulated fee ${Number(sim.minResourceFee) + this.inclusionFee}`, a.payer);
    }
    return { ok: true, checked };
  }

  /** The registry's answer for `asset`: an address, "" when it refuses, undefined when no registry applies. */
  private async canonicalContract(server: rpc.Server, network: Network, passphrase: string, asset: string) {
    const registry = this.options.registry === false ? undefined : (this.options.registry ?? DEPLOYMENTS[network]?.registry);
    if (!registry) return undefined;
    const key = `${network}|${asset}`;
    const cached = this.registryCache.get(key);
    if (cached && Date.now() - cached.at < this.registryTtlMs) return cached.contract;
    const resolved = await resolveDeployment(server, passphrase, registry, asset);
    const contract = resolved.ok ? resolved.value : "";
    if (resolved.ok) this.registryCache.set(key, { contract, at: Date.now() });
    return contract;
  }

  // --- settlement ----------------------------------------------------------

  private async settlementTransaction(checked: Checked, settled: string): Promise<Transaction> {
    const { contract, authorization: a, entry, server, passphrase, settler } = checked;
    return new TransactionBuilder(await server.getAccount(settler.address), {
      fee: String(this.inclusionFee),
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract,
          function: "settle_signed",
          args: [authorizationToScVal(a), i128(settled)],
          auth: [entry, settlerEntry(contract, a, settled)],
        }),
      )
      .setTimeout(60)
      .build();
  }

  private async previousSubmission(payload: PaymentPayload, accepted: PaymentRequirements) {
    if (this.submitted.size === 0 || !isUptoPayload(payload.payload)) return undefined;
    const passphrase = NETWORK_PASSPHRASES[accepted.network];
    if (!passphrase || typeof accepted.extra?.contract !== "string") return undefined;
    const server = this.options.server ?? new rpc.Server(getRpcUrl(accepted.network, { url: this.options.rpcUrl }));
    const id = await authorizationId(server, passphrase, accepted.extra.contract, authorizationToScVal(payload.payload.authorization));
    return this.submitted.get(id.toString("hex"));
  }

  private async await(
    hash: string,
    network: Network,
    payload: PaymentPayload,
    amount: string,
    checked?: Checked,
  ): Promise<SettleResponse> {
    const raw = payload.payload as { authorization?: UptoAuthorization };
    const payer = raw.authorization?.payer;
    const server =
      checked?.server ?? this.options.server ?? new rpc.Server(getRpcUrl(network, { url: this.options.rpcUrl }));
    const final = await server.pollTransaction(hash, { attempts: 30 });
    if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { success: true, transaction: hash, network, payer, amount };
    }
    let reason: string = Reason.transactionFailed;
    if (final.status === rpc.Api.GetTransactionStatus.FAILED && raw.authorization) {
      const contract = String(payload.accepted.extra.contract);
      reason = reasonForHostError(hostErrorOf(final.diagnosticEventsXdr) ?? { type: "", code: "" }, contract, raw.authorization.token) ?? reason;
    }
    return { success: false, errorReason: reason, errorMessage: final.status, transaction: hash, network, payer };
  }
}

/** A credential node counts as signed unless its signature is void or an empty vec. */
function signaturePresent(signature: xdr.ScVal): boolean {
  const kind = signature.switch().name;
  if (kind === "scvVoid") return false;
  if (kind === "scvVec") return (signature.vec() ?? []).length > 0;
  return true;
}

export { Reason } from "../../shared/reasons.js";
