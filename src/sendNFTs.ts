import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleMetadataFromDir } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Collection, NFT } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { INftProps } from "../types.js";
import { mintAndSend } from "../tools/substrateUtils.js";
import { sleep } from "../tools/utils.js";
import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { AccountId, VotingDelegating, VotingDirectVote } from "@polkadot/types/interfaces";
import { PalletDemocracyVoteVoting } from "@polkadot/types/lookup";
import { ApiDecoration } from "@polkadot/api/types";
import { saveVotesToDB } from "./saveVotesToDB.js";

const fsPromises = fs.promises;

const extractVotes = (mapped: [AccountId, PalletDemocracyVoteVoting][], referendumId: BN) => {
    return mapped
        .filter(([, voting]) => voting.isDirect)
        .map(([accountId, voting]): [AccountId, VotingDirectVote[]] => [
            accountId,
            voting.asDirect.votes.filter(([idx]) => idx.eq(referendumId))
        ])
        .filter(([, directVotes]) => !!directVotes.length)
        .reduce((result: DeriveReferendumVote[], [accountId, votes]) =>
            // FIXME We are ignoring split votes
            votes.reduce((result: DeriveReferendumVote[], [, vote]): DeriveReferendumVote[] => {
                if (vote.isStandard) {
                    result.push({
                        accountId,
                        isDelegating: false,
                        ...vote.asStandard
                    });
                }

                return result;
            }, result), []
        );
}

const votesCurr = async (api: ApiDecoration<"promise">, referendumId: BN) => {
    const allVoting = await api.query.democracy.votingOf.entries()
    //console.log("allVoting", allVoting)
    const mapped = allVoting.map(([{ args: [accountId] }, voting]): [AccountId, PalletDemocracyVoteVoting] => [accountId, voting]);
    const votes: DeriveReferendumVote[] = extractVotes(mapped, referendumId);
    const delegations = mapped
        .filter(([, voting]) => {
            voting.isDelegating
        })
        .map(([accountId, voting]): [AccountId, VotingDelegating] => [accountId, voting.asDelegating]);

    // add delegations
    delegations.forEach(([accountId, { balance, conviction, target }]): void => {
        // Are we delegating to a delegator
        const toDelegator = delegations.find(([accountId]) => accountId.eq(target));
        const to = votes.find(({ accountId }) => accountId.eq(toDelegator ? toDelegator[0] : target));

        // this delegation has a target
        if (to) {
            votes.push({
                accountId,
                balance,
                isDelegating: true,
                vote: api.registry.createType('Vote', { aye: to.vote.isAye, conviction })
            });
        }
    });
    return votes;
}

const getVotesAndIssuance = async (referendumIndex: BN): Promise<[String, DeriveReferendumVote[]]> => {
    const info = await params.api.query.democracy.referendumInfoOf(referendumIndex);
    let blockNumber: BN;
    try {
        blockNumber = info.unwrap().asFinished.end
    }
    catch (e) {
        logger.error(`Referendum is still ongoing: ${e}`);
        return;
    }
    const blockHash = await params.api.rpc.chain.getBlockHash(blockNumber);
    const blockApi = await params.api.at(blockHash);
    const totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
    return [totalIssuance, await votesCurr(blockApi, referendumIndex)];
}

export const sendNFTs = async (passed: boolean, referendumIndex: BN, indexer) => {
    //wait a bit since blocks after will be pretty full
    await sleep(10000);
    let votes: DeriveReferendumVote[];
    let totalIssuance: String;
    [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex);
    console.log("Number of votes: ", votes.length)
    await saveVotesToDB(referendumIndex, votes, totalIssuance, passed, indexer);
    // upload file to pinata
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
                `Let's keep shaping our future together.\n\nGet notified as soon as a new referendum ` +
                `is up for vote: https://t.me/referendumAlertKusamaBot`,
        }
    );

    if (!metadataCid) {
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
    logger.info(`NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
    await sleep(10000);
    //send nfts
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