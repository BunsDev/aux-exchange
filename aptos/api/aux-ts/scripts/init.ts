import { AptosAccount } from "aptos";
import { assert } from "console";
import { AtomicUnits } from "../src/units";
import { Market, Pool } from "../src";
import {
  AuxClient,
  getAptosProfile,
  getAptosProfileNameFromEnvironment,
} from "../src/client";

interface Pair {
  base: string;
  quote: string;
  tick: number;
  lot: number;
}

async function init() {
  const auxClient = AuxClient.createFromEnv({});

  const profile = getAptosProfile(getAptosProfileNameFromEnvironment());
  const privateKeyHex = profile?.private_key!;

  const user = AptosAccount.fromAptosAccountObject({
    privateKeyHex,
  });
  let pairs: Pair[] = [];
  for (const { base, quote, tick, lot } of pairs) {
    let x = await Market.create(auxClient, {
      sender: user,
      baseCoinType: base,
      quoteCoinType: quote,
      baseLotSize: new AtomicUnits(lot),
      quoteLotSize: new AtomicUnits(tick),
    });

    assert(x);

    let pool = await Pool.create(auxClient, {
      sender: user,
      coinTypeX: base,
      coinTypeY: quote,
      feePct: 0.003,
    });

    assert(pool);
  }
}

init();
