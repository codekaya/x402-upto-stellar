/**
 * Spike 1: two signers in one transaction.
 *
 * The payer signs a `settle_signed` authorization entry offline with
 * `authorizeEntry`. The entry covers the payload and the nested escrow
 * transfer, and deliberately not the settled amount. The settler receives only
 * the encoded `X-PAYMENT` header, names the amount, signs the transaction as
 * its source account and submits it against the live contract on testnet.
 *
 * Throwaway accounts are generated and funded through friendbot on every run;
 * no secret is written anywhere. The token is the native XLM SAC, which every
 * funded account can spend without a trustline.
 */
import { randomBytes } from "node:crypto";
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  hash,
  inspectAuthEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const EXPLORER = "https://stellar.expert/explorer/testnet";

const UPTO = "CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB";
const TOKEN = Asset.native().contractId(PASSPHRASE);

const CAP = 50_000_000n; // 5 XLM, the ceiling the payer authorizes
const SETTLED = 20_000_000n; // 2 XLM, what the meter says was used
const WINDOW_SECONDS = 600n;
const SECONDS_PER_LEDGER = 5n;

const server = new rpc.Server(RPC_URL);

interface Authorization {
  payer: string;
  payee: string;
  settler: string;
  token: string;
  maxAmount: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Buffer;
  resource: Buffer;
}

// --- encoding ----------------------------------------------------------

/** `#[contracttype]` structs encode as an ScMap with symbol keys in sorted order. */
function authorizationScVal(a: Authorization): xdr.ScVal {
  const fields: [string, xdr.ScVal][] = [
    ["max_amount", nativeToScVal(a.maxAmount, { type: "i128" })],
    ["nonce", xdr.ScVal.scvBytes(a.nonce)],
    ["payee", new Address(a.payee).toScVal()],
    ["payer", new Address(a.payer).toScVal()],
    ["resource", xdr.ScVal.scvBytes(a.resource)],
    ["settler", new Address(a.settler).toScVal()],
    ["token", new Address(a.token).toScVal()],
    ["valid_after", nativeToScVal(a.validAfter, { type: "u64" })],
    ["valid_before", nativeToScVal(a.validBefore, { type: "u64" })],
  ];
  return xdr.ScVal.scvMap(
    fields.map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })),
  );
}

function i128(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}

function contractFn(
  contract: string,
  functionName: string,
  args: xdr.ScVal[],
  subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName,
        args,
      }),
    ),
    subInvocations,
  });
}

/** The tree the spec requires the payer to sign: the payload, then the escrow pull of the cap. */
function payerTree(a: Authorization): xdr.SorobanAuthorizedInvocation {
  return contractFn(UPTO, "settle_signed", [authorizationScVal(a)], [
    contractFn(TOKEN, "transfer", [
      new Address(a.payer).toScVal(),
      new Address(UPTO).toScVal(),
      i128(a.maxAmount),
    ]),
  ]);
}

// --- payer side ----------------------------------------------------------

/**
 * Everything the payer does. It could run in a browser or an agent: no
 * transaction is built and nothing is submitted, and the only network input is
 * the latest ledger, used to set the signature expiry to roughly `validBefore`.
 */
async function payerSigns(
  payer: Keypair,
  a: Authorization,
  latest: rpc.Api.GetLatestLedgerResponse,
  credentialsV2 = true,
): Promise<string> {
  const credentials = new xdr.SorobanAddressCredentials({
    address: new Address(payer.publicKey()).toScAddress(),
    nonce: xdr.Int64.fromString(randomBytes(8).readBigInt64BE().toString()),
    signatureExpirationLedger: 0,
    signature: xdr.ScVal.scvVoid(),
  });
  const unsigned = new xdr.SorobanAuthorizationEntry({
    credentials: credentialsV2
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials)
      : xdr.SorobanCredentials.sorobanCredentialsAddress(credentials),
    rootInvocation: payerTree(a),
  });

  const ledgersLeft = (a.validBefore - BigInt(latest.closeTime)) / SECONDS_PER_LEDGER;
  const validUntil = latest.sequence + Number(ledgersLeft) + 1;
  const signed = await authorizeEntry(unsigned, payer, validUntil, PASSPHRASE);

  return encodeHeader(a, signed);
}

