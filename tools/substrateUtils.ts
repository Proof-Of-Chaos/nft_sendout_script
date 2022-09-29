import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";
import { SubmittableExtrinsic } from "@polkadot/api/types";
import { ISubmittableResult } from "@polkadot/types/types";
import { params } from "../config.js";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Block, RuntimeDispatchInfo } from "@polkadot/types/interfaces";
import { logger } from "./logger.js";
import { CodecHash, EventRecord } from '@polkadot/types/interfaces';
import { sleep } from "./utils.js";
import BigNumber from "bignumber.js";

// 'wss://staging.node.rmrk.app'

const WS_ENDPOINTS = [
  'wss://kusama-rpc.polkadot.io',
  'wss://kusama.api.onfinality.io/public-ws',
  'wss://kusama-rpc.dwellir.com'
];

const WS_ENDPOINTS_TEST = [
  'wss://staging.node.rmrk.app'
];

const MAX_RETRIES = 15;
const WS_DISCONNECT_TIMEOUT_SECONDS = 20;
const RETRY_DELAY_SECONDS = 20;

interface ISendTxReturnType {
  success: boolean;
  hash?: CodecHash;
  included: EventRecord[];
  finalized: EventRecord[];
  block: number;
}

let wsProvider: WsProvider;
let polkadotApi: ApiPromise;
let wsProviderTest: WsProvider;
let polkadotApiTest: ApiPromise;
let healthCheckInProgress = false;

/**
 *
 * @param wsEndpoints - array of rpc ws endpoints. In the order of their priority
 */
const providerHealthCheck = async (wsEndpoints: string[]) => {
  const [primaryEndpoint, secondaryEndpoint, ...otherEndpoints] = wsEndpoints;
  logger.info(
    `Performing ${WS_DISCONNECT_TIMEOUT_SECONDS} seconds health check for WS Provider fro rpc ${primaryEndpoint}.`,
  );
  healthCheckInProgress = true;
  await sleep(WS_DISCONNECT_TIMEOUT_SECONDS * 1000);
  if (wsProvider.isConnected) {
    logger.info(`All good. Connected back to ${primaryEndpoint}`);
    healthCheckInProgress = false;
    return true;
  } else {
    logger.info(
      `rpc endpoint ${primaryEndpoint} still disconnected after ${WS_DISCONNECT_TIMEOUT_SECONDS} seconds. Disconnecting from ${primaryEndpoint} and switching to a backup rpc endpoint ${secondaryEndpoint}`,
    );
    await wsProvider.disconnect();

    healthCheckInProgress = false;
    throw new Error(
      `rpc endpoint ${primaryEndpoint} still disconnected after ${WS_DISCONNECT_TIMEOUT_SECONDS} seconds.`,
    );
  }
};

/**
 *
 * @param wsEndpoints - array of rpc ws endpoints. In the order of their priority
 */
const getProvider = async (wsEndpoints: string[]) => {
  const [primaryEndpoint, ...otherEndpoints] = wsEndpoints;
  return await new Promise<WsProvider | undefined>((resolve, reject) => {
    wsProvider = new WsProvider(primaryEndpoint);
    wsProvider.on('disconnected', async () => {
      logger.info(`WS provider for rpc ${primaryEndpoint} disconnected!`);
      if (!healthCheckInProgress) {
        try {
          await providerHealthCheck(wsEndpoints);
          resolve(wsProvider);
        } catch (error: any) {
          reject(error);
        }
      }
    });
    wsProvider.on('connected', () => {
      logger.info(`WS provider for rpc ${primaryEndpoint} connected`);
      resolve(wsProvider);
    });
    wsProvider.on('error', async () => {
      logger.info(`Error thrown for rpc ${primaryEndpoint}`);
      if (!healthCheckInProgress) {
        try {
          await providerHealthCheck(wsEndpoints);
          resolve(wsProvider);
        } catch (error: any) {
          reject(error);
        }
      }
    });
  });
};

