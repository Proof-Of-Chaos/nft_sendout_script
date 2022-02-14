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
  settings: any,
  blockCountAdapter: CountAdapter,
  blockListener: BlockListener,
  tileCountAdapter: CountAdapter,
  pinata: PinataClient,
  account: KeyringPair,
  remarkStorageAdapter: RemarkStorageAdapter,
  remarkBlockCountAdapter: CountAdapter
};

export const params: Params = {
  api: null,
  localStorage: null,
  settings: null,
  blockCountAdapter: null,
  blockListener: null,
  tileCountAdapter: null,
  pinata: null,
  account: null,
  remarkStorageAdapter: null,
  remarkBlockCountAdapter: null,
};

export const getLocalStorage = (): Low => {
  const db = new Low(new JSONFile(process.env.LOCAL_STORAGE_DB_FILE_PATH));
  return db;
};

