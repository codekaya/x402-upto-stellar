/** Testnet account setup shared by the service and the agent. Not part of the protocol. */
import { Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";

export const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
export const PASSPHRASE = Networks.TESTNET;
export const NETWORK = "stellar:testnet" as const;
export const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const EXPLORER = "https://stellar.expert/explorer/testnet/tx";
export const server = new rpc.Server(RPC_URL);

/** A key from the environment, or a fresh one funded by friendbot. */
export async function account(secret: string | undefined): Promise<{ keypair: Keypair; fresh: boolean }> {
  if (secret) return { keypair: Keypair.fromSecret(secret), fresh: false };
  const keypair = Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
  return { keypair, fresh: true };
}

export async function submit(keypair: Keypair, ops: xdr.Operation[]): Promise<string> {
  const builder = new TransactionBuilder(await server.getAccount(keypair.publicKey()), { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(60).build();
  tx.sign(keypair);
  const sent = await server.sendTransaction(tx);
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`setup ${sent.hash}: ${final.status}`);
  return sent.hash;
}

export const trustUsdc = () => Operation.changeTrust({ asset: USDC });
export const buyUsdc = (destination: string, xlm: string) =>
  Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: xlm, destination, destAsset: USDC, destMin: "1", path: [] });

/** Atomic USDC (7 decimals) as a decimal string. */
export const usdc = (atomic: bigint | string) => `${(Number(atomic) / 1e7).toFixed(7)} USDC`;
