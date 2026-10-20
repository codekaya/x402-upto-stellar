/**
 * Follow-up to Spike 1, run while rebasing the spec: does the zero-amount
 * verification simulation catch a payee that cannot receive the token?
 *
 * The payee here has no USDC trustline. Everything is simulated except the
 * payer's setup transaction (trustline and a DEX purchase of USDC).
 */
import { randomBytes } from "node:crypto";
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const PASSPHRASE = Networks.TESTNET;
const UPTO = "CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const TOKEN = USDC.contractId(PASSPHRASE);
const CAP = 50_000_000n;

const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const addr = (a: string) => new Address(a).toScVal();

function fn(contract: string, functionName: string, args: xdr.ScVal[], sub: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName, args }),
    ),
    subInvocations: sub,
  });
}

async function fund(kp: Keypair) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
}

async function invoke(source: Keypair, contract: string, name: string, args: xdr.ScVal[], auth: xdr.SorobanAuthorizationEntry[] = []) {
  const tx = new TransactionBuilder(await server.getAccount(source.publicKey()), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract, function: name, args, auth }))
    .setTimeout(60)
    .build();
  return server.simulateTransaction(tx, undefined, auth.length ? "enforce" : undefined);
}

/** The host error, and which contract raised it, from the simulation's diagnostic events. */
function describe(sim: rpc.Api.SimulateTransactionResponse): string {
  if (!rpc.Api.isSimulationError(sim)) return "succeeds";
  const code = sim.error.match(/Error\([^)]*\)/)?.[0] ?? sim.error.split("\n")[0];
  const raisers = (sim.events ?? [])
    .filter((e) => (e.event.body as any).v0?.topics?.some((t: xdr.ScVal) => t.type === "scvError"))
    .map((e) => (e.event.contractId ? StrKey.encodeContract(Buffer.from(e.event.contractId.toXDR())) : "host"));
  return `${code} raised by ${[...new Set(raisers)].map((r) => (r === UPTO ? "upto" : r === TOKEN ? "USDC SAC" : r)).join(" -> ") || "?"}`;
}

async function main() {
  const [payer, payee, settler] = [Keypair.random(), Keypair.random(), Keypair.random()];
  await Promise.all([fund(payer), fund(payee), fund(settler)]);

  const setup = new TransactionBuilder(await server.getAccount(payer.publicKey()), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .addOperation(Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: "100", destination: payer.publicKey(), destAsset: USDC, destMin: "6", path: [] }))
    .setTimeout(60)
    .build();
  setup.sign(payer);
  const sent = await server.sendTransaction(setup);
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`setup ${done.status}`);
  console.log(`payer setup ${sent.hash}`);
  console.log(`payee ${payee.publicKey()} has no USDC trustline`);

  const latest = await server.getLatestLedger();
  const now = BigInt(latest.closeTime);
  const authorization = xdr.ScVal.scvMap(
    ([
      ["max_amount", i128(CAP)],
      ["nonce", xdr.ScVal.scvBytes(randomBytes(32))],
      ["payee", addr(payee.publicKey())],
      ["payer", addr(payer.publicKey())],
      ["resource", xdr.ScVal.scvBytes(randomBytes(32))],
      ["settler", addr(settler.publicKey())],
      ["token", addr(TOKEN)],
      ["valid_after", nativeToScVal(now - 30n, { type: "u64" })],
      ["valid_before", nativeToScVal(now + 600n, { type: "u64" })],
    ] as [string, xdr.ScVal][]).map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v })),
  );
  const entry = await authorizeEntry(
    new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new xdr.SorobanAddressCredentials({
          address: new Address(payer.publicKey()).toScAddress(),
          nonce: xdr.Int64.fromString(randomBytes(8).readBigInt64BE().toString()),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: fn(UPTO, "settle_signed", [authorization], [fn(TOKEN, "transfer", [addr(payer.publicKey()), addr(UPTO), i128(CAP)])]),
    }),
    payer,
    latest.sequence + 130,
    PASSPHRASE,
  );

  for (const settled of [0n, 1n, 20_000_000n]) {
    const settlerEntry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: fn(UPTO, "settle_signed", [authorization, i128(settled)]),
    });
    const sim = await invoke(settler, UPTO, "settle_signed", [authorization, i128(settled)], [entry, settlerEntry]);
    console.log(`settle_signed(…, ${settled}) ${describe(sim)}`);
  }
  console.log(`USDC.balance(payee) ${describe(await invoke(settler, TOKEN, "balance", [addr(payee.publicKey())]))}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
