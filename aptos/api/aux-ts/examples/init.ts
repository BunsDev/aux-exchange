import { AptosAccount } from "aptos";
import { Pool, Market, DU } from "../src";
import { AuxClient, getAptosProfile, Network } from "../src/client";

const auxClient = AuxClient.create({
  network: Network.Mainnet,
});

const privateKeyHex = getAptosProfile("mainnet")?.private_key!;
const moduleAuthority: AptosAccount = AptosAccount.fromAptosAccountObject({
  privateKeyHex,
});

const APT = "0x1::aptos_coin::AptosCoin";
const sAPT =
  "0x84d7aeef42d38a5ffc3ccef853e1b82e4958659d16a7de736a29c55fbbeb0114::staked_aptos_coin::StakedAptosCoin";

(async () => {
  await Market.create(auxClient, {
    sender: moduleAuthority,
    baseCoinType: sAPT,
    quoteCoinType: APT,
    baseLotSize: await auxClient.toAtomicUnits(sAPT, DU("0.1")),
    quoteLotSize: await auxClient.toAtomicUnits(APT, DU("0.0001")),
  });
  await Pool.create(auxClient, {
    sender: moduleAuthority,
    coinTypeX: APT,
    coinTypeY: sAPT,
    feePct: 0.1,
  });
})();
