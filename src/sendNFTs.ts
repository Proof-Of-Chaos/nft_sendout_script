import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleMetadataFromDir } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Collection, NFT } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { INftProps } from "../types.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { mintAndSend } from "../tools/substrateUtils.js";
import { getSettingsFile, sleep } from "../tools/utils.js";
import { createMosaicTiles, createParentCanvas, mergeImages } from "./imageCreator.js";
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
    // let settingsFile = await getSettingsFile(referendumIndex);
    // let settings = await JSON.parse(settingsFile);
    const cutOffBlock = params.settings.blockCutoff && params.settings.blockCutOff != "-1" ?
        params.settings.blockCutoff : blockNumber
    const blockHash = await params.api.rpc.chain.getBlockHash(cutOffBlock);
    const blockApi = await params.api.at(blockHash);
    const totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
    return [totalIssuance, await votesCurr(blockApi, referendumIndex)];
}

const filterVotes = async (referendumId: BN, votes: DeriveReferendumVote[]): Promise<DeriveReferendumVote[]> => {
    let settingsFile = await getSettingsFile(referendumId);
    let settings = await JSON.parse(settingsFile);
    const minVote = BN.max(new BN(settings.min), new BN("0"));
    const maxVote = BN.min(new BN(settings.max), new BN("10000000000000000000"));
    console.log("min", minVote);
    console.log("max", maxVote);
    let filtered = votes.filter((vote) => {
        return (new BN(vote.balance).gte(minVote) &&
            new BN(vote.balance).lte(maxVote))
    })
    if (settings.first !== "-1") {
        return filtered.slice(0, parseInt(settings.first))
    }
    // if (settings.top !== "-1") {
    //     const sorted = filtered.sort((a, b) => (new BN(a.balance).gt(new BN(b.balance))) ? 1 : ((new BN(b.balance).gt(new BN(a.balance))) ? -1 : 0))
    //     return sorted.slice(0, parseInt(settings.top))
    // }
    return filtered
}

const getParentlessAccounts = async (votes: DeriveReferendumVote[], collectionId): Promise<AccountId[]> => {
    let accounts: AccountId[] = [];
    for (const vote of votes) {
        let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(collectionId);
        if (!allNFTs.find(({ owner, rootowner, symbol }) => {
            owner === vote.accountId &&
                rootowner === params.account &&
                symbol === params.settings.parentNFTSymbol
        })) {
            accounts.push(vote.accountId)
        }
    }
    return accounts;
}

