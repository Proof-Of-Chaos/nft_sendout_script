import { ApiPromise } from "@polkadot/api";
import { params } from "../config.js";
import { CountAdapter } from "../tools/countAdapter.js";
import { handleEvents } from "./eventsHandler.js";
import { getApi, getBlockIndexer } from "../tools/substrateUtils.js";
import { logger } from "../tools/logger.js";
import { sleep } from "../tools/utils.js";

const MAX_RETRIES = 5;
const RETRY_DELAY_SECONDS = 4;

interface IStorageProvider {
    readonly storageKey: string;
    set(latestBlock: number): Promise<void>;
    get(): Promise<number>;
}

export class BlockListener {
    private apiPromise: ApiPromise;
    private initialised: boolean;
    private missingBlockFetchInitiated: boolean;
    public missingBlockEventsFetched: boolean;
    private currentBlockNumber: number;
    public storageProvider: IStorageProvider;
    constructor(
        polkadotApi: ApiPromise,
        storageProvider: IStorageProvider
    ) {
        if (!polkadotApi) {
            throw new Error(
                `"providerInterface" is missing. Please provide polkadot.js provider interface (i.e. websocket)`
            );
        }
        this.apiPromise = polkadotApi;
        this.initialised = false;
        this.missingBlockFetchInitiated = false;
        this.missingBlockEventsFetched = false;
        this.currentBlockNumber = 0;
        this.storageProvider =
            storageProvider || new CountAdapter(params.localStorage, "headerBlock");
        this.initialize();
    }

    private initialize = async () => {
        if (!this.initialised) {
            await this.initialiseListener();
            this.initialised = true;
        }
    };

    private fetchEventsAtBlock = async (blockNumber: number, retry = 0): Promise<void> => {
        try {
            const api = await getApi();
            const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
            const rawBlock = await api.rpc.chain.getBlock(blockHash);
            const blockApi = await api.at(blockHash);
            const block = rawBlock.block;
            const blockIndexer = getBlockIndexer(block);
            const events = await blockApi.query.system.events();
            await handleEvents(events, block.extrinsics, blockIndexer);
        } catch (error) {
            logger.info(
                `Error fetching extrinsics or events at block ${blockNumber}: ${error}`,
            );
            if (retry < MAX_RETRIES) {
                logger.info(`fetchEventsAtBlock Retry #${retry} of ${MAX_RETRIES}`);
                await sleep(RETRY_DELAY_SECONDS * 1000);
                return await this.fetchEventsAtBlock(blockNumber, retry + 1);
            } else {
                logger.error(`Error initiating tx fetchEventsAtBlock`, error);
                return error;
            }
        }
    };

    private fetchMissingBlockEvents = async (latestBlockDb: number, to: number): Promise<void> => {
        try {
            for (let i = latestBlockDb + 1; i <= to; i++) {
                await this.fetchEventsAtBlock(i);
            }
        } catch (e) {
            logger.error(`error fetching missing block ev. & extr. from ${latestBlockDb} to ${to}: ${e}`);
            return e;
        }
    };

    private async initialiseListener() {
        const headSubscriber = this.apiPromise.rpc.chain.subscribeFinalizedHeads;

        headSubscriber(async (header) => {
            const latestFinalisedBlockNum = header.number.toNumber();
            if (latestFinalisedBlockNum === 0) {
                logger.error(
                    "Unable to retrieve finalized head - returned genesis block"
                );
            }

            try {
                if (!this.missingBlockEventsFetched && !this.missingBlockFetchInitiated) {
                    this.missingBlockFetchInitiated = true;
                    const latestBlock = await this.storageProvider.get();
                    await this.fetchMissingBlockEvents(latestBlock, latestFinalisedBlockNum - 1);
                    this.missingBlockEventsFetched = true;
                }
                this.fetchEventsAtBlock(latestFinalisedBlockNum);

                const latestSavedBlock = this.currentBlockNumber;
                // Compare block sequence order to see if there's a skipped finalised block
                if (
                    latestSavedBlock &&
                    latestSavedBlock + 1 < latestFinalisedBlockNum &&
                    this.missingBlockEventsFetched
                ) {
                    // Fetch all the missing blocks
                    this.missingBlockEventsFetched = false;
                    await this.fetchMissingBlockEvents(
                        latestSavedBlock,
                        latestFinalisedBlockNum - 1
                    );
                    this.missingBlockEventsFetched = true;
                }
                this.currentBlockNumber = latestFinalisedBlockNum;
                // Update local db latestBlock
                if (
                    this.missingBlockEventsFetched
                ) {
                    try {
                        await this.storageProvider.set(latestFinalisedBlockNum);
                    } catch (e: any) {
                        logger.error(e);
                    }
                }
            } catch (e: any) {
                logger.error(e);
                return;
            }
        });
        return;
    }
}