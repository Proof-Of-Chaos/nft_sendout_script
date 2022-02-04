import { params } from "../config.js";
import { amountToHumanString, votesCurr } from "../utils.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleMetadataFromDir } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Collection, NFT } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { INftProps } from "../types.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { getTransactionCost, mintAndSend } from "../tools/substrateUtils.js";

const fsPromises = fs.promises;

const getVotes = async (referendumIndex: BN) => {
    const info = await params.api.query.democracy.referendumInfoOf(referendumIndex);
    let blockNumber;
    try {
        blockNumber = info.unwrap().asFinished.end.toNumber()
    }
    catch (e) {
        logger.error(`Referendum is still ongoing: ${e}`);
        return;
    }
    const blockHash = await params.api.rpc.chain.getBlockHash(blockNumber - 1);
    const blockApi = await params.api.at(blockHash);
    return await votesCurr(blockApi, referendumIndex);
}

export const sendNFTs = async (passed: boolean, referendumIndex: BN) => {
    const votes = await getVotes(referendumIndex);
    console.log("vle", votes.length)
    //upload file to pinata
    let imagePath;
    try {
        await fsPromises.readFile(`${process.cwd()}/assets/${referendumIndex}.png`);
        imagePath = `${referendumIndex}.png`;
    }
    catch (e) {
        imagePath = "default.png";
    }

    const metadataCid = await pinSingleMetadataFromDir("/assets",
        imagePath,
        `Referendum ${referendumIndex}`,
        {
            description: `Thank you for casting your vote on Referendum ${referendumIndex}.\n\n` +
                `With your vote you have forever changed ${params.settings.network.name}!\n\n` +
                `Let's keep shaping our future together.`,
            properties: {},
        }
    );
    const collectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.collectionSymbol
    );
    const remarks: string[] = [];
    let count = 0;
    for (const vote of votes) {
        const nftProps: INftProps = {
            block: 0,
            sn: (count++).toString(),
            owner: encodeAddress(params.account.address, params.settings.network.prefix),
            transferable: 1,
            metadata: metadataCid,
            collection: collectionId,
            symbol: referendumIndex.toString(),
        };
        const nft = new NFT(nftProps);

        remarks.push(nft.mint(vote.accountId.toString()));
    }
    console.log("remarks", remarks)
    const { block, success, hash, fee } = await mintAndSend(remarks);
    console.log(`NFTs sent at block ${block}: ${success} for a total fee of ${fee}`)
    logger.info(`NFTs sent at block ${block}: ${success} for a total fee of ${fee}`)
}