import { AptosAccount } from "aptos";
import { DU, Market, Pool } from "../src";
import { AuxClient, getAptosProfile, Network } from "../src/client";

const auxClient = AuxClient.create({
  network: Network.Mainnet,
  validatorAddress: "http://localhost:8080",
});

const privateKeyHex = getAptosProfile("mainnet")?.private_key!;
const moduleAuthority: AptosAccount = AptosAccount.fromAptosAccountObject({
  privateKeyHex,
});

const USDC = "0x5e156f1207d0ebfa19a9eeff00d62a282278fb8719f4fab3a586a0a2c0fffbea::coin::T";
const SOL = "0xdd89c0e695df0692205912fb69fc290418bed0dbe6e4573d744a6d5e6bab6c13::coin::T";
const WETH = "0xcc8a89c8dce9693d354449f1f73e60e14e347417854f029db5bc8e7454008abb::coin::T";
const WBTC = "0xae478ff7d83ed072dbc5e264250e67ef58f57c99d89b447efd8a0a2e8b2be76e::coin::T";

const MARKETS = [
  {
    base: WBTC,
    quote: USDC,
    baseLotSize: "0.00001",
    quoteLotSize: "0.01",
  },
  {
    base: WETH,
    quote: USDC,
    baseLotSize: "0.001",
    quoteLotSize: "0.01",
  },
  {
    base: SOL,
    quote: USDC,
    baseLotSize: "0.01",
    quoteLotSize: "0.001",
  },
];

const POOLS = [
  {
    base: WBTC,
    quote: USDC,
    feeBps: "30",
  },
  {
    base: WETH,
    quote: USDC,
    feeBps: "30",
  },
  {
    base: SOL,
    quote: USDC,
    feeBps: "30",
  },
];

(async () => {
  for (const market of MARKETS) {
    await Market.create(auxClient, {
      sender: moduleAuthority,
      baseCoinType: market.base,
      quoteCoinType: market.quote,
      baseLotSize: await auxClient.toAtomicUnits(
        market.base,
        DU(market.baseLotSize)
      ),
      quoteLotSize: await auxClient.toAtomicUnits(
        market.quote,
        DU(market.quoteLotSize)
      ),
    });
  }
})();

(async () => {
  for (const pool of POOLS) {
    await Pool.create(auxClient, {
      sender: moduleAuthority,
      coinTypeX: pool.base,
      coinTypeY: pool.quote,
      feePct: 0.0030,
    });
  }
})();