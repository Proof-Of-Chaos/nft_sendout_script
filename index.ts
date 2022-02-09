import "@polkadot/api-augment";
import { params, getLocalStorage } from "./config.js";
import { getSettings } from "./tools/settings.js";
import { BlockCountAdapter } from "./tools/blockCountAdapter.js";
import dotenv from "dotenv";
import { getApi, initAccount } from "./tools/substrateUtils.js";
import { ApiPromise } from "@polkadot/api";
import { Low } from "lowdb/lib";
import { BlockListener } from "./src/blockListener.js";
import pinataSDK from "@pinata/sdk";
import { KeyringPair } from "@polkadot/keyring/types";
import { Consolidator, RemarkListener } from "rmrk-tools";
import { RemarkStorageAdapter } from "./tools/remarkStorageAdapter.js";
import { createRewardsCollection } from "./tools/startScripts/createRewardsCollection.js";

dotenv.config();

class Incentivizer {
  settings: any;
  api: ApiPromise;
  localStorage: Low;
  account: KeyringPair;
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
    api,
    account
  }) {
    this.settings = settings;
    this.api = api;
    this.account = account;
    this.localStorage = getLocalStorage();
  }

  async run() {
    params.api = this.api;
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
      params.blockCountAdapter = new BlockCountAdapter(params.localStorage, "headerBlock");
      params.blockListener = new BlockListener(params.api,
        params.blockCountAdapter);
    }
    //setup remark listener for minting listener
    const consolidateFunction = async (remarks) => {
      const consolidator = new Consolidator(2, new RemarkStorageAdapter(params.localStorage));
      return consolidator.consolidate(remarks);
    };

    const startListening = async () => {
      const listener = new RemarkListener({
        polkadotApi: params.api,
        prefixes: ['0x726d726b', '0x524d524b'],
        consolidateFunction,
        storageProvider: new BlockCountAdapter(params.localStorage, "remarkBlock")
      });
      const subscriber = listener.initialiseObservable();
      subscriber.subscribe(async (val) => {
      });
    };
    await startListening();

    //setup pinata
    params.pinata = pinataSDK(process.env.PINATA_API, process.env.PINATA_SECRET);
    try {
      const result = await params.pinata.testAuthentication();
      console.log(result);
    }
    catch (err) {
      //handle error here
      console.log(err);
    }
    if (process.env.SETUP_COMPLETE !== "true") {
      await createRewardsCollection();
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

