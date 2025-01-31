import * as redis from "redis";
import * as aux from "..";
import { AuxClient } from "../client";

import type { Types } from "aptos";
import * as BN from "bn.js";
import { RedisPubSub } from "graphql-redis-subscriptions";
import _ from "lodash";
import { orderEventToOrder } from "../graphql/conversion";
import type { MarketInput, Maybe, Side } from "../graphql/generated/types";

const [auxClient, _moduleAuthority] = AuxClient.createFromEnvForTesting({});
const redisClient = redis.createClient();
redisClient.on("error", (err) => console.error("[Redis]", err));
const redisPubSub = new RedisPubSub();

// All time in milliseconds since unix epoch

interface Bar {
  baseCoinType: Types.MoveStructTag;
  quoteCoinType: Types.MoveStructTag;
  resolution: Resolution;
  ohlcv: Maybe<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  time: number;
}

interface Trade {
  side: Side;
  price: number;
  quantity: number;
  time: number;
}

interface Bbo {
  bid: number;
  ask: number;
  time: number;
}

type Resolution = "15s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export const RESOLUTIONS = [
  "15s",
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
  "1w",
] as const;

async function publishAmmEvents() {
  let swapCursor: BN = new BN.BN(0);
  let addCursor: BN = new BN.BN(0);
  let removeCursor: BN = new BN.BN(0);

  const poolReadParams = await aux.Pool.index(auxClient);
  const pools = await Promise.all(
    poolReadParams.map((poolReadParam) =>
      aux.Pool.read(auxClient, poolReadParam).then((pool) => pool!)
    )
  );
  while (true) {
    for (const pool of pools) {
      for (const swapEvent of await pool.swapEvents()) {
        if (swapCursor === swapEvent.sequenceNumber) {
          break;
        }
        await redisPubSub.publish("SWAP", {
          ...swapEvent,
          amountIn: swapEvent.in.toNumber(),
          amountOut: swapEvent.out.toNumber(),
        });
        swapCursor = swapEvent.sequenceNumber;
      }
      for (const addLiquidityEvent of await pool.addLiquidityEvents()) {
        if (addCursor === addLiquidityEvent.sequenceNumber) {
          break;
        }
        await redisPubSub.publish("ADD_LIQUIDITY", {
          ...addLiquidityEvent,
          amountAddedX: addLiquidityEvent.xAdded.toNumber(),
          amountAddedY: addLiquidityEvent.yAdded.toNumber(),
          amountMintedLP: addLiquidityEvent.lpMinted.toNumber(),
        });
        addCursor = addLiquidityEvent.sequenceNumber;
      }
      for (const removeLiquidityEvent of await pool.removeLiquidityEvents()) {
        if (removeCursor === removeLiquidityEvent.sequenceNumber) {
          break;
        }
        await redisPubSub.publish("REMOVE_LIQUIDITY", {
          ...removeLiquidityEvent,
          amountRemovedX: removeLiquidityEvent.xRemoved.toNumber(),
          amountRemovedY: removeLiquidityEvent.yRemoved.toNumber(),
          amountBurnedLP: removeLiquidityEvent.lpBurned.toNumber(),
        });
        removeCursor = removeLiquidityEvent.sequenceNumber;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function publishClobEvents() {
  const marketInputs = await aux.Market.index(auxClient);
  const rawCursors = await redisClient.get("cursors");
  const cursors: Record<string, number> = JSON.parse(rawCursors ?? "{}");
  const keyToCursor = Object.fromEntries(
    marketInputs.map(({ baseCoinType, quoteCoinType }) => {
      const key = `${baseCoinType}-${quoteCoinType}`;
      return [key, cursors[key] ?? 0];
    })
  );

  while (true) {
    await Promise.all(
      marketInputs.map((marketInput) =>
        publishMarketEvents(marketInput, keyToCursor)
      )
    );
    await redisClient.set("cursors", JSON.stringify(keyToCursor));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function publishMarketEvents(
  { baseCoinType, quoteCoinType }: MarketInput,
  keyToCursor: Record<string, number>
): Promise<void> {
  const key = `${baseCoinType}-${quoteCoinType}`;

  // publish orderbook
  const market = await aux.Market.read(auxClient, {
    baseCoinType,
    quoteCoinType,
  });
  const bids = market.l2.bids.map((level) => ({
    price: level.price.toNumber(),
    quantity: level.quantity.toNumber(),
  }));
  const asks = market.l2.asks.map((level) => ({
    price: level.price.toNumber(),
    quantity: level.quantity.toNumber(),
  }));
  await redisPubSub.publish("ORDERBOOK", {
    baseCoinType,
    quoteCoinType,
    bids,
    asks,
  });

  // publish bbo
  const bid =
    _.max(market.l2.bids.map((level) => level.price.toNumber())) ?? null;
  const ask =
    _.min(market.l2.asks.map((level) => level.price.toNumber())) ?? null;
  if (bid && ask) {
    const bbo: Bbo = {
      time: Date.now(),
      bid,
      ask,
    };
    await Promise.all(
      _.concat("24h", RESOLUTIONS).map((resolution) =>
        redisClient.rPush(`${key}-bbo-${resolution}`, JSON.stringify(bbo))
      )
    );
  }

  // publish trades
  const fills = (await market.fills()).filter(
    (fill) => fill.sequenceNumber.toNumber() >= keyToCursor[key]!
  );
  const cursor = fills[fills.length - 1]?.sequenceNumber.toNumber();
  const trades = fills
    .filter((fill) => fill.sequenceNumber.toNumber() % 2 === 0)
    .map((fill) =>
      orderEventToOrder(fill, market.baseCoinInfo, market.quoteCoinInfo)
    )
    .map((fill) => _.pick(fill, "side", "price", "quantity", "value", "time"));
  await publishTrades(trades, key);

  // publish bars
  await Promise.all(
    RESOLUTIONS.map((resolution) =>
      publishBar(resolution, key, { baseCoinType, quoteCoinType })
    )
  );

  // update cursor
  if (!_.isUndefined(cursor)) {
    keyToCursor[key] = cursor;
  }
}

function publishTrades(trades: Trade[], key: string) {
  return Promise.all([
    trades.forEach(async (trade) => await redisPubSub.publish("TRADE", trade)),
    trades.forEach(
      async (trade) =>
        await redisPubSub.publish("LAST_TRADE_PRICE", trade.price)
    ),
    Promise.all(
      _.concat("24h", RESOLUTIONS).map((resolution) => {
        if (!_.isEmpty(trades)) {
          redisClient.rPush(
            `${key}-trade-${resolution}`,
            trades.map((trade) => JSON.stringify(trade))
          );
        }
      })
    ),
  ]);
}

async function publishBar(
  resolution: Resolution,
  prefix: string,
  { baseCoinType, quoteCoinType }: MarketInput
): Promise<void> {
  const key = (k: "bbo" | "trade") => `${prefix}-${k}-${resolution}`;

  const now = Date.now();
  const delta = now % (resolutionToSeconds(resolution) * 1000);
  const time = now - delta;

  const [rawBbos, rawTrades] = await Promise.all([
    redisClient.lRange(key("bbo"), 0, -1),
    redisClient.lRange(key("trade"), 0, -1),
  ]);
  const [rawBbosLen, rawTradesLen] = [rawBbos.length, rawTrades.length];

  const bbos: Bbo[] = rawBbos
    .map((s) => JSON.parse(s))
    .filter((item) => item.time >= time);
  const trades: Trade[] = rawTrades
    .map((s) => JSON.parse(s))
    .filter((item) => item.time >= time);

  const midpoint = (bid: number, ask: number) => (bid + ask) / 2;
  const midpoints = bbos.map(({ bid, ask }) => midpoint(bid, ask));

  if (_.isEmpty(midpoints)) {
    await redisPubSub.publish("BAR", { resolution, time, ohlcv: null });
  } else {
    const open = _.first(midpoints)!;
    const high = _.max(bbos.map((bbo) => bbo.ask))!;
    const low = _.min(bbos.map((bbo) => bbo.bid))!;
    const close = _.last(midpoints)!;

    const bar: Bar = {
      baseCoinType,
      quoteCoinType,
      resolution,
      time,
      ohlcv: {
        open,
        high,
        low,
        close,
        volume: _(trades)
          .map((trade) => trade.price * trade.quantity)
          .sum(),
      },
    };
    await redisPubSub.publish("BAR", bar);
  }

  // this happens atomically in a Redis pipeline
  await Promise.all([
    redisClient.lPopCount(key("bbo"), rawBbosLen),
    redisClient.lPopCount(key("trade"), rawTradesLen),
  ]);
}

function resolutionToSeconds(resolution: Resolution): number {
  switch (resolution) {
    case "15s":
      return 15;
    case "1m":
      return 60;
    case "5m":
      return 5 * 60;
    case "15m":
      return 15 * 60;
    case "1h":
      return 60 * 60;
    case "4h":
      return 4 * 60 * 60;
    case "1d":
      return 24 * 60 * 60;
    case "1w":
      return 7 * 24 * 60 * 60;
    default:
      const _exhaustiveCheck: never = resolution;
      return _exhaustiveCheck;
  }
}

async function main() {
  await redisClient.connect();
  publishAmmEvents;
  publishClobEvents();
}

main();
