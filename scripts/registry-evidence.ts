/**
 * Registry evidence: lands the three refusals the award is checked against as
 * failed testnet transactions, decodes each one's error from RPC on the day
 * (the explorer shows only "Failed", and RPC forgets after seven days), and
 * measures the resource profile of registration and resolution.
 *
 * A failing simulation returns no footprint, so each refusal is submitted with
 * a footprint built from the keys the call touches.
 *
 *   npx tsx scripts/registry-evidence.ts
 */
import { randomBytes } from "node:crypto";
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  hash,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const EXPLORER = "https://stellar.expert/explorer/testnet/tx";

const REGISTRY = "CAC3XLU6CVQWFWUHABQYMZRIQJIZJLWGCNFVVACJB2YZ3DTWO2KDVF46";
const ADMIN = "GAL26X6L2267AGMQ7JL647JDVTWPUV7BJ4U4VVQ7N3IY7NKLUZJXWPM6";
const UPTO = "CCDHT7LJMEMF5MFWBDIOE62EZTQ64QQ47NEGKMG7E6SCU433O67VVXQB";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"; // registered under the pubnet id
const TESTNET_ID = Buffer.from(hash(Buffer.from(Networks.TESTNET)));

const ERRORS: Record<number, string> = { 1: "NotRegistered", 2: "WrongNetwork", 3: "NotAdmin" };

const server = new rpc.Server(RPC_URL);

function instanceKey(contract: string) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

function recordKey(token: string) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(REGISTRY).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Record"), new Address(token).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

async function codeKey(contract: string) {
  const { entries } = await server.getLedgerEntries(instanceKey(contract));
  const wasmHash = entries[0].val.contractData().val().instance().executable().wasmHash();
  return xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: wasmHash }));
}

async function fundedKeypair() {
  const kp = Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
  return kp;
}

/** Submits a call that is expected to fail, with an explicit footprint, and decodes the error. */
async function landRefusal(
  source: Keypair,
  fn: string,
  args: xdr.ScVal[],
  readOnly: xdr.LedgerKey[],
  auth: xdr.SorobanAuthorizationEntry[] = [],
) {
  const data = new SorobanDataBuilder()
    .setReadOnly(readOnly)
    .setResources(5_000_000, 20_000, 2_000)
    .setResourceFee(1_000_000)
    .build();
  const tx = new TransactionBuilder(await server.getAccount(source.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({ contract: REGISTRY, function: fn, args, auth }))
    .setSorobanData(data)
    .setTimeout(60)
    .build();
  tx.sign(source);

  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") throw new Error(`${fn}: submission ${sent.status}`);
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  let code: number | undefined;
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    for (const event of final.diagnosticEventsXdr ?? []) {
      for (const topic of event.event().body().v0().topics()) {
        if (topic.switch().name === "scvError" && topic.error().switch().name === "sceContract") {
          code = topic.error().contractCode();
        }
      }
    }
  }
  return { hash: sent.hash, status: final.status, code, error: code ? `Error(Contract, #${code}) ${ERRORS[code]}` : "none" };
}

/** Resources of a call, from simulation with `source` as the transaction source. */
async function profile(source: string, fn: string, args: xdr.ScVal[]) {
  const tx = new TransactionBuilder(await server.getAccount(source), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: REGISTRY, function: fn, args }))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`${fn}: ${sim.error}`);
  const r = sim.transactionData.build().resources();
  return {
    fn,
    instructions: r.instructions(),
    diskReadBytes: r.diskReadBytes(),
    writeBytes: r.writeBytes(),
    footprint: `${r.footprint().readOnly().length} ro / ${r.footprint().readWrite().length} rw`,
    resourceFee: sim.minResourceFee,
  };
}

async function main() {
  const caller = await fundedKeypair();
  const code = await codeKey(REGISTRY);
  const base = [instanceKey(REGISTRY), code];

  const results: { case: string; hash: string; status: string; error: string; expected: number; code?: number }[] = [];

  const unregistered = StrKey.encodeContract(randomBytes(32));
  results.push({
    case: `resolve(${unregistered.slice(0, 8)}…), a token never registered`,
    expected: 1,
    ...(await landRefusal(caller, "resolve", [new Address(unregistered).toScVal()], [...base, recordKey(unregistered)])),
  });

  results.push({
    case: "resolve(native XLM SAC), a record registered under the pubnet id",
    expected: 2,
    ...(await landRefusal(caller, "resolve", [new Address(XLM).toScVal()], [...base, recordKey(XLM)])),
  });

  // The stranger proves control of its own address (source-account auth),
  // so the refusal is the contract's NotAdmin, not a host auth failure.
  const registerArgs = [
    new Address(caller.publicKey()).toScVal(),
    new Address(USDC).toScVal(),
    new Address(caller.publicKey()).toScVal(),
    xdr.ScVal.scvBytes(TESTNET_ID),
  ];
  const strangerAuth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(REGISTRY).toScAddress(),
          functionName: "register",
          args: registerArgs,
        }),
      ),
      subInvocations: [],
    }),
  });
  results.push({
    case: "register(...) by a non-admin, redirecting USDC to its own address",
    expected: 3,
    ...(await landRefusal(caller, "register", registerArgs, base, [strangerAuth])),
  });

  console.log("refusals");
  let failures = 0;
  for (const r of results) {
    const ok = r.status === "FAILED" && r.code === r.expected;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${r.case}`);
    console.log(`        ${r.status} ${r.error}  ${EXPLORER}/${r.hash}`);
  }

  console.log("\nresource profile (simulated)");
  const rows = [
    await profile(ADMIN, "register", [
      new Address(ADMIN).toScVal(),
      new Address(StrKey.encodeContract(randomBytes(32))).toScVal(),
      new Address(UPTO).toScVal(),
      xdr.ScVal.scvBytes(TESTNET_ID),
    ]),
    await profile(caller.publicKey(), "resolve", [new Address(USDC).toScVal()]),
  ];
  for (const r of rows) console.log(`  ${JSON.stringify(r)}`);

  console.log(failures === 0 ? "\nall refusals landed as specified" : `\n${failures} refusal(s) not as specified`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
