import { promises as fs } from "fs";
import _ from "lodash";
import * as coins from "../../coins";
import * as aux from "../../";
import { ALL_FAKE_COINS } from "../../client";
import { auxClient } from "../connection";
import {
  Account,
  CoinInfo,
  FeaturedStatus,
  Market,
  Maybe,
  Pool,
  QueryAccountArgs,
  QueryMarketArgs,
  QueryMarketsArgs,
  QueryPoolArgs,
  QueryPoolsArgs,
} from "../generated/types";
import type { Types } from "aptos";

function getFeaturedPriority(status: FeaturedStatus): number {
  switch (status) {
    case FeaturedStatus.None:
      return 0;
    case FeaturedStatus.Hot:
      return 1;
    case FeaturedStatus.Promoted:
      return 2;
  }
}

function formatPool(
  pool: aux.Pool,
  coinTypeToHippoNameSymbol: Record<Types.Address, [string, string]>
) {
  let featuredStatus = FeaturedStatus.None;
  for (const [x, y] of PROMOTED_POOLS) {
    if (
      (pool.coinInfoX.coinType == x && pool.coinInfoY.coinType == y) ||
      (pool.coinInfoX.coinType == y && pool.coinInfoY.coinType == x)
    ) {
      featuredStatus = FeaturedStatus.Promoted;
      break;
    }
  }
  if (featuredStatus == FeaturedStatus.None) {
    for (const [x, y] of HOT_POOLS) {
      if (
        (pool.coinInfoX.coinType == x && pool.coinInfoY.coinType == y) ||
        (pool.coinInfoX.coinType == y && pool.coinInfoY.coinType == x)
      ) {
        featuredStatus = FeaturedStatus.Hot;
        break;
      }
    }
  }

  const recognizedLiquidity = Math.max(
    coins.ALL_USD_STABLES.includes(pool.coinInfoX.coinType)
      ? pool.amountX.toNumber()
      : 0,
    coins.ALL_USD_STABLES.includes(pool.coinInfoY.coinType)
      ? pool.amountY.toNumber()
      : 0
  );

  const auLiquidity = Math.max(
    pool.amountAuX.toNumber(),
    pool.amountAuY.toNumber()
  );

  const coinXNameSymbol = coinTypeToHippoNameSymbol[pool.coinInfoX.coinType];
  const coinInfoX = pool.coinInfoX;
  if (!_.isUndefined(coinXNameSymbol)) {
    const [name, symbol] = coinXNameSymbol;
    coinInfoX.name = name;
    coinInfoX.symbol = symbol;
  }

  const coinYNameSymbol = coinTypeToHippoNameSymbol[pool.coinInfoY.coinType];
  const coinInfoY = pool.coinInfoY;
  if (!_.isUndefined(coinYNameSymbol)) {
    const [name, symbol] = coinYNameSymbol;
    coinInfoY.name = name;
    coinInfoY.symbol = symbol;
  }

  return {
    coinInfoX,
    coinInfoY,
    coinInfoLP: pool.coinInfoLP,
    amountX: pool.amountX.toNumber(),
    amountY: pool.amountY.toNumber(),
    amountLP: pool.amountLP.toNumber(),
    feePercent: pool.feePct,
    featuredStatus,
    recognizedLiquidity,
    auLiquidity,
  };
}

const HOT_POOLS = [[coins.MOJO, coins.APT]];
const PROMOTED_POOLS: Array<[string, string]> = [];

