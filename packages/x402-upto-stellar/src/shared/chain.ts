import { Account, Address, BASE_FEE, Operation, StrKey, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

import type { HostError } from "./reasons.js";

/** Read-only calls are simulated from the all-zero account, which needs no sequence. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const ERROR_TYPES: Record<string, string> = {
  sceContract: "Contract",
  sceWasmVm: "WasmVm",
  sceContext: "Context",
  sceStorage: "Storage",
  sceObject: "Object",
  sceCrypto: "Crypto",
  sceEvents: "Events",
  sceBudget: "Budget",
  sceValue: "Value",
  sceAuth: "Auth",
};

/**
 * The first error a contract or the host raised, from diagnostic events, with
 * the contract it came from. Falls back to the error string when no event
 * carries it.
 */
export function hostErrorOf(events: xdr.DiagnosticEvent[] | undefined, message = ""): HostError | undefined {
  for (const diagnostic of events ?? []) {
    const event = diagnostic.event();
    const topics = event.body().v0().topics();
    for (const topic of topics) {
      if (topic.switch().name !== "scvError") continue;
      const error = topic.error();
      const name = error.switch().name;
      const code = name === "sceContract" ? String(error.contractCode()) : error.code().name.replace(/^scec/, "");
      const contractId = event.contractId();
      return {
        type: ERROR_TYPES[name] ?? name,
        code,
        raisedBy: contractId ? StrKey.encodeContract(Buffer.from(contractId as unknown as Uint8Array)) : undefined,
      };
    }
  }
  const match = message.match(/Error\((\w+), #?(\w+)\)/);
  return match ? { type: match[1], code: match[2] } : undefined;
}

export type Read<T> = { ok: true; value: T } | { ok: false; error?: HostError; message: string };

/** Simulates a read-only contract call. */
export async function view<T = unknown>(
  server: rpc.Server,
  passphrase: string,
  contract: string,
  fn: string,
  args: xdr.ScVal[],
): Promise<Read<T>> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.invokeContractFunction({ contract, function: fn, args }))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    return { ok: false, error: hostErrorOf(sim.events, sim.error), message: sim.error };
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    return { ok: false, message: `${fn}: simulation returned no result` };
  }
  return { ok: true, value: scValToNative(sim.result.retval) as T };
}

/** The deployment the registry names for `token` on this network. */
export async function resolveDeployment(
  server: rpc.Server,
  passphrase: string,
  registry: string,
  token: string,
): Promise<Read<string>> {
  return view<string>(server, passphrase, registry, "resolve", [new Address(token).toScVal()]);
}

/** The authorization id, derived by the escrow contract itself. */
export async function authorizationId(
  server: rpc.Server,
  passphrase: string,
  contract: string,
  authorization: xdr.ScVal,
): Promise<Buffer> {
  const read = await view<Uint8Array>(server, passphrase, contract, "authorization_id", [authorization]);
  if (!read.ok) throw new Error(`authorization_id: ${read.message}`);
  return Buffer.from(read.value);
}

export async function isConsumed(server: rpc.Server, passphrase: string, contract: string, id: Buffer): Promise<boolean> {
  const read = await view<boolean>(server, passphrase, contract, "is_consumed", [xdr.ScVal.scvBytes(id)]);
  if (!read.ok) throw new Error(`is_consumed: ${read.message}`);
  return read.value;
}

/** `balance(holder)` on a SEP-41 token. Fails for a G account without a trustline. */
export async function balanceOf(server: rpc.Server, passphrase: string, token: string, holder: string): Promise<Read<bigint>> {
  return view<bigint>(server, passphrase, token, "balance", [new Address(holder).toScVal()]);
}
