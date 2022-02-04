import "@polkadot/api-augment";
import { params, getLocalStorage } from "./config.js";
import { getSettings } from "./tools/settings.js";
import { BlockCountAdapter } from "./tools/blockCountAdapter.js";
import dotenv from "dotenv";
import { getApi } from "./tools/substrateUtils.js";
import { ApiPromise } from "@polkadot/api";
import { Low } from "lowdb/lib";
import mongoose from "mongoose";
import { BlockListener } from "./src/blockListener.js";
import pinataSDK from "@pinata/sdk";

dotenv.config();

class VoteReader {
  settings: any;
  api: ApiPromise;
  localStorage: Low;
  /**
   * Create VoteReader instance
   * @param config - SubstrateBot config
   * @param config.settings - main bot settings, should contain substrate network params (name, prefix, decimals, token),
   * telegram bot token, start & validators messages, links (governance, common), list of group alerts. See sample in examples
   * @param config.api - polkadot-api instance for connect to node
   * @param config.getNetworkStats - external function for getting substrate network stats
   */
  constructor({
    settings,
    api
  }) {
    this.settings = settings;
    this.api = api;
    this.localStorage = getLocalStorage();
  }

  async run() {
    params.api = this.api;
    params.localStorage = this.localStorage;
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
    //setup pinata
    params.pinata = pinataSDK(process.env.PINATA_API, process.env.PINATA_SECRET);
    params.settings = this.settings;
    params.blockCountAdapter = new BlockCountAdapter(params.localStorage, "headerBlock");
    params.blockListener = new BlockListener(params.api,
      params.blockCountAdapter);
  }

  async stop() {
    await mongoose.connection.close(false);
    console.log('MongoDb connection closed.');
    process.exit(0);
  }
}

let substrateBot;
async function main() {
  const settings = getSettings();
  const api = await getApi();
  substrateBot = new VoteReader({
    settings,
    api
  });
  await substrateBot.run();

  process.once('SIGINT', () => {
    substrateBot.stop();
  });
  process.once('SIGTERM', () => {
    substrateBot.stop();
  });
}

main();

