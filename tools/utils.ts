import { params } from "../config.js";
import { GenericCall } from "@polkadot/types";
import { logger } from "../tools/logger.js";
import { createKeyMulti, encodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { Modules, MultisigMethods, ProxyMethods, UtilityMethods } from "./constants.js";
import BigNumber from "bignumber.js";
import { BN } from '@polkadot/util';
import fs from "fs";

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

export const getAccountName = async (account, short?: boolean) => {
  var accountInfo = await params.api.derive.accounts.info(account);
  if (accountInfo.identity.displayParent || accountInfo.identity.display) {
    var value = "";
    if (accountInfo.identity.displayParent) {
      value += accountInfo.identity.displayParent + ":";
    }
    if (accountInfo.identity.display) {
      value += accountInfo.identity.display;
    }
    return value;
  } else if (accountInfo.accountIndex) {
    return accountInfo.accountIndex;
  }
  return short ? account.substring(0, 6) + "..." + account.substring(account.length - 6) : account;
};

export const tryInitCall = (registry, callHex) => {
  try {
    return new GenericCall(registry, callHex);
  } catch (e) {
    logger.error(e.message, e.stack);
  }
};

export const getCall = async (blockHash, callHex) => {
  const registry = await params.api.getBlockRegistry(hexToU8a(blockHash));
  return tryInitCall(registry.registry, callHex) || null;
};

export const getMultiSigExtrinsicAddress = (args, signer) => {
  if (!args) {
    args = {};
  }
  const { threshold, other_signatories: otherSignatories } = args;

  return calcMultisigAddress(
    [signer, ...otherSignatories],
    threshold,
    params.api.registry.chainSS58
  );
};

export const calcMultisigAddress = (signatories, threshold, chainSS58) => {
  const multiPub = createKeyMulti(signatories, threshold);
  return encodeAddress(multiPub, chainSS58);
};

export const getRealSigner = async (normalizedExtrinsic) => {
  const { section, name, args, signer } = normalizedExtrinsic;

  if (name === ProxyMethods.proxy) {
    return args.real;
  }

  if (Modules.Multisig === section || MultisigMethods.asMulti === name) {
    // handle multisig transaction
    return await getMultiSigExtrinsicAddress(args, signer);
  }
  return signer;
};

export const findTargetCallFromProxy = (proxyCall, targetSection, targetMethod) => {
  const innerCall = proxyCall.args[2];
  return findTargetCall(innerCall, targetSection, targetMethod);
};

export const findTargetCallFromMultisig = (multisigCall, targetSection, targetMethod) => {
  const callHex = multisigCall.args[3];
  const innerCall = new GenericCall(multisigCall.registry, callHex);
  return findTargetCall(innerCall, targetSection, targetMethod);
};

export const findTargetCallFromBatch = (batchCall, targetSection, targetMethod) => {
  for (const innerCall of batchCall.args[0]) {
    const call = findTargetCall(innerCall, targetSection, targetMethod);
    if (call.section === targetSection && call.method === targetMethod) {
      //FIXME: here we only get the first call which has the target section and target method, but there maybe multiple
      // these kinds of calls in batch extrinsic. Need more info to figure out the target call.
      return call;
    }
  }

  return batchCall;
};

export const findTargetCall = (call, targetSection, targetMethod) => {
  const { section, method } = call;

  if (Modules.Proxy === section && ProxyMethods.proxy === method) {
    return findTargetCallFromProxy(call, targetSection, targetMethod);
  }

  if (Modules.Multisig === section && MultisigMethods.asMulti === method) {
    return findTargetCallFromMultisig(call, targetSection, targetMethod);
  }

  if (Modules.Utility === section && UtilityMethods.batch === method) {
    return findTargetCallFromBatch(call, targetSection, targetMethod);
  }

  if (call.section === targetSection && call.method === targetMethod) {
    return call;
  }

  return null;
};

export const findCallInSections = (call, sections, targetMethod) => {
  for (const section of sections) {
    let result = findTargetCall(call, section, targetMethod);
    if (result) {
      return result;
    }
  }

  return null;
};

export const normalizeCall = (call) => {
  const { section, method } = call;
  const callIndex = u8aToHex(call.callIndex);

  const args = [];
  for (let index = 0; index < call.args.length; index++) {
    const arg = call.args[index];

    const argMeta = call.meta.args[index];
    const name = argMeta.name.toString();
    const type = argMeta.type.toString();
    if (type === "Call" || type === "CallOf") {
      args.push({
        name,
        type,
        value: normalizeCall(arg),
      });
      continue;
    }

    if (type === "Vec<Call>" || type === "Vec<CallOf>") {
      args.push({
        name,
        type,
        value: arg.map(normalizeCall),
      });
      continue;
    }

    args.push({
      name,
      type,
      value: arg.toJSON(),
    });
  }

  return {
    callIndex,
    section,
    method,
    args,
  };
}

export const getBlockHash = async (height) => {
  return await params.api.rpc.chain.getBlockHash(height);
};

export const isExtrinsicSuccess = (events) => {
  return events.some((e) => e.event.method === "ExtrinsicSuccess");
}

export const amountToHumanString = (amount: string, afterCommas?: number): string => {
  const token = params.settings.network.token;
  const value = new BigNumber(amount.toString())
    .dividedBy(new BigNumber("1e" + params.api.registry.chainDecimals))
    .toFixed(afterCommas ? afterCommas : 5, BigNumber.ROUND_FLOOR);
  const tokenString = token ? " " + token : "";
  return value + tokenString;
};

export const getSettingsFile = async (referendumId: BN) => {
  try {

    const settings = await fsPromises.readFile(`${process.cwd()}/assets/shelf/referendaSettings/${referendumId}.json`, 'utf8');
    logger.info(`reading settings from /assets/shelf/referendaSettings/${referendumId}.json`);
    return settings
  }
  catch (e) {
    logger.info(`No settings file specified. Exiting.`);
    return "";
  }
}