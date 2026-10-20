import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { convertToTokenAmount, getUsdcAddress } from "@x402/stellar";

import { DEPLOYMENTS, SCHEME } from "../../shared/constants.js";

/** Stellar Asset Contracts carry seven decimals. */
const SAC_DECIMALS = 7;

export interface UptoServerOptions {
  /** Escrow contract per network, when not the known canonical deployment. */
  contracts?: Partial<Record<Network, string>>;
}

/**
 * Resource-server side of the `upto` scheme on Stellar. Prices default to
 * USDC; `enhancePaymentRequirements` adds the escrow contract and the
 * facilitator address the payer will bind as settler.
 */
export class UptoStellarScheme implements SchemeNetworkServer {
  readonly scheme = SCHEME;
  readonly defaultAssetTransferMethod = "default";
  readonly paymentFlows = {
    default: { supported: ["authorization"], default: "authorization" },
  } as const;

  private readonly moneyParsers: MoneyParser[] = [];

  constructor(private readonly options: UptoServerOptions = {}) {}

  registerMoneyParser(parser: MoneyParser): UptoStellarScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  getAssetDecimals(_asset: string, _network: Network): number {
    return SAC_DECIMALS;
  }

  /** A price for `upto` is the cap: the most one request may cost. */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) throw new Error("upto: an AssetAmount price needs an asset");
      return price;
    }
    const decimal = typeof price === "number" ? String(price) : price.replace(/^\$/, "").trim();
    for (const parser of this.moneyParsers) {
      const parsed = await parser(decimal, network);
      if (parsed) return parsed;
    }
    return { asset: getUsdcAddress(network), amount: convertToTokenAmount(decimal, SAC_DECIMALS) };
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: { x402Version: number; scheme: string; network: Network; extra?: Record<string, unknown> },
    _extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    const contract = this.options.contracts?.[requirements.network] ?? DEPLOYMENTS[requirements.network]?.contract;
    if (!contract) throw new Error(`upto: no escrow contract known for ${requirements.network}`);
    const facilitatorAddress = supportedKind.extra?.facilitatorAddress;
    return {
      ...requirements,
      extra: {
        ...requirements.extra,
        contract,
        ...(typeof facilitatorAddress === "string" ? { facilitatorAddress } : {}),
        areFeesSponsored: true,
      },
    };
  }
}
