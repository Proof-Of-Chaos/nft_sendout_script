import "@polkadot/api-augment";
import { params, getLocalStorage } from "./config.js";
import { getSettings } from "./tools/settings.js";
import { CountAdapter } from "./tools/countAdapter.js";
import dotenv from "dotenv";
import { getApi, initAccount } from "./tools/substrateUtils.js";
import { ApiPromise } from "@polkadot/api";
import { Low } from "lowdb/lib";
import { BlockListener } from "./src/blockListener.js";
import pinataSDK from "@pinata/sdk";
import { KeyringPair } from "@polkadot/keyring/types";
import { createBitsCollection } from "./tools/startScripts/createBitsCollection.js";
import { logger } from "./tools/logger.js";
import { sleep } from "./tools/utils.js";

dotenv.config();

class Incentivizer {
  settings: any;
  api: ApiPromise;
  localStorage: Low;
  remarkStorage: Low;
  account: KeyringPair;
  constructor({
    settings,
    api,
    account
  }) {
    this.settings = settings;
    this.api = api;
    this.account = account;
    this.localStorage = getLocalStorage();
  }

  async run() {
    params.localStorage = this.localStorage;
    params.account = this.account
    const networkProperties = await this.api.rpc.system.properties();
    if (!this.settings.network.prefix && networkProperties.ss58Format) {
      this.settings.network.prefix = networkProperties.ss58Format.toString();
    }
    if (!this.settings.network.decimals && networkProperties.tokenDecimals) {
      this.settings.network.decimals = networkProperties.tokenDecimals.toString();
    }
    if (
      this.settings.network.token === undefined &&
      networkProperties.tokenSymbol
    ) {
      this.settings.network.token = networkProperties.tokenSymbol.toString();
    }
    params.settings = this.settings;

    if (process.env.SETUP_COMPLETE === "true") {
      params.blockCountAdapter = new CountAdapter(params.localStorage, "headerBlock");
      params.blockListener = new BlockListener(this.api,
        params.blockCountAdapter);
    }

    //setup pinata
    params.pinata = pinataSDK(process.env.PINATA_API, process.env.PINATA_SECRET);
    try {
      const result = await params.pinata.testAuthentication();
      logger.info(result);
    }
    catch (err) {
      //handle error here
      logger.info(err);
    }
    if (process.env.SETUP_COMPLETE !== "true") {
      await createBitsCollection();
      await sleep(3000)
      logger.info("complete")
    }
  }
}

let incentivizer;
async function main() {
  const settings = getSettings();
  const api = await getApi();
  const account = initAccount();
  incentivizer = new Incentivizer({
    settings,
    api,
    account
  });
  await incentivizer.run();
}

main();