export const sendNFTs = async (passed: boolean, referendumIndex: BN, indexer) => {
    const collectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.collectionSymbol
    );
    //wait a bit since blocks after will be pretty full
    //await sleep(10000);
    let votes: DeriveReferendumVote[];
    let totalIssuance: String;
    [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex);
    console.log("Number of votes: ", votes.length)
    await saveVotesToDB(referendumIndex, votes, totalIssuance, passed, indexer);
    console.log("votesl", votes.length)
    console.log("votes", votes)
    //filter votes on criteria
    const filteredVotes: DeriveReferendumVote[] = await filterVotes(referendumIndex, votes);
    console.log("filteredVotesl", filteredVotes.length)
    console.log("filteredVotes", filteredVotes.map((vote) => vote.balance.toString()))
    if (filteredVotes.length === 0) {
        return;
    }
    createParentCanvas();
    //upload parent canvas to pinata
    const parentMetadataCid = await pinSingleMetadataFromDir("/assets",
        "mosaic/parent.png",
        `Your Canvas`,
        {
            description: `With each vote on a referendum, this canvas will get filled up more. Give your creativity free reign.`,
            properties: {},
        }
    );
    if (!parentMetadataCid) {
        logger.error(`parentMetadataCid is null: ${parentMetadataCid}. exiting.`)
        return;
    }
    //check which wallets don't have the parent nft
    const accountsWithoutParent: AccountId[] = await getParentlessAccounts(filteredVotes, collectionId)
    //send parent canvas to wallets that don't have one yet
    if (accountsWithoutParent.length > 0) {
        const parentRemarks: string[] = [];
        let count = 0
        for (const account of accountsWithoutParent) {
            const nftProps: INftProps = {
                block: 0,
                sn: (count++).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: 1,
                metadata: parentMetadataCid,
                collection: collectionId,
                symbol: params.settings.parentNFTSymbol,
            };
            const nft = new NFT(nftProps);

            parentRemarks.push(nft.mint(account.toString()));
        }
        console.log("parentRemarks", parentRemarks)
        const { block, success, hash, fee } = await mintAndSend(parentRemarks);
        logger.info(`Parent NFTs sent at block ${block}: ${success} for a total fee of ${fee}`)
        //wait until remark block has caught up with block
        while (block <= await params.remarkBlockCountAdapter.get()) {
            await sleep(3000);
        }
        //add base resource to parent nfts
        const addBaseRemarks: string[] = [];
        //get base
        const bases = params.remarkStorageAdapter.getAllBases();
        const BASE_ID = bases[0].getId();
        count = 0;
        for (const account of accountsWithoutParent) {
            const nftProps: INftProps = {
                block: block,
                sn: (count).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: 1,
                metadata: parentMetadataCid,
                collection: collectionId,
                symbol: params.settings.parentNFTSymbol,
            };
            const nft = new NFT(nftProps);

            addBaseRemarks.push(
                nft.resadd({
                    base: BASE_ID,
                    id: (count++).toString(),
                    parts: [
                        `chunky_body_${sn}`,
                        `chunky_head_${sn}`,
                        `chunky_hand_${sn}`,
                        "chunky_objectLeft",
                        "chunky_objectRight",
                    ],
                    thumb: `ipfs://ipfs/${ASSETS_CID}/Chunky%20Preview.png`,
                })
            );
        }
    }



    //check if specific settings file
    let settingsFile = await getSettingsFile(referendumIndex);
    let settings = await JSON.parse(settingsFile);
    logger.info(`settings:\n${settings.colors}`);
    for (let i = 0; i < settings.tilesToSend; i++) {
        let indeces: string[] = await createMosaicTiles(referendumIndex)
        if (indeces === ["-1", "-1"]) {
            return;
        }
        let filePaths = await fsPromises.readdir(`${process.cwd()}/assets/mosaic/${indeces[0]}-${indeces[1]}`);
        let metadataCids: string[] = [];
        for (const filePath of filePaths) {
            const metadataCid = await pinSingleMetadataFromDir("/assets",
                filePath,
                `${indeces[0]}-${filePath.split(".")[0]}`,
                {
                    description: `Thank you for casting your vote on Referendum ${referendumIndex}.\n\n` +
                        `With your vote you have forever changed ${params.settings.network.name}!\n\n` +
                        `Let's keep shaping our future together.\n\n${settings.text}`,
                    properties: {},
                }
            );
            metadataCids.push(metadataCid);
        }
        if (metadataCids.length < 1) {
            logger.error(`metadataCids array is null: ${metadataCids}. exiting.`)
            return;
        }
        const nftRemarks: string[] = [];
        let count = 0;
        for (const vote of votes) {
            //get a random metadataCid
            let metadataCid = metadataCids[Math.floor(Math.random() * metadataCids.length)];
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
            //get the parent nft
            let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(collectionId);
            allNFTs.find(({ owner, rootowner, symbol }) => {
                owner === vote.accountId.toString() &&
                    rootowner === params.account &&
                    symbol === params.settings.parentNFTSymbol
            })
            nftRemarks.push(nft.mint(vote.accountId.toString()));
        }
        console.log("remarks", nftRemarks)
        //split remarks into sets of 100?
        const { block, success, hash, fee } = await mintAndSend(nftRemarks);
        logger.info(`NFTs sent at block ${block}: ${success} for a total fee of ${fee}`)
    }
}