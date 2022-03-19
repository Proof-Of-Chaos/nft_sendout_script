import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleFileFromDir, pinSingleMetadataFromDir, pinSingleMetadataWithoutFile, pinSingleWithThumbMetadataFromDir } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Collection, NFT } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { INftProps } from "../types.js";
import { mintAndSend } from "../tools/substrateUtils.js";
import { getSettingsFile, sleep } from "../tools/utils.js";
import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { AccountId, VotingDelegating, VotingDirectVote } from "@polkadot/types/interfaces";
import { PalletDemocracyVoteVoting } from "@polkadot/types/lookup";
import { ApiDecoration } from "@polkadot/api/types";
import { saveVotesToDB } from "./saveVotesToDB.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { nanoid } from "nanoid";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";

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
    //logger.info("allVoting", allVoting)
    const mapped = allVoting.map(([{ args: [accountId] }, voting]): [AccountId, PalletDemocracyVoteVoting] => [accountId, voting]);
    const votes: DeriveReferendumVote[] = extractVotes(mapped, referendumId);
    const delegations = mapped
        .filter(([, voting]) => voting.isDelegating)
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

const filterVotes = async (referendumId: BN, votes: DeriveReferendumVote[], totalIssuance: string, settings): Promise<DeriveReferendumVote[]> => {
    const minVote = BN.max(new BN(settings.min), new BN("0"));
    const maxVote = BN.min(new BN(settings.max), new BN(totalIssuance));
    logger.info("min", minVote.toString());
    logger.info("max", maxVote.toString());
    let filtered = votes.filter((vote) => {
        return (new BN(vote.balance).gte(minVote) &&
            new BN(vote.balance).lte(maxVote))
    })
    if (settings.directOnly) {
        filtered = votes.filter((vote) => !vote.isDelegating)
    }
    if (settings.first !== "-1") {
        return filtered.slice(0, parseInt(settings.first))
    }
    return filtered
}

const getVotesAndIssuance = async (referendumIndex: BN, settings): Promise<[String, DeriveReferendumVote[]]> => {
    const info = await params.api.query.democracy.referendumInfoOf(referendumIndex);
    let blockNumber: BN;
    try {
        blockNumber = info.unwrap().asFinished.end
    }
    catch (e) {
        logger.error(`Referendum is still ongoing: ${e}`);
        return;
    }
    const cutOffBlock = settings.blockCutOff && settings.blockCutOff !== "-1" ?
        settings.blockCutOff : blockNumber
    logger.info("Cut-off Block: ", cutOffBlock.toString())
    const blockHash = await params.api.rpc.chain.getBlockHash(cutOffBlock);
    const blockApi = await params.api.at(blockHash);
    const totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
    return [totalIssuance, await votesCurr(blockApi, referendumIndex)];
}

const getShelflessAccounts = async (votes: DeriveReferendumVote[], collectionId): Promise<AccountId[]> => {
    let accounts: AccountId[] = [];
    for (const vote of votes) {
        let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(collectionId);
        if (!allNFTs.find(({ owner, rootowner, symbol }) => {
            return owner === vote.accountId.toString() &&
                rootowner === vote.accountId.toString() &&
                symbol === params.settings.shelfNFTSymbol
        })) {
            accounts.push(vote.accountId)
        }
    }
    return accounts;
}

