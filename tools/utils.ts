import { params } from "../config.js";
import { logger } from "../tools/logger.js";
import BigNumber from "bignumber.js";
import { BN } from '@polkadot/util';
import fs from "fs";
import { getApi } from "./substrateUtils.js";

const fsPromises = fs.promises;

export const asyncFilter = async (arr, predicate) => {
  const results = await Promise.all(arr.map(predicate));
  return arr.filter((_v, index) => results[index]);
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
};

export const amountToHumanString = async (amount: string, afterCommas?: number): Promise<string> => {
  const api = await getApi();
  const token = params.settings.network.token;
  const value = new BigNumber(amount.toString())
    .dividedBy(new BigNumber("1e" + api.registry.chainDecimals))
    .toFixed(afterCommas ? afterCommas : 5, BigNumber.ROUND_FLOOR);
  const tokenString = token ? " " + token : "";
  return value + tokenString;
};

export const getConfigFile = async (referendumId: BN) => {
  try {

    const config = await fsPromises.readFile(`${process.cwd()}/assets/frame/referendaSettings/${referendumId}.json`, 'utf8');
    logger.info(`reading config from /assets/frame/referendaSettings/${referendumId}.json`);
    return config
  }
  catch (e) {
    logger.info(`No settings file specified. Exiting.`);
    return "";
  }
}

export const getDragonBonusFile = async (referendumId: BN) => {
  try {

    const bonuses = await fsPromises.readFile(`${process.cwd()}/assets/frame/dragonBonus/${referendumId}.json`, 'utf8');
    logger.info(`reading bonuses from /assets/frame/dragonBonus/${referendumId}.json`);
    return bonuses
  }
  catch (e) {
    logger.info(`No bonus file specified. Exiting.`);
    return "";
  }
}

