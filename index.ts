import "@polkadot/api-augment";
import { params, getLocalStorage } from "./config.js";
import { getSettings } from "./tools/settings.js";
import { CountAdapter } from "./tools/countAdapter.js";
import dotenv from "dotenv";
import { getApi, initAccount, mintAndSend } from "./tools/substrateUtils.js";
import { ApiPromise } from "@polkadot/api";
import { Low } from "lowdb/lib";
import { BlockListener } from "./src/blockListener.js";
import pinataSDK from "@pinata/sdk";
import { KeyringPair } from "@polkadot/keyring/types";
import { Consolidator, RemarkListener } from "rmrk-tools";
import { RemarkStorageAdapter } from "./tools/remarkStorageAdapter.js";
import { createRewardsCollection } from "./tools/startScripts/createRewardsCollection.js";
import { sendNFTs } from "./src/sendNFTs.js";
import { BN } from '@polkadot/util';

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
      params.blockCountAdapter = new CountAdapter(params.localStorage, "headerBlock");
      params.tileCountAdapter = new CountAdapter(params.localStorage, "currentTileId");
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
        console.log("val", val)
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
    const parentRemarks = [
      'RMRK::MINT::2.0.0::%7B%22collection%22%3A%2280ebf328035cf41a36-GPR1%22%2C%22symbol%22%3A%22CANVAS%22%2C%22transferable%22%3A1%2C%22sn%22%3A%221%22%2C%22metadata%22%3A%22ipfs%3A%2F%2Fipfs%2Fbafkreih2jcezqxfg2vvmad537ai3hgq5mxisbbc6hbaq6tagrnceu7mf2a%22%7D::J1PBYXPBJxJx1TJgEY7tuc1X8hJ8EuKHMHQEn47JBeqrVq7',
      'RMRK::MINT::2.0.0::%7B%22collection%22%3A%2280ebf328035cf41a36-GPR1%22%2C%22symbol%22%3A%22CANVAS%22%2C%22transferable%22%3A1%2C%22sn%22%3A%221%22%2C%22metadata%22%3A%22ipfs%3A%2F%2Fipfs%2Fbafkreih2jcezqxfg2vvmad537ai3hgq5mxisbbc6hbaq6tagrnceu7mf2a%22%7D::EctdZvgkphLJMQmKntaPP74LKpGvDKaj1cbqC8fUT4HzqiC',
    ]
    await mintAndSend(parentRemarks);
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

