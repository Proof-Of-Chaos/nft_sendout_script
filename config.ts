import { Low, JSONFile } from 'lowdb';
import { ApiPromise } from "@polkadot/api";
import { BlockCountAdapter } from './tools/blockCountAdapter.js';
import { BlockListener } from './src/blockListener.js';
import { PinataClient } from '@pinata/sdk';
import { KeyringPair } from '@polkadot/keyring/types';

type Params = {
  api: ApiPromise,
  localStorage: Low,
  settings: any,
  blockCountAdapter: BlockCountAdapter,
  blockListener: BlockListener,
  pinata: PinataClient,
  account: KeyringPair,
};

export const params: Params = {
  api: null,
  localStorage: null,
  settings: null,
  blockCountAdapter: null,
  blockListener: null,
  pinata: null,
  account: null,
};

export const getLocalStorage = (): Low => {
  const db = new Low(new JSONFile(process.env.LOCAL_STORAGE_DB_FILE_PATH));
  return db;
};

