import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleFileFromDir, pinSingleMetadataFromDir, pinSingleWithThumbMetadataFromDir } from "../tools/pinataUtils.js";
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
    //console.log("allVoting", allVoting)
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

const filterVotes = async (referendumId: BN, votes: DeriveReferendumVote[], totalIssuance: string): Promise<DeriveReferendumVote[]> => {
    let settingsFile = await getSettingsFile(referendumId);
    let settings = await JSON.parse(settingsFile);

    const minVote = BN.max(new BN(settings.min), new BN("0"));
    const maxVote = BN.min(new BN(settings.max), new BN(totalIssuance));
    console.log("min", minVote.toString());
    console.log("max", maxVote.toString());
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
    let settingsFile = await getSettingsFile(referendumIndex);
    let settings = await JSON.parse(settingsFile);
    const cutOffBlock = settings.blockCutOff && settings.blockCutOff !== "-1" ?
        settings.blockCutOff : blockNumber
    console.log("Cut-off Block: ", cutOffBlock.toString())
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
            owner === vote.accountId &&
                rootowner === params.account &&
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
    [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex);
    console.log("Number of votes: ", votes.length)
    await saveVotesToDB(referendumIndex, votes, totalIssuance, passed, indexer);
    const royaltyProperty: IRoyaltyAttribute = {
        type: "royalty",
        value: {
            receiver: encodeAddress(params.account.address, params.settings.network.prefix),
            royaltyPercentFloat: 5
        }
    }
    const filteredVotes = await filterVotes(referendumIndex, votes, totalIssuance.toString())
    console.log("Number of votes after filter: ", filteredVotes.length)

    const shelfCollectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.shelfCollectionSymbol
    );

    //check which wallets don't have the shelf nft
    const accountsWithoutShelf: AccountId[] = await getShelflessAccounts(filteredVotes, shelfCollectionId)
    //send trophy shelf to wallets that don't have one yet
    if (accountsWithoutShelf.length > 0) {
        //upload shelf to pinata
        const [shelfMetadataCid, shelfImageCid, shelfThumbCid] = await pinSingleWithThumbMetadataFromDir("/assets",
            "trophy/shelf.png",
            `Your Trophy Shelf`,
            {
                description: `With each vote on a referendum, this shelf will get filled up more.`,
                properties: {
                    royalty: {
                        ...royaltyProperty
                    }
                },
            },
            "trophy/shelf_thumb.png"
        );
        if (!shelfMetadataCid) {
            logger.error(`parentMetadataCid is null: ${shelfMetadataCid}. exiting.`)
            return;
        }
        //get base
        const bases = await params.remarkStorageAdapter.getAllBases();
        console.log("bases", bases)
        const baseId = bases.find(({ issuer, symbol }) => {
            //issuer === params.account &&
            return symbol === params.settings.baseSymbol
        }).id
        console.log("base", baseId)

        const shelfRemarks: string[] = [];
        let count = 0
        for (const account of accountsWithoutShelf) {
            const nftProps: INftProps = {
                block: 0,
                sn: (count++).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: 0,
                metadata: shelfMetadataCid,
                collection: shelfCollectionId,
                symbol: params.settings.shelfNFTSymbol,
            };
            const nft = new NFT(nftProps);

            shelfRemarks.push(nft.mint()); //account.toString()
        }
        console.log("shelfRemarks", shelfRemarks)
        const { block, success, hash, fee } = await mintAndSend(shelfRemarks);
        logger.info(`Shelf NFTs sent at block ${block}: ${success} for a total fee of ${fee}`)
        //wait until remark block has caught up with block
        while (block <= await params.remarkBlockCountAdapter.get()) {
            await sleep(3000);
        }

        // add base resource to shelf nfts
        const addBaseAndSendRemarks: string[] = [];

        count = 0;
        for (const account of accountsWithoutShelf) {
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
            for (let i = params.settings.startReferendum; i <= params.settings.startReferendum + params.settings.trophyCount; i++) {
                parts.push(`${i.toString()}`)
            }
            addBaseAndSendRemarks.push(
                nft.resadd({
                    base: baseId,
                    id: (count++).toString(),
                    parts: parts,
                    thumb: `ipfs://ipfs/${shelfThumbCid}`,
                    src: `ipfs://ipfs/${shelfImageCid}`
                })
            );
            addBaseAndSendRemarks.push(nft.send(account.toString()))
        }
        console.log("addBaseAndSendRemarks: ", addBaseAndSendRemarks)
        //split remarks into sets of 100?
        const { block: resAddBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await mintAndSend(addBaseAndSendRemarks);
        logger.info(`NFTs sent at block ${resAddBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
    }

    // upload file to pinata
    let imagePath;
    let settingsFile = await getSettingsFile(referendumIndex);
    let settings = await JSON.parse(settingsFile);
    try {
        await fsPromises.readFile(`${process.cwd()}/assets/referenda/${referendumIndex}.${settings.fileType}`);
        imagePath = `referenda/${referendumIndex}.${settings.fileType}`;
        logger.info(`using referenda/${referendumIndex}.${settings.fileType}`)
    }
    catch (e) {
        imagePath = "default.png";
        logger.info(`using default.png`)
    }
    const metadataCidDirect = await pinSingleMetadataFromDir("/assets",
        imagePath,
        `Referendum ${referendumIndex}`,
        {
            description: settings.text + `Thank you for casting your vote on Referendum ${referendumIndex}.\n\n` +
                `With your vote you have forever changed ${params.settings.network.name}!\n\n` +
                `Let's keep shaping our future together.\n\nGet notified as soon as a new referendum ` +
                `is up for vote: https://t.me/referendumAlertKusamaBot .`,
        }
    );

    const metadataCidDelegated = await pinSingleMetadataFromDir("/assets",
        imagePath,
        `Referendum ${referendumIndex}`,
        {
            description: settings.text + `Thank you for casting your delegated vote on Referendum ${referendumIndex}.\n\n` +
                `With your vote you have forever changed ${params.settings.network.name}!\n\n` +
                `Let's keep shaping our future together.\n\nGet notified as soon as a new referendum ` +
                `is up for vote: https://t.me/referendumAlertKusamaBot .`,
        }
    );

    if (!metadataCidDirect || !metadataCidDelegated) {
        logger.error(`one of metadataCids is null: dir: ${metadataCidDirect} del: ${metadataCidDelegated}. exiting.`)
        return;
    }

    const collectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.collectionSymbol
    );
    const mintRemarks: string[] = [];
    let usedMetadataCids: string[] = [];
    let count = 0;
    for (const vote of filteredVotes) {
        let metadataCid = vote.isDelegating ? metadataCidDelegated : metadataCidDirect
        const nftProps: INftProps = {
            block: 0,
            sn: (count++).toString(),
            owner: encodeAddress(params.account.address, params.settings.network.prefix),
            transferable: parseInt(settings.transferable) || 1,
            metadata: metadataCid,
            collection: collectionId,
            symbol: params.settings.shelfNFTSymbol,
        };
        usedMetadataCids.push(metadataCid);
        const nft = new NFT(nftProps);

        mintRemarks.push(nft.mint());
    }
    logger.info("mintRemarks: ", mintRemarks)
    //mint
    const { block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks);
    if (!successMint) {
        logger.info(`Failure minting NFTs at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
        return;
    }
    logger.info(`NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
    while (blockMint <= await params.remarkBlockCountAdapter.get()) {
        await sleep(3000);
    }
    // add res to nft
    count = 0;
    const addResAndSendRemarks: string[] = [];
    for (const [index, vote] of filteredVotes.entries()) {
        const nftProps: INftProps = {
            block: blockMint,
            sn: (count++).toString(),
            owner: encodeAddress(params.account.address, params.settings.network.prefix),
            transferable: parseInt(settings.transferable) || 1,
            metadata: usedMetadataCids[index],
            collection: collectionId,
            symbol: referendumIndex.toString(),
        };
        const nft = new NFT(nftProps);
        for (let i = 0; i < settings.resources.length; i++) {
            let resource = settings.resources[i]
            let imageCid = pinSingleFileFromDir("/assets",
                resource.main,
                resource.name)
            let thumbCid = pinSingleFileFromDir("/assets",
                resource.thumb,
                resource.name + "_thumb")
            addResAndSendRemarks.push(
                nft.resadd({
                    src: `ipfs://ipfs/${imageCid}`,
                    thumb: `ipfs://ipfs/${thumbCid}`,
                    id: nanoid(8),
                    slot: `${resource.slot}`,
                })
            );
        }
        addResAndSendRemarks.push(nft.send(vote.accountId.toString()))
    }
    console.log("addResAndSendRemarks: ", addResAndSendRemarks)
    //split remarks into sets of 100?
    const { block: resAddBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await mintAndSend(addResAndSendRemarks);
    logger.info(`NFTs sent at block ${resAddBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
}