function encodeHeader(a: Authorization, entry: xdr.SorobanAuthorizationEntry): string {
  const body = {
    x402Version: 1,
    scheme: "upto",
    network: "stellar-testnet",
    payload: {
      contract: UPTO,
      authorization: {
        payer: a.payer,
        payee: a.payee,
        settler: a.settler,
        token: a.token,
        maxAmount: a.maxAmount.toString(),
        validAfter: a.validAfter.toString(),
        validBefore: a.validBefore.toString(),
        nonce: a.nonce.toString("hex"),
        resource: a.resource.toString("hex"),
      },
      signature: entry.toXDR("base64"),
    },
  };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

// --- settler side --------------------------------------------------------

interface Decoded {
  authorization: Authorization;
  entry: xdr.SorobanAuthorizationEntry;
}

function decodeHeader(header: string): Decoded {
  const { payload } = JSON.parse(Buffer.from(header, "base64").toString());
  const raw = payload.authorization;
  return {
    authorization: {
      payer: raw.payer,
      payee: raw.payee,
      settler: raw.settler,
      token: raw.token,
      maxAmount: BigInt(raw.maxAmount),
      validAfter: BigInt(raw.validAfter),
      validBefore: BigInt(raw.validBefore),
      nonce: Buffer.from(raw.nonce, "hex"),
      resource: Buffer.from(raw.resource, "hex"),
    },
    entry: xdr.SorobanAuthorizationEntry.fromXDR(payload.signature, "base64"),
  };
}

/** The settler's own authorization: source-account credentials over the full call, amount included. */
async function buildSettlement(
  settler: Keypair,
  a: Authorization,
  settled: bigint,
  payerEntry: xdr.SorobanAuthorizationEntry,
): Promise<Transaction> {
  const args = [authorizationScVal(a), i128(settled)];
  const settlerEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: contractFn(UPTO, "settle_signed", args),
  });
  const account = await server.getAccount(settler.publicKey());
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.invokeContractFunction({
        contract: UPTO,
        function: "settle_signed",
        args,
        auth: [payerEntry, settlerEntry],
      }),
    )
    .setTimeout(120)
    .build();
}

/** Simulates in enforcing mode, so every signature in the entries is actually checked. */
async function simulate(tx: Transaction) {
  return server.simulateTransaction(tx, undefined, "enforce");
}

function hostError(sim: rpc.Api.SimulateTransactionResponse): string | null {
  if (!rpc.Api.isSimulationError(sim)) return null;
  return sim.error.match(/Error\([^)]*\)/)?.[0] ?? sim.error.split("\n")[0];
}

// --- helpers -------------------------------------------------------------