/**
 *
 * @param wsEndpoints - array of rpc ws endpoints. In the order of their priority
 * @param retry - retry count
 */
export const getApi = async (
  wsEndpoints: string[] = WS_ENDPOINTS,
  retry = 0,
): Promise<ApiPromise> => {
  if (wsProvider && polkadotApi && polkadotApi.isConnected) return polkadotApi;
  const [primaryEndpoint, secondaryEndpoint, ...otherEndpoints] = wsEndpoints;

  try {
    const provider = await getProvider(wsEndpoints);
    polkadotApi = await ApiPromise.create({ provider });
    await polkadotApi.isReady;
    return polkadotApi;
  } catch (error: any) {
    if (retry < MAX_RETRIES) {
      // If we have reached maximum number of retries on the primaryEndpoint, let's move it to the end of array and try the secondary endpoint
      return await getApi([secondaryEndpoint, ...otherEndpoints, primaryEndpoint], retry + 1);
    } else {
      return polkadotApi;
    }
  }
};

export const getApiTest = async (
  wsEndpoints: string[] = WS_ENDPOINTS_TEST,
  retry = 0,
): Promise<ApiPromise> => {
  if (wsProviderTest && polkadotApiTest && polkadotApiTest.isConnected) return polkadotApiTest;
  const [primaryEndpoint, secondaryEndpoint, ...otherEndpoints] = wsEndpoints;

  try {
    const provider = await getProvider(wsEndpoints);
    polkadotApiTest = await ApiPromise.create({ provider });
    await polkadotApiTest.isReady;
    return polkadotApiTest;
  } catch (error: any) {
    if (retry < MAX_RETRIES) {
      // If we have reached maximum number of retries on the primaryEndpoint, let's move it to the end of array and try the secondary endpoint
      return await getApiTest([secondaryEndpoint, ...otherEndpoints, primaryEndpoint], retry + 1);
    } else {
      return polkadotApiTest;
    }
  }
};

export const initAccount = (): KeyringPair => {
  const keyring = new Keyring({ type: "sr25519" });
  const account = keyring.addFromUri(process.env.MNEMONIC);
  return account;
};

export const getLatestFinalizedBlock = async (
  api: ApiPromise
): Promise<number> => {
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  if (header.number.toNumber() === 0) {
    logger.error("Unable to retrieve finalized head - returned genesis block");
    process.exit(1);
  }
  return header.number.toNumber();
};

export const extractBlockTime = (extrinsics) => {
  const setTimeExtrinsic = extrinsics.find(
    (ex) => ex.method.section === "timestamp" && ex.method.method === "set"
  );
  if (setTimeExtrinsic) {
    const { args } = setTimeExtrinsic.method.toJSON();
    return args.now;
  }
};

export const getBlockIndexer = (block: Block) => {
  const blockHash = block.hash.toHex();
  const blockHeight = block.header.number.toNumber();
  const blockTime = extractBlockTime(block.extrinsics);

  return {
    blockHeight,
    blockHash,
    blockTime,
  };
}






/**
 *
 * @param tx - polkadot.js api tx
 * @param account - Account keypair
 * @param resolvedOnFinalizedOnly - If you don't want to wait for promise to resolve only when the block is finalized,
 * it can resolve as soon as tx is added to a block. This doesn't guarantee that transaction block will be included in finalised chain.
 * true by default
 * @param retry - retry count in case of failure.
 */
