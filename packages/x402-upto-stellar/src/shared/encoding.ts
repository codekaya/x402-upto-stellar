import { createHash } from "node:crypto";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { PaymentRequirements } from "@x402/core/types";

/** The payload's authorization, JSON form. Field names follow the contract's `UptoAuthorization`. */
export interface UptoAuthorization {
  payer: string;
  payee: string;
  settler: string;
  token: string;
  /** Decimal string, atomic units. */
  maxAmount: string;
  /** Decimal string, Unix seconds. */
  validAfter: string;
  /** Decimal string, Unix seconds. */
  validBefore: string;
  /** 32 bytes, hex. */
  nonce: string;
  /** 32 bytes, hex: the resource commitment. */
  resource: string;
}

/** `PaymentPayload.payload` for the `upto` scheme. */
export interface UptoStellarPayload {
  authorization: UptoAuthorization;
  /** Base64 XDR `SorobanAuthorizationEntry`, signed by the payer. */
  signature: string;
}

const AUTHORIZATION_FIELDS = [
  "payer",
  "payee",
  "settler",
  "token",
  "maxAmount",
  "validAfter",
  "validBefore",
  "nonce",
  "resource",
] as const;

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HEX32 = /^[0-9a-f]{64}$/;

export function isUptoPayload(value: unknown): value is UptoStellarPayload {
  if (typeof value !== "object" || value === null) return false;
  const { authorization, signature } = value as Record<string, unknown>;
  if (typeof signature !== "string" || typeof authorization !== "object" || authorization === null) return false;
  const a = authorization as Record<string, unknown>;
  if (!AUTHORIZATION_FIELDS.every((field) => typeof a[field] === "string")) return false;
  return (
    DECIMAL.test(a.maxAmount as string) &&
    DECIMAL.test(a.validAfter as string) &&
    DECIMAL.test(a.validBefore as string) &&
    HEX32.test(a.nonce as string) &&
    HEX32.test(a.resource as string)
  );
}

/** `#[contracttype]` structs encode as an ScMap with symbol keys in sorted order. */
export function authorizationToScVal(a: UptoAuthorization): xdr.ScVal {
  const fields: [string, xdr.ScVal][] = [
    ["max_amount", nativeToScVal(BigInt(a.maxAmount), { type: "i128" })],
    ["nonce", xdr.ScVal.scvBytes(Buffer.from(a.nonce, "hex"))],
    ["payee", new Address(a.payee).toScVal()],
    ["payer", new Address(a.payer).toScVal()],
    ["resource", xdr.ScVal.scvBytes(Buffer.from(a.resource, "hex"))],
    ["settler", new Address(a.settler).toScVal()],
    ["token", new Address(a.token).toScVal()],
    ["valid_after", nativeToScVal(BigInt(a.validAfter), { type: "u64" })],
    ["valid_before", nativeToScVal(BigInt(a.validBefore), { type: "u64" })],
  ];
  return xdr.ScVal.scvMap(fields.map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })));
}

export function i128(value: bigint | string): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "i128" });
}

export function contractCall(
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

/**
 * The invocation tree the payer signs: the payload alone, then the pull of the
 * cap into escrow. The settled amount is deliberately absent.
 */
export function payerInvocation(contract: string, a: UptoAuthorization): xdr.SorobanAuthorizedInvocation {
  return contractCall(contract, "settle_signed", [authorizationToScVal(a)], [
    contractCall(a.token, "transfer", [new Address(a.payer).toScVal(), new Address(contract).toScVal(), i128(a.maxAmount)]),
  ]);
}

/** The settler's own authorization: source-account credentials over the full call, amount included. */
export function settlerEntry(contract: string, a: UptoAuthorization, settled: bigint | string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: contractCall(contract, "settle_signed", [authorizationToScVal(a), i128(settled)]),
  });
}

/** RFC 8785 JSON Canonicalization Scheme, for the JSON values requirements contain. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** `sha256(JCS(accepted))`, hex: the payload's commitment to the terms it pays for. */
export function resourceCommitment(accepted: PaymentRequirements): string {
  return createHash("sha256").update(canonicalJson(accepted)).digest("hex");
}

/** Requirements equal field by field, optionally ignoring `amount`. */
export function sameRequirements(a: PaymentRequirements, b: PaymentRequirements, ignoreAmount = false): boolean {
  const strip = (r: PaymentRequirements) => (ignoreAmount ? { ...r, amount: "" } : r);
  return canonicalJson(strip(a)) === canonicalJson(strip(b));
}