async function fund(kp: Keypair): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status} for ${kp.publicKey()}`);
}

async function view(source: string, contract: string, fn: string, args: xdr.ScVal[]) {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract, function: fn, args }))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`${fn} view failed: ${hostError(sim)}`);
  }
  return scValToNative(sim.result.retval);
}

const xlm = (stroops: bigint) => `${(Number(stroops) / 1e7).toFixed(7)} XLM`;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

// --- the spike -----------------------------------------------------------

async function main() {
  const payer = Keypair.random();
  const payee = Keypair.random();
  const settler = Keypair.random();
  await Promise.all([fund(payer), fund(payee), fund(settler)]);
  console.log("accounts (fresh, friendbot-funded)");
  console.log(`  payer    ${payer.publicKey()}`);
  console.log(`  payee    ${payee.publicKey()}`);
  console.log(`  settler  ${settler.publicKey()}`);
  console.log(`  token    ${TOKEN} (native XLM SAC)`);
  console.log(`  upto     ${UPTO}`);

  const latest = await server.getLatestLedger();
  const now = BigInt(latest.closeTime);
  const accepts = { scheme: "upto", network: "stellar-testnet", maxAmountRequired: CAP.toString(), payTo: payee.publicKey(), asset: TOKEN, extra: { contract: UPTO, settler: settler.publicKey() } };
  const authorization: Authorization = {
    payer: payer.publicKey(),
    payee: payee.publicKey(),
    settler: settler.publicKey(),
    token: TOKEN,
    maxAmount: CAP,
    validAfter: now - 30n,
    validBefore: now + WINDOW_SECONDS,
    nonce: randomBytes(32),
    resource: Buffer.from(hash(Buffer.from(JSON.stringify(accepts)))),
  };

  // 1. Payer signs, offline. Only a header string leaves this step.
  console.log("\n1. payer signs the payload with authorizeEntry");
  const header = await payerSigns(payer, authorization, latest);
  console.log(`  X-PAYMENT header: ${header.length} chars`);

  // 2. Settler decodes the header. From here on the payer key is out of scope.
  console.log("\n2. settler decodes the header and checks the entry shape");
  const { authorization: a, entry } = decodeHeader(header);
  const info = inspectAuthEntry(entry);
  check("entry is signed by the payer", info.signed && info.address === a.payer, info.credentialType);
  check(
    "entry tree is exactly settle_signed(authorization) -> transfer(payer, upto, cap)",
    info.invocation.toXDR("base64") === payerTree(a).toXDR("base64"),
  );

  // Ask the host what it wants signed, and compare with what the spec says.
  const recordTx = new TransactionBuilder(await server.getAccount(settler.publicKey()), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: UPTO, function: "settle_signed", args: [authorizationScVal(a), i128(SETTLED)] }))
    .setTimeout(30)
    .build();
  const recorded = await server.simulateTransaction(recordTx, undefined, "record");
  const recordedPayer = rpc.Api.isSimulationSuccess(recorded)
    ? recorded.result?.auth.find((e) => inspectAuthEntry(e).address === a.payer)
    : undefined;
  check(
    "host-recorded payer tree equals the spec tree (settled amount absent)",
    recordedPayer?.rootInvocation.toXDR("base64") === payerTree(a).toXDR("base64"),
  );

  const id = Buffer.from(await view(settler.publicKey(), UPTO, "authorization_id", [authorizationScVal(a)]));
  console.log(`  authorization id ${id.toString("hex")}`);

  // 3. One signature, any amount within the cap.
  console.log("\n3. the same payer entry, simulated against different settled amounts");
  for (const settled of [0n, SETTLED, CAP]) {
    const sim = await simulate(await buildSettlement(settler, a, settled, entry));
    check(`settle_signed(…, ${xlm(settled)}) simulates`, hostError(sim) === null, hostError(sim) ?? "");
  }
  const over = await simulate(await buildSettlement(settler, a, CAP + 1n, entry));
  check("settling above the cap is refused by the contract", hostError(over) === "Error(Contract, #9)", hostError(over) ?? "succeeded");

  // 4. The settler cannot touch the payer's half.
  console.log("\n4. the settler tries to rewrite the payer's half");
  const redirected = { ...a, payee: settler.publicKey() };
  const sim4a = await simulate(await buildSettlement(settler, redirected, SETTLED, entry));
  check("redirecting the payee breaks the payer's authorization", hostError(sim4a)?.startsWith("Error(Auth") ?? false, hostError(sim4a) ?? "succeeded");
  const raised = { ...a, maxAmount: CAP * 2n };
  const sim4b = await simulate(await buildSettlement(settler, raised, CAP + 1n, entry));
  check("raising the cap breaks the payer's authorization", hostError(sim4b)?.startsWith("Error(Auth") ?? false, hostError(sim4b) ?? "succeeded");

  // Legacy (pre-CAP-71) address credentials, for wallets that still produce them.
  const legacyHeader = await payerSigns(payer, authorization, latest, false);
  const legacy = decodeHeader(legacyHeader);
  const sim4c = await simulate(await buildSettlement(settler, legacy.authorization, SETTLED, legacy.entry));
  check("a legacy v1 address-credential entry is accepted too", hostError(sim4c) === null, hostError(sim4c) ?? inspectAuthEntry(legacy.entry).credentialType);

  // 5. Build the real settlement and sign it as the settler.
  console.log("\n5. settler names the amount, signs the envelope, submits");
  const tx = await buildSettlement(settler, a, SETTLED, entry);
  const sim = await simulate(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`settlement simulation failed: ${hostError(sim)}`);
  const ready = rpc.assembleTransaction(tx, sim).build();
  ready.sign(settler);
  const { resources } = sim.transactionData.build();
  console.log(`  instructions ${resources.instructions}, disk read ${resources.diskReadBytes} B, write ${resources.writeBytes} B, resource fee ${sim.minResourceFee} stroops`);

  // The payer's half is the entry; the settler's half is the envelope. Changing
  // the amount after the settler signed must invalidate the transaction.
  // Same source and sequence, amount raised to the cap, the settler's signature carried over.
  const tamperedTx = rpc.assembleTransaction(await buildSettlement(settler, a, CAP, entry), sim).build();
  tamperedTx.signatures.push(...ready.signatures);
  const rejected = await server.sendTransaction(tamperedTx);
  const code = rejected.errorResult?.result.type;
  check("changing the amount after the settler signed is rejected", rejected.status === "ERROR" && code === "txBadAuth", `${rejected.status} ${code ?? ""}`);

  const before = {
    payer: await view(settler.publicKey(), TOKEN, "balance", [new Address(a.payer).toScVal()]) as bigint,
    payee: await view(settler.publicKey(), TOKEN, "balance", [new Address(a.payee).toScVal()]) as bigint,
    upto: await view(settler.publicKey(), TOKEN, "balance", [new Address(UPTO).toScVal()]) as bigint,
  };

  const sent = await server.sendTransaction(ready);
  if (sent.status !== "PENDING") throw new Error(`send failed: ${sent.status} ${sent.errorResult?.result.type}`);
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`settlement ${final.status}`);

  const settlement = scValToNative(final.returnValue!);
  const after = {
    payer: await view(settler.publicKey(), TOKEN, "balance", [new Address(a.payer).toScVal()]) as bigint,
    payee: await view(settler.publicKey(), TOKEN, "balance", [new Address(a.payee).toScVal()]) as bigint,
    upto: await view(settler.publicKey(), TOKEN, "balance", [new Address(UPTO).toScVal()]) as bigint,
  };
  console.log(`  tx ${sent.hash} in ledger ${final.ledger}, fee ${final.resultXdr.feeCharged} stroops`);
  console.log(`  returned settled=${xlm(settlement.settled)} refunded=${xlm(settlement.refunded)}`);
  check("payee received exactly the settled amount", after.payee - before.payee === SETTLED, xlm(after.payee - before.payee));
  check("payer is down exactly the settled amount (cap pulled, remainder refunded)", before.payer - after.payer === SETTLED, xlm(before.payer - after.payer));
  check("refund equals cap minus settled", settlement.refunded === CAP - SETTLED);
  check("contract holds nothing afterwards", after.upto === before.upto, xlm(after.upto));

  // 6. Replay behaviour, which decides part of the facilitator's error mapping.
  console.log("\n6. replay");
  check("authorization id is consumed", await view(settler.publicKey(), UPTO, "is_consumed", [xdr.ScVal.scvBytes(id)]) === true);
  const replay = await simulate(await buildSettlement(settler, a, SETTLED, entry));
  console.log(`  same header again        -> ${hostError(replay) ?? "succeeded"}`);
  const resigned = decodeHeader(await payerSigns(payer, authorization, await server.getLatestLedger()));
  const replay2 = await simulate(await buildSettlement(settler, resigned.authorization, SETTLED, resigned.entry));
  console.log(`  same payload, new entry  -> ${hostError(replay2) ?? "succeeded"}`);
  check("re-signed payload hits AlreadyConsumed", hostError(replay2) === "Error(Contract, #7)");

  console.log(`\n${EXPLORER}/tx/${sent.hash}`);
  console.log(failures === 0 ? "spike 1: all checks passed" : `spike 1: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
