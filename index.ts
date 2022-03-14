import "@polkadot/api-augment";
import { params, getLocalStorage, getDb } from "./config.js";
import { getSettings } from "./tools/settings.js";
import { CountAdapter } from "./tools/countAdapter.js";
import dotenv from "dotenv";
import { getApi, initAccount } from "./tools/substrateUtils.js";
import { ApiPromise } from "@polkadot/api";
import { Low } from "lowdb/lib";
import { BlockListener } from "./src/blockListener.js";
import pinataSDK from "@pinata/sdk";
import { KeyringPair } from "@polkadot/keyring/types";
import { Consolidator, RemarkListener } from "rmrk-tools";
import { RemarkStorageAdapter } from "./tools/remarkStorageAdapter.js";
import { createShelfCollection } from "./tools/startScripts/createShelfCollection.js";
import { createBase } from "./tools/startScripts/createBase.js";
import { createTrophyCollection } from "./tools/startScripts/createTrophyCollection.js";

dotenv.config();

class Incentivizer {
  settings: any;
  api: ApiPromise;
  localStorage: Low;
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
    await getDb();
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
      params.blockCountAdapter = new CountAdapter(params.localStorage, "headerBlock");
      params.blockListener = new BlockListener(params.api,
        params.blockCountAdapter);
    }
    //setup remark listener for minting listener
    params.remarkStorageAdapter = new RemarkStorageAdapter(params.localStorage);
    const consolidateFunction = async (remarks) => {
      const consolidator = new Consolidator(2, params.remarkStorageAdapter);
      return consolidator.consolidate(remarks);
    };
    params.remarkBlockCountAdapter = new CountAdapter(params.localStorage, "remarkBlock")
    const startListening = async () => {
      const listener = new RemarkListener({
        polkadotApi: params.api,
        prefixes: ['0x726d726b', '0x524d524b'],
        consolidateFunction,
        storageProvider: params.remarkBlockCountAdapter
      });
      const subscriber = listener.initialiseObservable();
      subscriber.subscribe(async (val) => {
        // if (val.invalid && val.invalid.length > 0) {
        //   await params.bot.api
        //     .sendMessage(params.settings.adminChatId, `Invalid Remark: ${JSON.stringify(val.invalid)}`);
        // }
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
      await createShelfCollection();
      await createTrophyCollection();
      await createBase();
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