export const sendNFTs = async (passed: boolean, referendumIndex: BN, indexer) => {
    //wait a bit since blocks after will be pretty full
    await sleep(10000);
    let votes: DeriveReferendumVote[];
    let totalIssuance: String;
    let settingsFile = await getSettingsFile(referendumIndex);
    if (settingsFile === "") {
        return;
    }
    let settings = await JSON.parse(settingsFile);
    [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex, settings);
    logger.info("Number of votes: ", votes.length)
    if (params.settings.saveDB) {
        await saveVotesToDB(referendumIndex, votes, totalIssuance, passed, indexer);
    }
    const shelfRoyaltyProperty: IRoyaltyAttribute = {
        type: "royalty",
        value: {
            receiver: encodeAddress(params.account.address, params.settings.network.prefix),
            royaltyPercentFloat: 90
        }
    }
    const filteredVotes = await filterVotes(referendumIndex, votes, totalIssuance.toString(), settings)
    logger.info("Number of votes after filter: ", filteredVotes.length)

    const shelfCollectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.shelfCollectionSymbol
    );

    //check which wallets don't have the shelf nft
    const accountsWithoutShelf: AccountId[] = await getShelflessAccounts(filteredVotes, shelfCollectionId)
    //send shelf to wallets that don't have one yet
    if (accountsWithoutShelf.length > 0) {
        //upload shelf to pinata
        const [shelfMetadataCid, shelfMainCid, shelfThumbCid] = await pinSingleWithThumbMetadataFromDir("/assets",
            "shelf/shelf.png",
            `Your Shelf`,
            {
                description: `With each vote on a referendum, this shelf will get filled up more.`,
                properties: {},
            },
            "shelf/shelf_thumb.png"
        );
        if (!shelfMetadataCid) {
            logger.error(`parentMetadataCid is null: ${shelfMetadataCid}. exiting.`)
            return;
        }
        //get base
        const bases = await params.remarkStorageAdapter.getAllBases();
        const baseId = bases.find(({ issuer, symbol }) => {
            return issuer === encodeAddress(params.account.address, params.settings.network.prefix).toString() &&
                symbol === params.settings.baseSymbol
        }).id
        logger.info("baseId: ", baseId)

        const shelfRemarks: string[] = [];
        let count = 0

        for (const account of accountsWithoutShelf) {
            //remove this
            if (account.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic") {
                const nftProps: INftProps = {
                    block: 0,
                    sn: (count++).toString(),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1,
                    metadata: shelfMetadataCid,
                    collection: shelfCollectionId,
                    symbol: params.settings.shelfNFTSymbol,
                    properties: {
                        royaltyInfo: {
                            ...shelfRoyaltyProperty
                        }
                    }
                };
                const nft = new NFT(nftProps);

                shelfRemarks.push(nft.mint());
            }
        }
        logger.info("shelfRemarks", shelfRemarks)
        const { block, success, hash, fee } = await mintAndSend(shelfRemarks);
        logger.info(`Shelf NFTs minted at block ${block}: ${success} for a total fee of ${fee}`)
        //wait until remark block has caught up with block
        while ((await params.remarkBlockCountAdapter.get()) < block) {
            await sleep(3000);
        }

        // add base resource to shelf nfts
        const addBaseAndSendRemarks: string[] = [];

        count = 0;
        for (const account of accountsWithoutShelf) {
            //remove this
            if (account.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic") {
                const nftProps: INftProps = {
                    block: block,
                    sn: (count).toString(),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 0,
                    metadata: shelfMetadataCid,
                    collection: shelfCollectionId,
                    symbol: params.settings.shelfNFTSymbol,
                };
                const nft = new NFT(nftProps);
                let parts = [];
                parts.push("background");
                parts.push("shelf");
                for (let i = params.settings.startReferendum; i <= params.settings.startReferendum + params.settings.itemCount; i++) {
                    parts.push(`REFERENDUM_${i.toString()}`)
                }
                addBaseAndSendRemarks.push(
                    nft.resadd({
                        base: baseId,
                        id: nanoid(16),
                        parts: parts,
                        thumb: `ipfs://ipfs/${shelfThumbCid}`,
                    })
                );
                //readd this!!!
                addBaseAndSendRemarks.push(nft.send(account.toString()))
            }
        }
        logger.info("addBaseAndSendRemarks: ", addBaseAndSendRemarks)
        // split remarks into sets of 100?
        const { block: baseAddAndSendBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await mintAndSend(addBaseAndSendRemarks);
        logger.info(`NFTs sent at block ${baseAddAndSendBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
        while ((await params.remarkBlockCountAdapter.get()) < baseAddAndSendBlock) {
            await sleep(3000);
        }
    }

    

    // upload file to pinata
    // let imagePath;
    // try {
    //     await fsPromises.readFile(`${process.cwd()}/assets/referenda/${referendumIndex}.${settings.fileType}`);
    //     imagePath = `referenda/${referendumIndex}.${settings.fileType}`;
    //     logger.info(`using referenda/${referendumIndex}.${settings.fileType}`)
    // }
    // catch (e) {
    //     imagePath = "default.png";
    //     logger.info(`using default.png`)
    // }

    const metadataCidDirect = await pinSingleMetadataWithoutFile(
        `Referendum ${referendumIndex}`,
        {
            description: settings.text + `Type of vote: Direct.`,
            properties: {}
        }
    );

    const metadataCidDelegated = await pinSingleMetadataWithoutFile(
        `Referendum ${referendumIndex}`,
        {
            description: settings.text + `Type of vote: Delegated.`,
            properties: {}
        }
    );

    if (!metadataCidDirect || !metadataCidDelegated) {
        logger.error(`one of metadataCids is null: dir: ${metadataCidDirect} del: ${metadataCidDelegated}. exiting.`)
        return;
    }

    const itemCollectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.itemCollectionSymbol
    );
    const mintRemarks: string[] = [];
    let usedMetadataCids: string[] = [];
    let count = 0;




    for (const vote of filteredVotes) {
        //remove this
        if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic") {
            let metadataCid = vote.isDelegating ? metadataCidDelegated : metadataCidDirect

            const randRoyaltyInRange = Math.floor(Math.random() * (settings.royalty[1] - settings.royalty[0] + 1) + settings.royalty[0])
            logger.info("randRoyalty: ", randRoyaltyInRange)
            const itemRoyaltyProperty: IRoyaltyAttribute = {
                type: "royalty",
                value: {
                    receiver: encodeAddress(params.account.address, params.settings.network.prefix),
                    royaltyPercentFloat: randRoyaltyInRange
                }
            }
            if (!metadataCid) {
                logger.error(`metadataCid is null. exiting.`)
                return;
            }
            const nftProps: INftProps = {
                block: 0,
                sn: (count++).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: parseInt(settings.transferable) || 1,
                metadata: metadataCid,
                collection: itemCollectionId,
                symbol: referendumIndex.toString(),
                properties: {
                    royaltyInfo: {
                        ...itemRoyaltyProperty
                    }
                },
            };
            usedMetadataCids.push(metadataCid);
            logger.info("usedMetadataCids: ", usedMetadataCids)
            const nft = new NFT(nftProps);

            mintRemarks.push(nft.mint());
        }
    }
    logger.info("mintRemarks: ", mintRemarks)
    //mint
    const { block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks);
    if (!successMint) {
        logger.info(`Failure minting NFTs at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
        return;
    }
    logger.info(`NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
    while ((await params.remarkBlockCountAdapter.get()) < blockMint) {
        await sleep(3000);
    }
    // add res to nft
    count = 0;
    const addResAndSendRemarks: string[] = [];
    for (const [index, vote] of filteredVotes.entries()) {
        //remove this
        if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic") {
            const nftProps: INftProps = {
                block: blockMint,
                sn: (count++).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: parseInt(settings.transferable) || 1,
                metadata: usedMetadataCids[index],
                collection: itemCollectionId,
                symbol: referendumIndex.toString(),
            };
            const nft = new NFT(nftProps);
            for (let i = 0; i < settings.resources.length; i++) {
                let resource = settings.resources[i]
                let mainCid = await pinSingleFileFromDir("/assets/shelf/referenda",
                    resource.main,
                    resource.name)
                let thumbCid = await pinSingleFileFromDir("/assets/shelf/referenda",
                    resource.thumb,
                    resource.name + "_thumb")
                addResAndSendRemarks.push(
                    nft.resadd({
                        src: `ipfs://ipfs/${mainCid}`,
                        thumb: `ipfs://ipfs/${thumbCid}`,
                        id: nanoid(16),
                        slot: `${resource.slot}`,
                        metadata: usedMetadataCids[index]
                    })
                );
            }
            //get the parent nft
            let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(shelfCollectionId);

            const accountShelfNFTId = allNFTs.find(({ owner, rootowner, symbol }) => {
                return owner === vote.accountId.toString() &&
                    rootowner === vote.accountId.toString() &&
                    symbol === params.settings.shelfNFTSymbol
            }).id
            logger.info("idParent", accountShelfNFTId)
            addResAndSendRemarks.push(nft.send(accountShelfNFTId.toString())) //vote.accountId.toString()
            //addResAndSendRemarks.push(nft.equip("base-11873516-SBP.181"))
        }
    }
    logger.info("addResAndSendRemarks: ", addResAndSendRemarks)
    //split remarks into sets of 100?
    const { block: resAddBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await mintAndSend(addResAndSendRemarks);
    logger.info(`NFTs sent at block ${resAddBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
}