export const query = {
  address() {
    return auxClient.moduleAddress;
  },
  async coins(parent: any): Promise<CoinInfo[]> {
    if (process.env["APTOS_PROFILE"] === "devnet") {
      return Promise.all(
        [
          [auxClient.getCoinInfo("0x1::aptos_coin::AptosCoin")],
          ALL_FAKE_COINS.map((fakeCoin) => auxClient.getFakeCoinInfo(fakeCoin)),
        ].flat()
      );
    }
    const path = `${process.cwd()}/src/indexer/data/mainnet-coin-list.json`;
    const coins = JSON.parse(await fs.readFile(path, "utf-8"));

    // The "liquidity" of a coin is defined as the sum of the liquidity of the
    // pools that trade it.
    const allPools = await this.pools(parent, {});
    const coinInfo = new Map();
    for (const pool of allPools) {
      for (const coin of [pool!.coinInfoX.coinType, pool!.coinInfoY.coinType]) {
        if (!coinInfo.has(coin)) {
          coinInfo.set(coin, {
            recognizedLiquidity: (pool as any).recognizedLiquidity,
            auLiquidity: (pool as any).auLiquidity,
            priority: getFeaturedPriority(pool.featuredStatus),
          });
        } else {
          const info = coinInfo.get(coin);
          info.recognizedLiquidity += (pool as any).recognizedLiquidity;
          info.auLiquidity += (pool as any).auLiquidity;
          info.priority = Math.max(
            info.priority,
            getFeaturedPriority(pool.featuredStatus)
          );
        }
      }
    }

    const allCoins = coins.map((coin: any) => {
      const coinType = coin.token_type.type;
      // The feature priority of a token is the max feature priority of the
      // pools that include it.
      const thisCoinInfo = coinInfo.get(coinType);
      const recognizedLiquidity =
        thisCoinInfo === undefined ? 0 : thisCoinInfo.recognizedLiquidity;
      const auLiquidity =
        thisCoinInfo === undefined ? 0 : thisCoinInfo.auLiquidity;
      const priority = thisCoinInfo === undefined ? 0 : thisCoinInfo.priority;
      return {
        coinType: coin.token_type.type,
        decimals: coin.decimals,
        name: coin.name,
        symbol: coin.symbol,
        priority,
        recognizedLiquidity,
        auLiquidity,
      };
    });
    allCoins.sort((lhs: any, rhs: any) => {
      if (lhs.priority != rhs.priority) {
        return rhs.priority - lhs.priority;
      }
      if (lhs.recognizedLiquidity != rhs.recognizedLiquidity) {
        return rhs.recognizedLiquidity - lhs.recognizedLiquidity;
      }
      return rhs.auLiquidity - lhs.auLiquidity;
    });
    return allCoins;
  },
  async pool(_parent: any, { poolInput }: QueryPoolArgs): Promise<Maybe<Pool>> {
    const pool = await aux.Pool.read(auxClient, poolInput);
    if (pool === undefined) {
      return null;
    }
    const path = `${process.cwd()}/src/indexer/data/mainnet-coin-list.json`;
    const hippoCoins = JSON.parse(await fs.readFile(path, "utf-8")).map(
      (coin: any) => ({
        coinType: coin.token_type.type,
        decimals: coin.decimals,
        name: coin.name,
        symbol: coin.symbol,
      })
    );
    const coinTypeToHippoNameSymbol = Object.fromEntries(
      hippoCoins.map((coin: any) => [coin.coinType, [coin.name, coin.symbol]])
    );
    // @ts-ignore
    return formatPool(pool, coinTypeToHippoNameSymbol);
  },
  async pools(_parent: any, args: QueryPoolsArgs): Promise<Pool[]> {
    const poolReadParams = args.poolInputs
      ? args.poolInputs
      : await aux.Pool.index(auxClient);
    const pools = await Promise.all(
      poolReadParams.map((poolReadParam) =>
        aux.Pool.read(auxClient, poolReadParam)
      )
    );
    const path = `${process.cwd()}/src/indexer/data/mainnet-coin-list.json`;
    const hippoCoins = JSON.parse(await fs.readFile(path, "utf-8")).map(
      (coin: any) => ({
        coinType: coin.token_type.type,
        decimals: coin.decimals,
        name: coin.name,
        symbol: coin.symbol,
      })
    );
    const coinTypeToHippoNameSymbol = Object.fromEntries(
      hippoCoins.map((coin: any) => [coin.coinType, [coin.name, coin.symbol]])
    );
    const formattedPools = pools
      .filter((maybePool) => maybePool !== undefined && maybePool !== null)
      .map((pool) => formatPool(pool!, coinTypeToHippoNameSymbol));

    // List hot pools first, then order by recognized liquidity, then by atomic
    // units of liquidity.
    formattedPools.sort((lhs, rhs) => {
      if (lhs.featuredStatus != rhs.featuredStatus) {
        return (
          getFeaturedPriority(rhs.featuredStatus) -
          getFeaturedPriority(lhs.featuredStatus)
        );
      }
      if (lhs.recognizedLiquidity != rhs.recognizedLiquidity) {
        return rhs.recognizedLiquidity - lhs.recognizedLiquidity;
      }
      return rhs.auLiquidity - lhs.auLiquidity;
    });
    // @ts-ignore
    return formattedPools;
  },
  async poolCoins(parent: any) {
    return this.coins(parent);
    // const pools = await this.pools(parent, {});
    // const coinInfos = pools.flatMap((pool) => [pool.coinInfoX, pool.coinInfoY]);
    // return _.uniqBy(coinInfos, (coinInfo) => coinInfo.coinType);
  },
  async market(_parent: any, args: QueryMarketArgs): Promise<Maybe<Market>> {
    let market: aux.Market;
    try {
      market = await aux.Market.read(auxClient, args.marketInput);
    } catch (err) {
      return null;
    }
    // @ts-ignore
    return {
      name: `${market.baseCoinInfo.name}-${market.quoteCoinInfo.name}`,
      baseCoinInfo: market.baseCoinInfo,
      quoteCoinInfo: market.quoteCoinInfo,
      lotSize: market.lotSize.toNumber(),
      tickSize: market.tickSize.toNumber(),
      lotSizeDecimals: market.lotSize
        .toDecimalUnits(market.baseCoinInfo.decimals)
        .toString(),
      tickSizeDecimals: market.tickSize
        .toDecimalUnits(market.quoteCoinInfo.decimals)
        .toString(),
      lotSizeString: market.lotSize.toString(),
      tickSizeString: market.tickSize.toString(),
      orderbook: {
        bids: market.l2.bids.map((l2Quote) => ({
          price: l2Quote.price.toNumber(),
          quantity: l2Quote.quantity.toNumber(),
        })),
        asks: market.l2.asks.map((l2Quote) => ({
          price: l2Quote.price.toNumber(),
          quantity: l2Quote.quantity.toNumber(),
        })),
      },
    };
  },
  async markets(_parent: any, args: QueryMarketsArgs): Promise<Market[]> {
    const markets = await aux.clob.core.query.markets(auxClient);
    const marketInputs = args.marketInputs;
    const auxCoinInfo = await auxClient.getCoinInfo(
      `${auxClient.moduleAddress}::aux_coin::AuxCoin`
    );
    if (marketInputs === undefined || marketInputs === null) {
      // @ts-ignore
      return (
        await Promise.all(
          markets.map((market) =>
            aux.Market.read(auxClient, {
              baseCoinType: market.baseCoinType,
              quoteCoinType: market.quoteCoinType,
            })
          )
        )
      ).map((market) => {
        return {
          name: `${market.baseCoinInfo.name}-${market.quoteCoinInfo.name}`,
          baseCoinInfo: market.baseCoinInfo,
          quoteCoinInfo: market.quoteCoinInfo,
          lotSize: market.lotSize.toNumber(),
          tickSize: market.tickSize.toNumber(),
          auxCoinInfo,
          orderbook: {
            bids: market.l2.bids.map((l2Quote) => ({
              price: l2Quote.price.toNumber(),
              quantity: l2Quote.quantity.toNumber(),
            })),
            asks: market.l2.asks.map((l2Quote) => ({
              price: l2Quote.price.toNumber(),
              quantity: l2Quote.quantity.toNumber(),
            })),
          },
        };
      });
    } else {
      // @ts-ignore
      return (
        await Promise.all(
          marketInputs.map((marketInput) =>
            aux.Market.read(auxClient, marketInput)
          )
        )
      )
        .filter(
          (maybeMarket) => maybeMarket !== undefined && maybeMarket !== null
        )
        .map((market) => {
          return {
            name: `${market.baseCoinInfo.name}-${market.quoteCoinInfo.name}`,
            baseCoinInfo: market.baseCoinInfo,
            quoteCoinInfo: market.quoteCoinInfo,
            lotSize: market.lotSize.toNumber(),
            tickSize: market.tickSize.toNumber(),
            auxCoinInfo,
            orderbook: {
              bids: market.l2.bids.map((l2Quote) => ({
                price: l2Quote.price.toNumber(),
                quantity: l2Quote.quantity.toNumber(),
              })),
              asks: market.l2.asks.map((l2Quote) => ({
                price: l2Quote.price.toNumber(),
                quantity: l2Quote.quantity.toNumber(),
              })),
            },
          };
        });
    }
  },
  async marketCoins(parent: any) {
    const markets = await this.markets(parent, {});
    const coinInfos = markets.flatMap((market) => [
      market.baseCoinInfo,
      market.quoteCoinInfo,
    ]);
    return _.uniqBy(coinInfos, (coinInfo) => coinInfo.coinType);
  },

  async account(_parent: any, { owner }: QueryAccountArgs): Promise<Account> {
    const auxAccount = await auxClient.getAccountResourceOptional(
      owner,
      `${auxClient.moduleAddress}::vault::AuxUserAccount`
    );

    // @ts-ignore
    return {
      address: owner,
      hasAuxAccount: auxAccount !== undefined,
    };
  },
};
