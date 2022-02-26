import "@polkadot/api-augment";
import { params, getLocalStorage, getDb } from "./config.js";
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
import { createCanvasCollection } from "./tools/startScripts/createCanvasCollection.js";
import { sendNFTs } from "./src/sendNFTs.js";
import { BN } from '@polkadot/util';
import { createTileCollections } from "./tools/startScripts/createTileCollections.js";
import { createBase } from "./tools/startScripts/createBase.js";

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
      await createCanvasCollection();
      await createTileCollections();
      await createBase();
    }
    const parentRemarks = [
      // 'RMRK::MINT::2.0.0::%7B%22collection%22%3A%22d43593c715a56da27d-GPR1%22%2C%22symbol%22%3A%22CANVAS%22%2C%22transferable%22%3A1%2C%22sn%22%3A%220%22%2C%22metadata%22%3A%22ipfs%3A%2F%2Fipfs%2Fbafkreichow2x6js4mfsprgo3w5hjaiyoj4tahkp63xsn2c47rzqsrdzcx4%22%7D',
      // 'RMRK::MINT::2.0.0::%7B%22collection%22%3A%22d43593c715a56da27d-GPR1%22%2C%22symbol%22%3A%22CANVAS%22%2C%22transferable%22%3A1%2C%22sn%22%3A%221%22%2C%22metadata%22%3A%22ipfs%3A%2F%2Fipfs%2Fbafkreichow2x6js4mfsprgo3w5hjaiyoj4tahkp63xsn2c47rzqsrdzcx4%22%7D',
      // 'RMRK::MINT::2.0.0::%7B%22collection%22%3A%22d43593c715a56da27d-GPR1%22%2C%22symbol%22%3A%22CANVAS%22%2C%22transferable%22%3A1%2C%22sn%22%3A%222%22%2C%22metadata%22%3A%22ipfs%3A%2F%2Fipfs%2Fbafkreichow2x6js4mfsprgo3w5hjaiyoj4tahkp63xsn2c47rzqsrdzcx4%22%7D'
      //'RMRK::RESADD::2.0.0::199-d43593c715a56da27d-GPR1-CANVAS-1::%7B%22base%22%3A%22base-20-canvas_blueprint%22%2C%22id%22%3A%221%22%2C%22parts%22%3A%5B%22(0%2C1)%22%2C%22(0%2C2)%22%2C%22(0%2C3)%22%2C%22(0%2C4)%22%2C%22(0%2C5)%22%2C%22(0%2C6)%22%2C%22(0%2C7)%22%2C%22(0%2C8)%22%2C%22(0%2C9)%22%2C%22(0%2C10)%22%2C%22(0%2C11)%22%2C%22(0%2C12)%22%2C%22(1%2C0)%22%2C%22(1%2C1)%22%2C%22(1%2C2)%22%2C%22(1%2C3)%22%2C%22(1%2C4)%22%2C%22(1%2C5)%22%2C%22(1%2C6)%22%2C%22(1%2C7)%22%2C%22(1%2C8)%22%2C%22(1%2C9)%22%2C%22(1%2C10)%22%2C%22(1%2C11)%22%2C%22(1%2C12)%22%2C%22(2%2C0)%22%2C%22(2%2C1)%22%2C%22(2%2C2)%22%2C%22(2%2C3)%22%2C%22(2%2C4)%22%2C%22(2%2C5)%22%2C%22(2%2C6)%22%2C%22(2%2C7)%22%2C%22(2%2C8)%22%2C%22(2%2C9)%22%2C%22(2%2C10)%22%2C%22(2%2C11)%22%2C%22(2%2C12)%22%2C%22(3%2C0)%22%2C%22(3%2C1)%22%2C%22(3%2C2)%22%2C%22(3%2C3)%22%2C%22(3%2C4)%22%2C%22(3%2C5)%22%2C%22(3%2C6)%22%2C%22(3%2C7)%22%2C%22(3%2C8)%22%2C%22(3%2C9)%22%2C%22(3%2C10)%22%2C%22(3%2C11)%22%2C%22(3%2C12)%22%2C%22(4%2C0)%22%2C%22(4%2C1)%22%2C%22(4%2C2)%22%2C%22(4%2C3)%22%2C%22(4%2C4)%22%2C%22(4%2C5)%22%2C%22(4%2C6)%22%2C%22(4%2C7)%22%2C%22(4%2C8)%22%2C%22(4%2C9)%22%2C%22(4%2C10)%22%2C%22(4%2C11)%22%2C%22(4%2C12)%22%2C%22(5%2C0)%22%2C%22(5%2C1)%22%2C%22(5%2C2)%22%2C%22(5%2C3)%22%2C%22(5%2C4)%22%2C%22(5%2C5)%22%2C%22(5%2C6)%22%2C%22(5%2C7)%22%2C%22(5%2C8)%22%2C%22(5%2C9)%22%2C%22(5%2C10)%22%2C%22(5%2C11)%22%2C%22(5%2C12)%22%2C%22(6%2C0)%22%2C%22(6%2C1)%22%2C%22(6%2C2)%22%2C%22(6%2C3)%22%2C%22(6%2C4)%22%2C%22(6%2C5)%22%2C%22(6%2C6)%22%2C%22(6%2C7)%22%2C%22(6%2C8)%22%2C%22(6%2C9)%22%2C%22(6%2C10)%22%2C%22(6%2C11)%22%2C%22(6%2C12)%22%2C%22(7%2C0)%22%2C%22(7%2C1)%22%2C%22(7%2C2)%22%2C%22(7%2C3)%22%2C%22(7%2C4)%22%2C%22(7%2C5)%22%2C%22(7%2C6)%22%2C%22(7%2C7)%22%2C%22(7%2C8)%22%2C%22(7%2C9)%22%2C%22(7%2C10)%22%2C%22(7%2C11)%22%2C%22(7%2C12)%22%2C%22(8%2C0)%22%2C%22(8%2C1)%22%2C%22(8%2C2)%22%2C%22(8%2C3)%22%2C%22(8%2C4)%22%2C%22(8%2C5)%22%2C%22(8%2C6)%22%2C%22(8%2C7)%22%2C%22(8%2C8)%22%2C%22(8%2C9)%22%2C%22(8%2C10)%22%2C%22(8%2C11)%22%2C%22(8%2C12)%22%2C%22(9%2C0)%22%2C%22(9%2C1)%22%2C%22(9%2C2)%22%2C%22(9%2C3)%22%2C%22(9%2C4)%22%2C%22(9%2C5)%22%2C%22(9%2C6)%22%2C%22(9%2C7)%22%2C%22(9%2C8)%22%2C%22(9%2C9)%22%2C%22(9%2C10)%22%2C%22(9%2C11)%22%2C%22(9%2C12)%22%2C%22(10%2C0)%22%2C%22(10%2C1)%22%2C%22(10%2C2)%22%2C%22(10%2C3)%22%2C%22(10%2C4)%22%2C%22(10%2C5)%22%2C%22(10%2C6)%22%2C%22(10%2C7)%22%2C%22(10%2C8)%22%2C%22(10%2C9)%22%2C%22(10%2C10)%22%2C%22(10%2C11)%22%2C%22(10%2C12)%22%2C%22(11%2C0)%22%2C%22(11%2C1)%22%2C%22(11%2C2)%22%2C%22(11%2C3)%22%2C%22(11%2C4)%22%2C%22(11%2C5)%22%2C%22(11%2C6)%22%2C%22(11%2C7)%22%2C%22(11%2C8)%22%2C%22(11%2C9)%22%2C%22(11%2C10)%22%2C%22(11%2C11)%22%2C%22(11%2C12)%22%2C%22(12%2C0)%22%2C%22(12%2C1)%22%2C%22(12%2C2)%22%2C%22(12%2C3)%22%2C%22(12%2C4)%22%2C%22(12%2C5)%22%2C%22(12%2C6)%22%2C%22(12%2C7)%22%2C%22(12%2C8)%22%2C%22(12%2C9)%22%2C%22(12%2C10)%22%2C%22(12%2C11)%22%2C%22(12%2C12)%22%2C%22(13%2C0)%22%5D%7D',
      //'RMRK::SEND::2.0.0::199-d43593c715a56da27d-GPR1-CANVAS-1::EctdZvgkphLJMQmKntaPP74LKpGvDKaj1cbqC8fUT4HzqiC',
      // 'RMRK::RESADD::2.0.0::199-d43593c715a56da27d-GPR1-CANVAS-0::%7B%22base%22%3A%22base-20-canvas_blueprint%22%2C%22id%22%3A%220%22%2C%22parts%22%3A%5B%22(0%2C1)%22%2C%22(0%2C2)%22%2C%22(0%2C3)%22%2C%22(0%2C4)%22%2C%22(0%2C5)%22%2C%22(0%2C6)%22%2C%22(0%2C7)%22%2C%22(0%2C8)%22%2C%22(0%2C9)%22%2C%22(0%2C10)%22%2C%22(0%2C11)%22%2C%22(0%2C12)%22%2C%22(1%2C0)%22%2C%22(1%2C1)%22%2C%22(1%2C2)%22%2C%22(1%2C3)%22%2C%22(1%2C4)%22%2C%22(1%2C5)%22%2C%22(1%2C6)%22%2C%22(1%2C7)%22%2C%22(1%2C8)%22%2C%22(1%2C9)%22%2C%22(1%2C10)%22%2C%22(1%2C11)%22%2C%22(1%2C12)%22%2C%22(2%2C0)%22%2C%22(2%2C1)%22%2C%22(2%2C2)%22%2C%22(2%2C3)%22%2C%22(2%2C4)%22%2C%22(2%2C5)%22%2C%22(2%2C6)%22%2C%22(2%2C7)%22%2C%22(2%2C8)%22%2C%22(2%2C9)%22%2C%22(2%2C10)%22%2C%22(2%2C11)%22%2C%22(2%2C12)%22%2C%22(3%2C0)%22%2C%22(3%2C1)%22%2C%22(3%2C2)%22%2C%22(3%2C3)%22%2C%22(3%2C4)%22%2C%22(3%2C5)%22%2C%22(3%2C6)%22%2C%22(3%2C7)%22%2C%22(3%2C8)%22%2C%22(3%2C9)%22%2C%22(3%2C10)%22%2C%22(3%2C11)%22%2C%22(3%2C12)%22%2C%22(4%2C0)%22%2C%22(4%2C1)%22%2C%22(4%2C2)%22%2C%22(4%2C3)%22%2C%22(4%2C4)%22%2C%22(4%2C5)%22%2C%22(4%2C6)%22%2C%22(4%2C7)%22%2C%22(4%2C8)%22%2C%22(4%2C9)%22%2C%22(4%2C10)%22%2C%22(4%2C11)%22%2C%22(4%2C12)%22%2C%22(5%2C0)%22%2C%22(5%2C1)%22%2C%22(5%2C2)%22%2C%22(5%2C3)%22%2C%22(5%2C4)%22%2C%22(5%2C5)%22%2C%22(5%2C6)%22%2C%22(5%2C7)%22%2C%22(5%2C8)%22%2C%22(5%2C9)%22%2C%22(5%2C10)%22%2C%22(5%2C11)%22%2C%22(5%2C12)%22%2C%22(6%2C0)%22%2C%22(6%2C1)%22%2C%22(6%2C2)%22%2C%22(6%2C3)%22%2C%22(6%2C4)%22%2C%22(6%2C5)%22%2C%22(6%2C6)%22%2C%22(6%2C7)%22%2C%22(6%2C8)%22%2C%22(6%2C9)%22%2C%22(6%2C10)%22%2C%22(6%2C11)%22%2C%22(6%2C12)%22%2C%22(7%2C0)%22%2C%22(7%2C1)%22%2C%22(7%2C2)%22%2C%22(7%2C3)%22%2C%22(7%2C4)%22%2C%22(7%2C5)%22%2C%22(7%2C6)%22%2C%22(7%2C7)%22%2C%22(7%2C8)%22%2C%22(7%2C9)%22%2C%22(7%2C10)%22%2C%22(7%2C11)%22%2C%22(7%2C12)%22%2C%22(8%2C0)%22%2C%22(8%2C1)%22%2C%22(8%2C2)%22%2C%22(8%2C3)%22%2C%22(8%2C4)%22%2C%22(8%2C5)%22%2C%22(8%2C6)%22%2C%22(8%2C7)%22%2C%22(8%2C8)%22%2C%22(8%2C9)%22%2C%22(8%2C10)%22%2C%22(8%2C11)%22%2C%22(8%2C12)%22%2C%22(9%2C0)%22%2C%22(9%2C1)%22%2C%22(9%2C2)%22%2C%22(9%2C3)%22%2C%22(9%2C4)%22%2C%22(9%2C5)%22%2C%22(9%2C6)%22%2C%22(9%2C7)%22%2C%22(9%2C8)%22%2C%22(9%2C9)%22%2C%22(9%2C10)%22%2C%22(9%2C11)%22%2C%22(9%2C12)%22%2C%22(10%2C0)%22%2C%22(10%2C1)%22%2C%22(10%2C2)%22%2C%22(10%2C3)%22%2C%22(10%2C4)%22%2C%22(10%2C5)%22%2C%22(10%2C6)%22%2C%22(10%2C7)%22%2C%22(10%2C8)%22%2C%22(10%2C9)%22%2C%22(10%2C10)%22%2C%22(10%2C11)%22%2C%22(10%2C12)%22%2C%22(11%2C0)%22%2C%22(11%2C1)%22%2C%22(11%2C2)%22%2C%22(11%2C3)%22%2C%22(11%2C4)%22%2C%22(11%2C5)%22%2C%22(11%2C6)%22%2C%22(11%2C7)%22%2C%22(11%2C8)%22%2C%22(11%2C9)%22%2C%22(11%2C10)%22%2C%22(11%2C11)%22%2C%22(11%2C12)%22%2C%22(12%2C0)%22%2C%22(12%2C1)%22%2C%22(12%2C2)%22%2C%22(12%2C3)%22%2C%22(12%2C4)%22%2C%22(12%2C5)%22%2C%22(12%2C6)%22%2C%22(12%2C7)%22%2C%22(12%2C8)%22%2C%22(12%2C9)%22%2C%22(12%2C10)%22%2C%22(12%2C11)%22%2C%22(12%2C12)%22%2C%22(13%2C0)%22%5D%7D',
      // 'RMRK::SEND::2.0.0::199-d43593c715a56da27d-GPR1-CANVAS-0::EctdZvgkphLJMQmKntaPP74LKpGvDKaj1cbqC8fUT4HzqiC',
      'RMRK::MINT::2.0.0::%7B%22collection%22%3A%22d43593c715a56da27d-TILE%22%2C%22symbol%22%3A%22170%22%2C%22transferable%22%3A1%2C%22sn%22%3A%220%22%2C%22metadata%22%3A%22ipfs%3A%2F%2Fipfs%2Fbafkreicem2wvur6fnoahzu55yyzo4q7mxlem5rof4qj4ecvdux6m4ewh6q%22%7D::199-d43593c715a56da27d-GPR1-CANVAS-0'
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

