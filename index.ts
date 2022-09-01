import "@polkadot/api-augment";
import { params, getLocalStorage, getDb, getRemarkStorage } from "./config.js";
import { getSettings } from "./tools/settings.js";
import { CountAdapter } from "./tools/countAdapter.js";
import dotenv from "dotenv";
import { getApi, getApiTest, initAccount } from "./tools/substrateUtils.js";
import { ApiPromise } from "@polkadot/api";
import { Low } from "lowdb/lib";
import { BlockListener } from "./src/blockListener.js";
import pinataSDK from "@pinata/sdk";
import { KeyringPair } from "@polkadot/keyring/types";
import { Consolidator, RemarkListener } from "rmrk-tools";
import { RemarkStorageAdapter } from "./tools/remarkStorageAdapter.js";
import { createShelfCollection } from "./tools/startScripts/createShelfCollection.js";
import { createBase } from "./tools/startScripts/createBase.js";
import { createItemCollection } from "./tools/startScripts/createItemCollection.js";
import { logger } from "./tools/logger.js";
import { sendNFTs } from "./src/sendNFTs.js";
import { BN } from '@polkadot/util';
import { upsertReferendaInDB } from "./src/saveVotesToDB.js";
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
    this.remarkStorage = getRemarkStorage();
  }

  async run() {
    await getDb();
    // params.api = this.api;
    params.localStorage = this.localStorage;
    params.remarkStorage = this.remarkStorage;
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
      if (this.settings.saveDB) {
        upsertReferendaInDB();
        const interval = setInterval(async () => {
          upsertReferendaInDB();
        }, 300000);
      }
    }
    //setup remark listener for minting listener
    params.remarkStorageAdapter = new RemarkStorageAdapter(params.remarkStorage);
    const consolidateFunction = async (remarks) => {
      const consolidator = new Consolidator(2, params.remarkStorageAdapter);
      return consolidator.consolidate(remarks);
    };
    params.remarkBlockCountAdapter = new CountAdapter(params.localStorage, "remarkBlock")
    const startListening = async () => {
      const listener = new RemarkListener({
        polkadotApi: params.settings.isTest ? await getApiTest() : this.api,
        prefixes: ['0x726d726b', '0x524d524b'],
        consolidateFunction,
        storageProvider: params.remarkBlockCountAdapter
      });
      const subscriber = listener.initialiseObservable();
      subscriber.subscribe(async (val) => {
        // if (val.invalid.length > 0){
        //   logger.info("invalid", val.invalid)
        // }
      });
    };
    await startListening();

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
      await sleep(3000)
      await createShelfCollection();
      await sleep(3000)
      await createItemCollection();
      await sleep(3000)
      await createBase();
      logger.info("complete")
    }
    // sendNFTs(true, new BN("193"))
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

