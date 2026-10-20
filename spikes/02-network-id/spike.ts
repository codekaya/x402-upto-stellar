/**
 * Spike 2: the network identity a contract sees.
 *
 * Reads `env.ledger().network_id()` from a probe contract deployed on testnet
 * and compares it with the hash of each network passphrase. Then lands a
 * refusal keyed on it as a failed transaction, which is how every negative
 * case of the registry has to be evidenced: simulation alone leaves no hash.
 */
import {
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  hash,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const EXPLORER = "https://stellar.expert/explorer/testnet";
const PROBE = "CAEZC6F4DKZJU5IEOLBQ5XKQWGCNZA6U45KHPKEDKPB35UF3DJCK4WMX";

const TESTNET_ID = Buffer.from(hash(Buffer.from(Networks.TESTNET)));
const PUBNET_ID = Buffer.from(hash(Buffer.from(Networks.PUBLIC)));

const server = new rpc.Server(RPC_URL);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

function hostError(sim: rpc.Api.SimulateTransactionResponse): string | null {
  if (!rpc.Api.isSimulationError(sim)) return null;
  return sim.error.match(/Error\([^)]*\)/)?.[0] ?? sim.error.split("\n")[0];
}

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString("hex") : x));

async function call(source: Keypair, fn: string, args: xdr.ScVal[]) {
  const account = await server.getAccount(source.publicKey());
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: PROBE, function: fn, args }))
    .setTimeout(60)
    .build();
}

async function main() {
  const caller = Keypair.random();
  const funded = await fetch(`${FRIENDBOT}?addr=${caller.publicKey()}`);
  if (!funded.ok) throw new Error(`friendbot ${funded.status}`);

  console.log("1. what the contract sees");
  const sim = await server.simulateTransaction(await call(caller, "network_id", []));
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`network_id: ${hostError(sim)}`);
  const seen = Buffer.from(scValToNative(sim.result.retval));
  console.log(`  network_id()                 ${seen.toString("hex")}`);
  console.log(`  sha256(testnet passphrase)   ${TESTNET_ID.toString("hex")}`);
  console.log(`  sha256(pubnet passphrase)    ${PUBNET_ID.toString("hex")}`);
  check("the contract sees sha256 of the testnet passphrase", seen.equals(TESTNET_ID));
  check("which is not the pubnet id", !seen.equals(PUBNET_ID));

  console.log("\n2. the comparison a registry record would make");
  const okSim = await server.simulateTransaction(await call(caller, "require_network", [xdr.ScVal.scvBytes(TESTNET_ID)]));
  check("require_network(testnet) succeeds", hostError(okSim) === null, hostError(okSim) ?? "");
  const noSim = await server.simulateTransaction(await call(caller, "require_network", [xdr.ScVal.scvBytes(PUBNET_ID)]));
  check("require_network(pubnet) refuses with the typed error", hostError(noSim) === "Error(Contract, #1)", hostError(noSim) ?? "succeeded");

  console.log("\n3. landing the refusal on-chain");
  // A failing simulation returns no footprint, so borrow the one from the
  // succeeding call (same contract, same entries) with headroom, and submit.
  if (!rpc.Api.isSimulationSuccess(okSim)) throw new Error("no footprint to borrow");
  const borrowed = okSim.transactionData.build();
  const data = new SorobanDataBuilder(borrowed)
    .setResources(
      Math.ceil(borrowed.resources.instructions * 1.5),
      borrowed.resources.diskReadBytes,
      borrowed.resources.writeBytes,
    )
    .setResourceFee(BigInt(okSim.minResourceFee) * 2n)
    .build();
  const account = await server.getAccount(caller.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.invokeContractFunction({ contract: PROBE, function: "require_network", args: [xdr.ScVal.scvBytes(PUBNET_ID)] }),
    )
    .setSorobanData(data)
    .setTimeout(60)
    .build();
  tx.sign(caller);

  const sent = await server.sendTransaction(tx);
  check("the network accepts the transaction for inclusion", sent.status === "PENDING", sent.status);
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  check("it lands as a failed transaction", final.status === rpc.Api.GetTransactionStatus.FAILED, final.status);
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    const outer = final.resultXdr.result;
    const opResult = json(outer.toXdrObject());
    console.log(`  result ${outer.type}, fee ${final.resultXdr.feeCharged} stroops, ledger ${final.ledger}`);
    console.log(`  op result ${opResult.slice(0, 160)}`);
    const errors = (final.diagnosticEventsXdr ?? [])
      .flatMap((e) => (e.event.body as any).v0?.topics ?? [])
      .filter((t: xdr.ScVal) => t.type === "scvError")
      .map((t: xdr.ScVal) => json(t.toXdrObject()));
    console.log(`  error topics ${errors.length ? [...new Set(errors)].join(" ") : "(no diagnostic events returned)"}`);
    check(
      "the failure is the typed contract error, not a resource limit",
      errors.some((e) => e.includes('"contractCode":1')) || opResult.includes("Trapped"),
      opResult.includes("ResourceLimitExceeded") ? "resource limit" : "",
    );
  }
  console.log(`\n${EXPLORER}/tx/${sent.hash}`);
  console.log(failures === 0 ? "spike 2: all checks passed" : `spike 2: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
