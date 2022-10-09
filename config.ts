import { Low, JSONFile } from 'lowdb';
import { ApiPromise } from "@polkadot/api";
import { CountAdapter } from './tools/countAdapter.js';
import { BlockListener } from './src/blockListener.js';
import { PinataClient } from '@pinata/sdk';
import { KeyringPair } from '@polkadot/keyring/types';
import { RemarkStorageAdapter } from './tools/remarkStorageAdapter.js';

type Params = {
  api: ApiPromise,
  localStorage: Low,
  remarkStorage: Low,
  settings: any,
  blockCountAdapter: CountAdapter,
  blockListener: BlockListener,
  pinata: PinataClient,
  account: KeyringPair,
  remarkBlockCountAdapter: CountAdapter,
  remarkStorageAdapter: RemarkStorageAdapter,
};

export const params: Params = {
  api: null,
  localStorage: null,
  remarkStorage: null,
  settings: null,
  blockCountAdapter: null,
  blockListener: null,
  pinata: null,
  account: null,
  remarkBlockCountAdapter: null,
  remarkStorageAdapter: null,
};

export const getLocalStorage = (): Low => {
  const db = new Low(new JSONFile(process.env.LOCAL_STORAGE_DB_FILE_PATH));
  return db;
};

export const getRemarkStorage = (): Low => {
  const db = new Low(new JSONFile(process.env.REMARK_STORAGE_DB_FILE_PATH));
  return db;
};

