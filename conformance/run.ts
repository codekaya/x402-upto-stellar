/**
 * Conformance runner for the x402 `upto` scheme on Stellar.
 *
 * Executes every case in vectors.json against a live deployment through the
 * reference facilitator and prints one line per case. Each case starts from a
 * fresh, valid payment signed by a funded payer, applies one change, and runs
 * verify or settle. Results, with every settlement hash, go to RESULTS.md.
 *
 *   npx tsx conformance/run.ts [--contract C…] [--registry C…|none] [--rpc URL]
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Address, Asset, BASE_FEE, Keypair, Networks, Operation, StrKey, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { createEd25519Signer, type ClientStellarSigner, type FacilitatorStellarSigner } from "@x402/stellar";

import { DEPLOYMENTS } from "../packages/x402-upto-stellar/src/shared/constants.js";
import { authorizationId, balanceOf, isConsumed } from "../packages/x402-upto-stellar/src/shared/chain.js";
import { authorizationToScVal, contractCall, i128, type UptoAuthorization, type UptoStellarPayload } from "../packages/x402-upto-stellar/src/shared/encoding.js";
import { buildSignedPayload, type BuildPayloadOptions } from "../packages/x402-upto-stellar/src/shared/payload.js";
import { UptoStellarScheme, type UptoFacilitatorOptions } from "../packages/x402-upto-stellar/src/upto/facilitator/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const RPC_URL = arg("rpc") ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const CONTRACT = arg("contract") ?? DEPLOYMENTS["stellar:testnet"].contract!;
const REGISTRY = arg("registry") === "none" ? false : (arg("registry") ?? DEPLOYMENTS["stellar:testnet"].registry!);
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const EXPLORER = "https://stellar.expert/explorer/testnet/tx";

const server = new rpc.Server(RPC_URL);

interface Case {
  id: string;
  phase: "verify" | "settle";
  change?: {
    x402Version?: number;
    requirements?: Partial<PaymentRequirements>;
    accepted?: Partial<PaymentRequirements>;
    payload?: unknown;
    signature?: string;
    contract?: string;
    payTo?: "payee_without_trustline";
    signer?: "facilitator" | "unfunded_payer";
    authorization?: Partial<UptoAuthorization>;
    window?: { after: number; before: number };
    entry?: "source_account_credentials" | "other_address" | "unsigned" | "tree_with_amount" | "expiration_too_far" | "forged_signature";
    facilitator?: UptoFacilitatorOptions;
  };
  settle?: { amount: string; payTo?: string; then?: "same_amount" | "other_amount" | "fresh_facilitator" };
  expect: Record<string, unknown>;
}

const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8")) as {
  base: Omit<PaymentRequirements, "payTo" | "extra">;
  cases: Case[];
};

// --- accounts ---------------------------------------------------------------

async function fund(kp: Keypair) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
}

async function classic(kp: Keypair, ops: xdr.Operation[]) {
  const builder = new TransactionBuilder(await server.getAccount(kp.publicKey()), { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(60).build();
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`setup ${sent.hash} ${final.status}`);
  return sent.hash;
}

const keys = {
  facilitator: Keypair.random(),
  payer: Keypair.random(),
  payee: Keypair.random(),
  payeeWithoutTrustline: Keypair.random(),
  unfundedPayer: Keypair.random(),
};
const signers = {
  facilitator: createEd25519Signer(keys.facilitator.secret(), "stellar:testnet") as FacilitatorStellarSigner,
  payer: createEd25519Signer(keys.payer.secret(), "stellar:testnet") as ClientStellarSigner,
  unfundedPayer: createEd25519Signer(keys.unfundedPayer.secret(), "stellar:testnet") as ClientStellarSigner,
};
const setupHashes: [string, string][] = [];

async function setup() {
  await Promise.all(Object.values(keys).map(fund));
  setupHashes.push([
    "payer: USDC trustline, 100 XLM → USDC",
    await classic(keys.payer, [
      Operation.changeTrust({ asset: USDC }),
      Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: "100", destination: keys.payer.publicKey(), destAsset: USDC, destMin: "5", path: [] }),
    ]),
  ]);
  setupHashes.push(["payee: USDC trustline", await classic(keys.payee, [Operation.changeTrust({ asset: USDC })])]);
}

// --- building a case ----------------------------------------------------------

const randomAccount = () => Keypair.random().publicKey();
const substitute = <T extends Record<string, unknown>>(o: T | undefined): T | undefined =>
  o && (Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === "$random_account" ? randomAccount() : v])) as T);

function baseRequirements(): PaymentRequirements {
  return {
    ...vectors.base,
    payTo: keys.payee.publicKey(),
    extra: { contract: CONTRACT, facilitatorAddress: keys.facilitator.publicKey(), areFeesSponsored: true },
  } as PaymentRequirements;
}

async function buildCase(c: Case): Promise<{ payload: PaymentPayload; requirements: PaymentRequirements; accepted: PaymentRequirements }> {
  const change = c.change ?? {};
  let accepted = baseRequirements();
  if (change.contract) accepted = { ...accepted, extra: { ...accepted.extra, contract: change.contract } };
  if (change.payTo === "payee_without_trustline") accepted = { ...accepted, payTo: keys.payeeWithoutTrustline.publicKey() };
  const requirements = { ...accepted, ...change.requirements };
  accepted = { ...accepted, ...change.accepted };

  const latest = await server.getLatestLedger();
  const now = Number(latest.closeTime);
  const options: BuildPayloadOptions = {
    signer: change.signer ? signers[change.signer === "facilitator" ? "facilitator" : "unfundedPayer"] : signers.payer,
    requirements: change.requirements?.network ? baseRequirements() : accepted,
    server,
    passphrase: PASSPHRASE,
    overrides: substitute(change.authorization as Record<string, unknown>) as Partial<UptoAuthorization>,
  };
  if (change.window) {
    options.overrides = { ...options.overrides, validAfter: String(now + change.window.after), validBefore: String(now + change.window.before) };
  }
  if (change.entry === "unsigned") options.unsigned = true;
  if (change.entry === "expiration_too_far") options.expirationLedger = latest.sequence + 10_000;
  if (change.entry === "tree_with_amount") {
    options.invocation = (contract, a) =>
      contractCall(contract, "settle_signed", [authorizationToScVal(a), i128(a.maxAmount)], [
        contractCall(a.token, "transfer", [new Address(a.payer).toScVal(), new Address(contract).toScVal(), i128(a.maxAmount)]),
      ]);
  }

  let raw: unknown = await buildSignedPayload(options);
  const p = raw as UptoStellarPayload;
  if (change.entry === "source_account_credentials" || change.entry === "other_address" || change.entry === "forged_signature") {
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(p.signature, "base64");
    let changed = entry;
    if (change.entry === "source_account_credentials") {
      changed = new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: entry.rootInvocation() });
    } else if (change.entry === "other_address") {
      entry.credentials().address().address(new Address(randomAccount()).toScAddress());
    } else {
      // Same key and shape, signature bytes that the key never produced.
      entry.credentials().address().signature(
        xdr.ScVal.scvVec([
          xdr.ScVal.scvMap([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("public_key"), val: xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(p.authorization.payer)) }),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(randomBytes(64)) }),
          ]),
        ]),
      );
    }
    raw = { ...p, signature: changed.toXDR("base64") };
  }
  if (change.signature) raw = { ...p, signature: change.signature };
  if (change.payload) raw = change.payload;

  return {
    payload: { x402Version: change.x402Version ?? 2, accepted, payload: raw as Record<string, unknown> },
    requirements,
    accepted,
  };
}

// --- running ------------------------------------------------------------------

const shared = new UptoStellarScheme([signers.facilitator], { rpcUrl: RPC_URL, registry: REGISTRY });
const facilitatorFor = (c: Case) =>
  c.change?.facilitator ? new UptoStellarScheme([signers.facilitator], { rpcUrl: RPC_URL, registry: REGISTRY, ...c.change.facilitator }) : shared;

async function usdc(holder: string): Promise<bigint> {
  const read = await balanceOf(server, PASSPHRASE, USDC.contractId(PASSPHRASE), holder);
  return read.ok ? read.value : 0n;
}

interface Result {
  id: string;
  phase: string;
  pass: boolean;
  expected: string;
  actual: string;
  tx?: string;
}

async function runCase(c: Case): Promise<Result> {
  const { payload, requirements, accepted } = await buildCase(c);
  const facilitator = facilitatorFor(c);
  const expected = JSON.stringify(c.expect);
  const actual: Record<string, unknown> = {};
  let tx: string | undefined;

  if (c.phase === "verify") {
    const result: VerifyResponse = await facilitator.verify(payload, requirements);
    actual.isValid = result.isValid;
    if (!result.isValid) actual.invalidReason = result.invalidReason;
    if (result.invalidReason?.startsWith("unexpected")) actual.message = result.invalidMessage;
  } else {
    const s = c.settle!;
    const settleRequirements = { ...accepted, amount: s.amount, ...(s.payTo ? { payTo: s.payTo === "$random_account" ? randomAccount() : s.payTo } : {}) };
    const [payerBefore, payeeBefore] = [await usdc(keys.payer.publicKey()), await usdc(keys.payee.publicKey())];
    let result: SettleResponse = await facilitator.settle(payload, settleRequirements);
    tx = result.transaction || undefined;
    if (result.success) {
      actual.amount = result.amount;
      actual.payeeReceives = String((await usdc(keys.payee.publicKey())) - payeeBefore);
      actual.payerPays = String(payerBefore - (await usdc(keys.payer.publicKey())));
      const id = await authorizationId(server, PASSPHRASE, CONTRACT, authorizationToScVal((payload.payload as unknown as UptoStellarPayload).authorization));
      actual.consumed = await isConsumed(server, PASSPHRASE, CONTRACT, id);
    }
    if (s.then) {
      const first = result.transaction;
      const again =
        s.then === "same_amount"
          ? await facilitator.settle(payload, settleRequirements)
          : s.then === "other_amount"
            ? await facilitator.settle(payload, { ...settleRequirements, amount: "1500000" })
            : await new UptoStellarScheme([signers.facilitator], { rpcUrl: RPC_URL, registry: REGISTRY }).settle(payload, settleRequirements);
      result = again;
      actual.sameTransaction = again.success ? again.transaction === first : undefined;
    }
    actual.success = result.success;
    if (!result.success) actual.errorReason = result.errorReason;
    if (result.errorReason?.startsWith("unexpected")) actual.message = result.errorMessage;
  }

  const pass = Object.entries(c.expect).every(([k, v]) => actual[k] === v);
  return { id: c.id, phase: c.phase, pass, expected, actual: JSON.stringify(actual), tx };
}

async function main() {
  console.log(`upto conformance · contract ${CONTRACT} · registry ${REGISTRY || "none"} · ${RPC_URL}`);
  await setup();
  console.log(`facilitator ${keys.facilitator.publicKey()} · payer ${keys.payer.publicKey()} · payee ${keys.payee.publicKey()}\n`);

  const results: Result[] = [];
  for (const c of vectors.cases.filter((c) => !process.env.ONLY || c.id === process.env.ONLY)) {
    let r: Result;
    try {
      r = await runCase(c);
    } catch (error) {
      r = { id: c.id, phase: c.phase, pass: false, expected: JSON.stringify(c.expect), actual: `threw ${String(error)}` };
    }
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.phase.padEnd(6)} ${r.id.padEnd(30)} ${r.pass ? "" : `expected ${r.expected} got `}${r.actual}${r.tx ? `  ${EXPLORER}/${r.tx}` : ""}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} cases passed`);

  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "# Conformance results",
    "",
    `Run on ${date} against Stellar testnet by \`npx tsx conformance/run.ts\`.`,
    "",
    `- Escrow contract: \`${CONTRACT}\``,
    `- Registry: \`${REGISTRY || "none"}\``,
    `- Facilitator: \`${keys.facilitator.publicKey()}\`, payer \`${keys.payer.publicKey()}\`, payee \`${keys.payee.publicKey()}\``,
    "",
    `**${passed} of ${results.length} cases passed.**`,
    "",
    "| Case | Phase | Result | Outcome | Tx |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| \`${r.id}\` | ${r.phase} | ${r.pass ? "pass" : "**fail**"} | \`${r.actual.replace(/\|/g, "\\|")}\` | ${r.tx ? `[\`${r.tx.slice(0, 8)}…\`](${EXPLORER}/${r.tx})` : ""} |`),
    "",
    "Setup transactions:",
    "",
    ...setupHashes.map(([what, hash]) => `- ${what}: [\`${hash.slice(0, 8)}…\`](${EXPLORER}/${hash})`),
    "",
  ];
  writeFileSync(join(here, "RESULTS.md"), lines.join("\n"));
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