export const sendAndFinalize = async (
  tx: SubmittableExtrinsic<'promise', ISubmittableResult>,
  account: KeyringPair,
  resolvedOnFinalizedOnly = true,
  retry = 0,
): Promise<ISendTxReturnType> => {
  return new Promise(async (resolve, reject) => {
    const api = params.settings.isTest ? await getApiTest() : await getApi() ;

    const returnObject: ISendTxReturnType = { success: false, hash: undefined, included: [], finalized: [], block: 0 }

    try {
      const unsubscribe = await tx.signAndSend(
        account,
        { nonce: -1 },
        async ({ events = [], status, dispatchError }) => {
          returnObject.success = !dispatchError;
          returnObject.included = [...events];
          returnObject.hash = status.hash;

          const rejectPromise = (error: any) => {
            logger.error(`Error sending tx`, error);
            logger.info(`tx for the error above`, tx.toHuman());
            unsubscribe();
            reject(error);
          }

          if (status.isInBlock) {
            logger.info(
              `📀 Transaction ${tx.meta.name} included at blockHash ${status.asInBlock} [success = ${!dispatchError}]`,
            );

            // Get block number that this tx got into, to return back to user
            const signedBlock = await api.rpc.chain.getBlock(status.asInBlock);
            returnObject.block = signedBlock.block.header.number.toNumber();

            // If we don't care about waiting for this tx to get into a finalized block, we can return early.
            if (!resolvedOnFinalizedOnly && !dispatchError) {
              unsubscribe();
              resolve(returnObject);
            }
          } else if (status.isBroadcast) {
            logger.info(`🚀 Transaction broadcasted.`);
          } else if (status.isFinalized) {
            logger.info(
              `💯 Transaction ${tx.meta.name}(..) Finalized at blockHash ${status.asFinalized}`,
            );
            if (returnObject.block === 0) {
              const signedBlock = await api.rpc.chain.getBlock(status.asInBlock);
              returnObject.block = signedBlock.block.header.number.toNumber();
            }
            unsubscribe();
            resolve(returnObject);
          } else if (status.isReady) {
            // let's not be too noisy..
          } else if (status.isInvalid) {
            rejectPromise(new Error(`Extrinsic isInvalid`))
          } else {
            logger.info(`🤷 Other status ${status}`);
          }
        },
      );
    } catch (error: any) {
      logger.info(
        `Error sending tx. Error: "${error.message}". TX: ${JSON.stringify(tx.toHuman())}`,
      );
      if (retry < MAX_RETRIES) {
        logger.info(`sendAndFinalize Retry #${retry} of ${MAX_RETRIES}`);
        await sleep(RETRY_DELAY_SECONDS * 1000);
        const result = await sendAndFinalize(tx, account, resolvedOnFinalizedOnly, retry + 1);
        resolve(result);
      } else {
        logger.error(`Error initiating tx signAndSend`, error);
        reject(error);
      }
    }
  });
};

export const getTransactionCost = async (
  toSendRemarks: string[]): Promise<RuntimeDispatchInfo> => {
  try {
    //get mint and transfer cost
    const remarks = toSendRemarks;
    const txs = [];
    const api = params.settings.isTest ? await getApiTest() : await getApi() ;
    for (const remark of remarks) {
      txs.push(api.tx.system.remark(remark));
    }
    const info = await api.tx.utility
      .batchAll(txs)
      .paymentInfo(params.account.address);
    return info;

  }
  catch (error) {
    logger.error(error)
  }
};

export const sendBatchTransactions = async (remarks: string[]): Promise<{
  block?: number;
  success: boolean;
  hash?: string;
  fee?: string;
  topupRequired?: boolean;
}> => {
  // const info = await getTransactionCost(
  //   remarks
  // );
  // logger.info("total expected cost: ", info.partialFee.toHuman())
  const txs = [];
  const api = params.settings.isTest ? await getApiTest() : await getApi() ;
  for (const remark of remarks) {
    txs.push(api.tx.system.remark(remark));
  }
  try {
    const batch = api.tx.utility.batchAll(txs);
    const { block, hash, success } = await sendAndFinalize(batch, params.account);
    return { block, success, hash: hash.toString(), fee: null }; //info.partialFee.toHuman()
  }
  catch (error) {
    //write error to logger
    logger.error(error)
    return { success: false };
  }
};

export const getDecimal = async (bigNum: string) => {
  const api = await getApi()
  return new BigNumber(bigNum).dividedBy(new BigNumber("1e" + api.registry.chainDecimals)).toNumber()
}