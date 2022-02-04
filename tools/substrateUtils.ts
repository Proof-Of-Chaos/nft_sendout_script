import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";
import { SubmittableExtrinsic } from "@polkadot/api/types";
import { ISubmittableResult } from "@polkadot/types/types";
import { params } from "../config.js";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Block, RuntimeDispatchInfo } from "@polkadot/types/interfaces";
import { logger } from "./logger.js";

export const getApi = async (): Promise<ApiPromise> => {
  const wsNodeUri = process.env.WS_NODE_URI || "ws://127.0.0.1:9944/";
  const wsProvider = new WsProvider(wsNodeUri);
  const api = await ApiPromise.create({ provider: wsProvider });
  return api;
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
    console.error("Unable to retrieve finalized head - returned genesis block");
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

export const sendAndFinalize = async (
  tx: SubmittableExtrinsic<"promise", ISubmittableResult>,
  account: KeyringPair
): Promise<{
  block: number;
  success: boolean;
  hash: string;
  included: any[];
  finalized: any[];
}> => {
  return new Promise(async (resolve) => {
    let success = false;
    let included = [];
    let finalized = [];
    let block = 0;
    const unsubscribe = await tx.signAndSend(
      account,
      async ({ events = [], status, dispatchError }) => {
        if (status.isInBlock) {
          console.log(`status: ${status}`);

          success = dispatchError ? false : true;
          console.log(
            `📀 Transaction ${tx.meta.name} included at blockHash ${status.asInBlock} [success = ${success}]`
          );
          const signedBlock = await params.api.rpc.chain.getBlock(status.asInBlock);
          block = signedBlock.block.header.number.toNumber();
          included = [...events];
        } else if (status.isBroadcast) {
          console.log(`🚀 Transaction broadcasted.`);
        } else if (status.isFinalized) {
          console.log(
            `💯 Transaction ${tx.meta.name}(..) Finalized at blockHash ${status.asFinalized}`
          );
          finalized = [...events];
          const hash = tx.hash.toHex();
          unsubscribe();
          resolve({ success, hash, included, finalized, block });
        } else if (status.isReady) {
          // let's not be too noisy..
        } else {
          console.log(`🤷 Other status ${status}`);
        }
      }
    );
  });
};

export const getTransactionCost = async (
  toSendRemarks: string[]): Promise<RuntimeDispatchInfo> => {
  try {
    //get mint and transfer cost
    const remarks = toSendRemarks;
    const txs = [];
    for (const remark of remarks) {
      txs.push(params.api.tx.system.remark(remark));
    }
    const info = await params.api.tx.utility
      .batchAll(txs)
      .paymentInfo(params.account.address);
    return info;

  }
  catch (error) {
    console.error(error)
  }
};

export const mintAndSend = async (remarks: string[]): Promise<{
    block?: number;
    success: boolean;
    hash?: string;
    fee?: string;
    topupRequired?: boolean;
  }> => {
  const info = await getTransactionCost(
    remarks
  );
  console.log("total expected cost: ", info.partialFee.toHuman())
  logger.info("total expected cost: ", info.partialFee.toHuman())
  const txs = [];
  for (const remark of remarks) {
    txs.push(params.api.tx.system.remark(remark));
  }
  try {
    const batch = params.api.tx.utility.batchAll(txs);
    const { block, hash, success } = await sendAndFinalize(batch, params.account);
    return { block, success, hash, fee: info.partialFee.toHuman() };
  }
  catch (error) {
    //write error to console
    console.error(error);
    logger.error(error)
    return { success: false };
  }
};