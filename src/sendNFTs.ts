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
import { sleep } from "../tools/utils.js";

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
    //wait a bit since blocks after will be pretty full
    await sleep(10000);
    const votes = await getVotes(referendumIndex);
    //upload file to pinata
    let imagePath;
    try {
        await fsPromises.readFile(`${process.cwd()}/assets/referenda/${referendumIndex}.png`);
        imagePath = `referenda/${referendumIndex}.png`;
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
                `Let's keep shaping our future together.\n\nGet alerted as soon as a new referendum `+
                `is up for vote: https://t.me/referendumAlertKusamaBot`,
        }
    );

    if (!metadataCid){
        logger.error(`metadataCid is null: ${metadataCid}. exiting.`)
        return;
    }

    const collectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.collectionSymbol
    );
    const mintRemarks: string[] = [];
    let count = 0;
    for (const vote of votes) {
        const nftProps: INftProps = {
            block: 0,
            collection: collectionId,
            name: referendumIndex.toString(),
            instance: referendumIndex.toString(),
            transferable: 1,
            sn: (count++).toString(),
            metadata: metadataCid,
        };
        const nft = new NFT(nftProps.block,
            nftProps.collection,
            nftProps.name,
            nftProps.instance,
            nftProps.transferable,
            nftProps.sn,
            nftProps.metadata);
        mintRemarks.push(nft.mintnft());
    }
    console.log("mintRemarks", mintRemarks)
    //mint
    const { block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks);
    if (!successMint) {
        logger.info(`Failure minting NFTS at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
        return;
    }
    //send nfts
    logger.info(`NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
    const sendRemarks: string[] = [];
    count = 0;
    for (const vote of votes) {
        const nftProps: INftProps = {
            block: blockMint,
            collection: collectionId,
            name: referendumIndex.toString(),
            instance: referendumIndex.toString(),
            transferable: 1,
            sn: (count++).toString(),
            metadata: metadataCid,
        };
        const nft = new NFT(nftProps.block,
            nftProps.collection,
            nftProps.name,
            nftProps.instance,
            nftProps.transferable,
            nftProps.sn,
            nftProps.metadata);
        sendRemarks.push(nft.send(vote.accountId.toString()))
    }
    console.log("sendRemarks", sendRemarks)
    //send
    const { block: blockSend, success: successSend, hash: hashSend, fee: feeSend } = await mintAndSend(sendRemarks);
    if (!successMint) {
        logger.info(`Failure sending NFTS at block ${blockSend}: ${successSend} for a total fee of ${feeSend}`)
        return;
    }
    //send nfts
    logger.info(`NFTs sent at block ${blockSend}: ${successSend} for a total fee of ${feeSend}`)
}