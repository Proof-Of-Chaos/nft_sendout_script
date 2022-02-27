import { ApiPromise } from "@polkadot/api";
import { params } from "../config.js";
import { BlockCountAdapter } from "../tools/blockCountAdapter.js";
import { handleEvents } from "./eventsHandler.js";
import { getBlockIndexer } from "../tools/substrateUtils.js";
import { logger } from "../tools/logger.js";

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
            storageProvider || new BlockCountAdapter(params.localStorage, "headerBlock");
        this.initialize();
    }

    private initialize = async () => {
        if (!this.initialised) {
            await this.initialiseListener();
            this.initialised = true;
        }
    };

    private fetchEventsAtBlock = async (blockNumber: number): Promise<void> => {
        try {
            const blockHash = await params.api.rpc.chain.getBlockHash(blockNumber);
            const rawBlock = await params.api.rpc.chain.getBlock(blockHash);
            const blockApi = await params.api.at(blockHash);
            const block = rawBlock.block;
            const blockIndexer = getBlockIndexer(block);
            const events = await blockApi.query.system.events();
            await handleEvents(events, block.extrinsics, blockIndexer);
        } catch (e) {
            logger.error(`error fetching extrinsics or events at block ${blockNumber}: ${e}`);
            return e;
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
                console.error(
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
                        console.error(e);
                    }
                }
            } catch (e: any) {
                console.error(e);
                return;
            }
        });
        return;
    }
}