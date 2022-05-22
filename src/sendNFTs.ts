import seedrandom from "seedrandom";
import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleFileFromDir, pinSingleMetadataFromDir, pinSingleMetadataWithoutFile, pinSingleWithThumbMetadataFromDir } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Base, Collection, NFT } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { INftProps, VoteConviction } from "../types.js";
import { getApi, getDecimal, mintAndSend } from "../tools/substrateUtils.js";
import { amountToHumanString, getSettingsFile, sleep } from "../tools/utils.js";
import { AccountId, VotingDelegating, VotingDirectVote } from "@polkadot/types/interfaces";
import { PalletDemocracyVoteVoting } from "@polkadot/types/lookup";
import { ApiDecoration } from "@polkadot/api/types";
import { saveVotesToDB } from "./saveVotesToDB.js";
import { encodeAddress } from "@polkadot/util-crypto";
import { nanoid } from "nanoid";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";
import { exit } from "process";
import BigNumber from "bignumber.js";
import { createNewCollection } from "./createNewCollection.js";
import { BaseConsolidated } from "rmrk-tools/dist/tools/consolidator/consolidator";

const fsPromises = fs.promises;

const extractVotes = (mapped: [AccountId, PalletDemocracyVoteVoting][], referendumId: BN) => {
    return mapped
        .filter(([, voting]) => voting.isDirect)
        .map(([accountId, voting]): [AccountId, VotingDirectVote[]] => [
            accountId,
            voting.asDirect.votes.filter(([idx]) => idx.eq(referendumId))
        ])
        .filter(([, directVotes]) => !!directVotes.length)
        .reduce((result: VoteConviction[], [accountId, votes]) =>
            // FIXME We are ignoring split votes
            votes.reduce((result: VoteConviction[], [, vote]): VoteConviction[] => {
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
    let votes: VoteConviction[] = extractVotes(mapped, referendumId);
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
    const LOCKS = [1, 10, 20, 30, 40, 50, 60];
    votes = votes.map((vote) => {
        const convictionBalance = vote.balance.muln(LOCKS[vote.vote.conviction.toNumber()]).div(new BN(10)).toString();
        return { ...vote, convictionBalance }
    })
    return votes;
}

const filterVotes = async (referendumId: BN, votes: VoteConviction[], totalIssuance: string, settings): Promise<VoteConviction[]> => {
    const minVote = BN.max(new BN(settings.min), new BN("0"));
    const maxVote = BN.min(new BN(settings.max), new BN(totalIssuance));
    logger.info("min:", minVote.toString());
    logger.info("minHuman:", await amountToHumanString(minVote.toString()))
    logger.info("max:", maxVote.toString());
    logger.info("maxHuman:", await amountToHumanString(maxVote.toString()))
    let filtered = votes.filter((vote) => {
        return (new BN(vote.convictionBalance).gte(minVote) &&
            new BN(vote.convictionBalance).lte(maxVote))
    })
    if (settings.directOnly) {
        filtered = votes.filter((vote) => !vote.isDelegating)
    }
    if (settings.first !== "-1") {
        return filtered.slice(0, parseInt(settings.first))
    }
    return filtered
}

const getVotesAndIssuance = async (referendumIndex: BN, atExpiry: boolean, settings?): Promise<[String, VoteConviction[]]> => {
    const api = await getApi();
    const info = await api.query.democracy.referendumInfoOf(referendumIndex);
    let blockNumber: BN;
    try {
        blockNumber = info.unwrap().asFinished.end
    }
    catch (e) {
        logger.error(`Referendum is still ongoing: ${e}`);
        return;
    }
    let cutOffBlock;
    if (!atExpiry) {
        cutOffBlock = settings.blockCutOff && settings.blockCutOff !== "-1" ?
            settings.blockCutOff : blockNumber
        logger.info("Cut-off Block: ", cutOffBlock.toString())
    }
    else {
        cutOffBlock = blockNumber
    }
    const blockHash = await api.rpc.chain.getBlockHash(cutOffBlock);
    const blockApi = await api.at(blockHash);
    const totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
    return [totalIssuance, await votesCurr(blockApi, referendumIndex)];
}

const getShelflessAccounts = async (votes: VoteConviction[], collectionId): Promise<AccountId[]> => {
    let accounts: AccountId[] = [];
    for (const vote of votes) {
        let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(collectionId);
        if (!allNFTs.find(({ owner, rootowner, symbol, burned }) => {
            return rootowner === vote.accountId.toString() &&
                symbol === params.settings.shelfNFTSymbol &&
                burned === ""
        })) {
            accounts.push(vote.accountId)
        }
    }
    return accounts;
}

const getRandom = (weights) => {
    var num = Math.random(),
        s = 0,
        lastIndex = weights.length - 1;

    for (var i = 0; i < lastIndex; ++i) {
        s += weights[i];
        if (num < s) {
            return i;
        }
    }

    return lastIndex;
};



const calculateLuck = async (n, minIn, maxIn, minOut, maxOut, exponent) => {
    // unscale input
    n = await getDecimal(n);
    // console.log("n", n)
    // minIn = new BigNumber(minIn).dividedBy(new BigNumber("1e" + api.registry.chainDecimals));
    // maxIn = new BigNumber(maxIn).dividedBy(new BigNumber("1e" + api.registry.chainDecimals));
    minOut = parseInt(minOut);
    maxOut = parseInt(maxOut);
    // console.log("bnb", nBN.toString());
    // console.log("mininbn", minInBN.toString())
    // console.log("maxInBN", maxInBN.toString())
    // console.log("minOutBN", minOutBN.toString())
    // console.log("maxOutBN", maxOutBN.toString())
    n -= minIn
    // nBN = nBN.minus(minInBN)
    // console.log("bnb1", nBN);
    n /= maxIn - minIn
    // nBN = nBN.div(maxInBN.minus(minInBN))
    // console.log("bnb2", nBN);

    n = Math.pow(n, exponent)
    // nBN = nBN.
    // console.log("bnb3", nBN);

    // scale output
    n *= maxOut - minOut
    // nBN = nBN.multipliedBy(maxOutBN.minus(minOutBN))
    // console.log("bnb4", nBN);
    n += minOut
    // nBN = nBN.plus(minOutBN)
    // console.log("bnb5", nBN.toString());
    return n
}

const getMinMaxMedian = (someArray, criticalValue) => {
    if (someArray.length < 4)
        return someArray;
    someArray = someArray.filter(vote => {
        return vote > criticalValue
    })

    let values, q1, q3, iqr, maxValue, minValue, median;

    values = someArray.slice().sort((a, b) => a - b);//copy array fast and sort
    if ((values.length / 4) % 1 === 0) {//find quartiles
        q1 = 1 / 2 * (values[(values.length / 4)] + values[(values.length / 4) + 1]);
        q3 = 1 / 2 * (values[(values.length * (3 / 4))] + values[(values.length * (3 / 4)) + 1]);
    } else {
        q1 = values[Math.floor(values.length / 4 + 1)];
        q3 = values[Math.ceil(values.length * (3 / 4) + 1)];
    }

    if ((values.length / 2) % 1 === 0) {//find quartiles
        median = 1 / 2 * (values[(values.length / 2)] + values[(values.length / 2) + 1]);
    } else {
        median = values[Math.floor(values.length / 2 + 1)];
    }


    console.log("q1", q1)
    console.log("q3", q3)
    console.log("medium", median)
    iqr = q3 - q1;
    maxValue = q3 + iqr * 1.5;
    minValue = q1 - iqr * 1.5;
    console.log("maxi", maxValue)
    return { minValue, maxValue, median };
}

export const sendNFTs = async (passed: boolean, referendumIndex: BN, indexer = null) => {
    seedrandom(referendumIndex.toString(), { global: true });
    //wait a bit since blocks after will be pretty full
    await sleep(10000);
    const api = await getApi();
    //wait until remark block has caught up with block
    let currentFinalized = (await api.rpc.chain.getBlock(await api.rpc.chain.getFinalizedHead())).block.header.number.toNumber()
    while ((await params.remarkBlockCountAdapter.get()) < currentFinalized) {
        logger.info(`waiting for remark (Block: ${await params.remarkBlockCountAdapter.get()}) to get to current block: ${currentFinalized}`);
        await sleep(3000);
        currentFinalized = (await api.rpc.chain.getBlock(await api.rpc.chain.getFinalizedHead())).block.header.number.toNumber()
    }
    let votes: VoteConviction[] = [];
    let totalIssuance: String;
    let totalVotes: VoteConviction[];
    let totalIssuanceRefExpiry: String;
    const chunkSize = params.settings.chunkSize;
    const chunkSizeDefault = params.settings.chunkSizeDefault;
    const chunkSizeShelf = params.settings.chunkSizeShelf;

    let settingsFile = await getSettingsFile(referendumIndex);
    if (settingsFile === "") {
        return;
    }
    let settings = await JSON.parse(settingsFile);
    [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex, false, settings);
    [totalIssuanceRefExpiry, totalVotes] = await getVotesAndIssuance(referendumIndex, true)
    // fs.writeFile(`assets/shelf/votes/${referendumIndex}.txt`, JSON.stringify(totalVotes), (err) => {

    //     // In case of a error throw err.
    //     if (err) throw err;
    // })
    // // for testing only
    // let data = await fs.readFileSync(`assets/shelf/votes/${referendumIndex}.txt`).toString('utf-8')
    // let data2 = JSON.parse(data)
    // for (const vote of data2) {
    //     let new1 = vote as unknown;
    //     let new2 = new1 as VoteConviction;
    //     votes.push(new2)
    // }
    // console.log(votes)

    logger.info("Number of votes: ", totalVotes.length)
    if (params.settings.saveDB) {
        await saveVotesToDB(referendumIndex, totalVotes, totalIssuanceRefExpiry, passed, indexer);
    }
    const shelfRoyaltyProperty: IRoyaltyAttribute = {
        type: "royalty",
        value: {
            receiver: encodeAddress(params.account.address, params.settings.network.prefix),
            royaltyPercentFloat: 90
        }
    }
    // // for testing only
    // totalIssuance = "12312312312342312314"
    const filteredVotes = await filterVotes(referendumIndex, votes, totalIssuance.toString(), settings)
    logger.info("Number of votes after filter: ", filteredVotes.length)

    const shelfCollectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.shelfCollectionSymbol
    );

    let itemCollectionId;
    //create collection if required

    if (settings.createNewCollection) {
        itemCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            settings.newCollectionSymbol
        );
        let collection = await params.remarkStorageAdapter.getCollectionById(itemCollectionId);
        if (!collection) {
            await createNewCollection(itemCollectionId, settings);
        }
        else {
            logger.info("New collection already exists.")
        }
    }
    else {
        itemCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.itemCollectionSymbol
        );
    }
    logger.info("collectionID Item: ", itemCollectionId)

    await sleep(10000);

    // //remove this
    // totalVotes = votes;

    //check which wallets don't have the shelf nft
    const accountsWithoutShelf: AccountId[] = await getShelflessAccounts(totalVotes, shelfCollectionId)
    //send shelf to wallets that don't have one yet
    if (accountsWithoutShelf.length > 0) {
        //upload shelf to pinata
        const [shelfMetadataCid, shelfMainCid, shelfThumbCid] = await pinSingleWithThumbMetadataFromDir("/assets",
            "shelf/shelf.png",
            `Your Shelf`,
            {
                description: `Each time you vote on a referendum, a new item will be added to this shelf.`,
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

        let chunkCount = 0
        logger.info("accountsWithoutShelf", accountsWithoutShelf.length)
        for (let i = 0; i < accountsWithoutShelf.length; i += chunkSizeShelf) {
            const shelfRemarks: string[] = [];
            const chunk = accountsWithoutShelf.slice(i, i + chunkSizeShelf);
            logger.info(`Chunk ${chunkCount}: ${chunk.length}`)
            let count = 0
            for (const account of chunk) {

                const nftProps: INftProps = {
                    block: 0,
                    sn: ((chunkCount * chunkSizeShelf) + count++).toString(),
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
                // //remove this
                // if (account.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                //     || account.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                //     || account.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                //     || account.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                    shelfRemarks.push(nft.mint());
                // }
            }
            logger.info("shelfRemarks", JSON.stringify(shelfRemarks))
            if (shelfRemarks.length > 0) {
                const { block, success, hash, fee } = await mintAndSend(shelfRemarks);
                logger.info(`Shelf NFTs minted at block ${block}: ${success} for a total fee of ${fee}`)
                //wait until remark block has caught up with block
                while ((await params.remarkBlockCountAdapter.get()) < block) {
                    await sleep(3000);
                }
                await sleep(60000);
                // add base resource to shelf nfts
                const addBaseRemarks: string[] = [];

                count = 0;
                for (const account of chunk) {

                    const nftProps: INftProps = {
                        block: block,
                        sn: ((chunkCount * chunkSizeShelf) + count++).toString(),
                        owner: encodeAddress(params.account.address, params.settings.network.prefix),
                        transferable: 1,
                        metadata: shelfMetadataCid,
                        collection: shelfCollectionId,
                        symbol: params.settings.shelfNFTSymbol,
                    };
                    const nft = new NFT(nftProps);
                    let parts = [];
                    parts.push("background");
                    parts.push("shelf");
                    parts.push("decoration");
                    for (let i = params.settings.startReferendum; i <= params.settings.startReferendum + params.settings.itemCount; i++) {
                        parts.push(`REFERENDUM_${i.toString()}`)
                    }
                    parts.push("foreground");
                    // //remove this
                    // if (account.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                    //     || account.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                    //     || account.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                    //     || account.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                        addBaseRemarks.push(
                            nft.resadd({
                                base: baseId,
                                id: nanoid(16),
                                parts: parts,
                                thumb: `ipfs://ipfs/${shelfThumbCid}`,
                            })
                        );
                    // }
                }
                logger.info("addBaseRemarks: ", JSON.stringify(addBaseRemarks))
                // split remarks into sets of 400?
                const { block: addBaseBlock, success: addBaseSuccess, hash: addBaseHash, fee: addBaseFee } = await mintAndSend(addBaseRemarks);
                logger.info(`Base added at block ${addBaseBlock}: ${addBaseSuccess} for a total fee of ${addBaseFee}`)
                while ((await params.remarkBlockCountAdapter.get()) < addBaseBlock) {
                    await sleep(3000);
                }
                await sleep(60000);

                // send out shelf nfts
                const sendRemarks: string[] = [];

                count = 0;
                for (const account of chunk) {

                    const nftProps: INftProps = {
                        block: block,
                        sn: ((chunkCount * chunkSizeShelf) + count++).toString(),
                        owner: encodeAddress(params.account.address, params.settings.network.prefix),
                        transferable: 1,
                        metadata: shelfMetadataCid,
                        collection: shelfCollectionId,
                        symbol: params.settings.shelfNFTSymbol,
                    };
                    const nft = new NFT(nftProps);
                    // //remove this
                    // if (account.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                    //     || account.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                    //     || account.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                    //     || account.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {

                        sendRemarks.push(nft.send(account.toString()))
                    // }
                }

                logger.info("sendRemarks: ", JSON.stringify(sendRemarks))
                const { block: sendBlock, success: sendSuccess, hash: sendHash, fee: sendFee } = await mintAndSend(sendRemarks);
                logger.info(`NFTs sent at block ${sendBlock}: ${sendSuccess} for a total fee of ${sendFee}`)

                while ((await params.remarkBlockCountAdapter.get()) < sendBlock) {
                    await sleep(3000);
                }
                await sleep(60000);
            }
            chunkCount++;
        }

    }
    await sleep(3000);
    let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(shelfCollectionId);

    const withoutSend = allNFTs.filter(({ changes, symbol, burned }) => {
        return changes.length === 0 &&
            symbol === params.settings.shelfNFTSymbol &&
            burned === ""
    })

    if (withoutSend && withoutSend.length > 0) {
        logger.error(`${withoutSend.length} send transactions not registered: ${JSON.stringify(withoutSend)}. Exiting...`)
        return;
    }




    //send "non-rare" NFT to voters not meeting requirements

    const metadataCidDirectDefault = await pinSingleMetadataWithoutFile(
        `Referendum ${referendumIndex}`,
        {
            description: settings.default.text + `Type of vote: Direct.`,
            properties: {}
        }
    );

    const metadataCidDelegatedDefault = await pinSingleMetadataWithoutFile(
        `Referendum ${referendumIndex}`,
        {
            description: settings.default.text + `Type of vote: Delegated.`,
            properties: {}
        }
    );

    if (!metadataCidDirectDefault || !metadataCidDelegatedDefault) {
        logger.error(`one of metadataCids is null: dir: ${metadataCidDirectDefault} del: ${metadataCidDelegatedDefault}. exiting.`)
        return;
    }

    // const itemCollectionId = Collection.generateId(
    //     u8aToHex(params.account.publicKey),
    //     params.settings.itemCollectionSymbol
    // );

    let chunkCount = 0

    let resourceCidsDefault = []

    for (let i = 0; i < settings.default.resources.length; i++) {
        const resource = settings.default.resources[i]
        let mainCid = await pinSingleFileFromDir("/assets/shelf/referenda",
            resource.main,
            resource.name)
        let thumbCid = await pinSingleFileFromDir("/assets/shelf/referenda",
            resource.thumb,
            resource.name + "_thumb")
        resourceCidsDefault.push([mainCid, thumbCid])
    }

    logger.info("resourceCidsDefault", resourceCidsDefault);

    // let resourceMetadataCidsDefault = []

    // for (let i = 0; i < settings.default.resources.length; i++) {
    //     const resource = settings.default.resources[i]
    //     const metadataResource = await pinSingleMetadataWithoutFile(
    //         `Resource ${i + 1}: ${resource.title}`,
    //         {
    //             description: resource.text,
    //             properties: {}
    //         }
    //     );
    //     resourceMetadataCidsDefault.push(metadataResource)
    // }



    // logger.info("resourceMetadataCidsDefault", resourceMetadataCidsDefault);

    //get votes not in filtered
    const votesNotMeetingRequirements = totalVotes.filter(vote => {
        return !filteredVotes.some(o => {
            return o.accountId.toString() === vote.accountId.toString()
                && o.vote.toString() === vote.vote.toString()
                && o.isDelegating === vote.isDelegating
        });
    })
    logger.info(`${votesNotMeetingRequirements.length} votes not meeting the requirements.`)

    for (let i = 0; i < votesNotMeetingRequirements.length; i += chunkSizeDefault) {
        const chunk = votesNotMeetingRequirements.slice(i, i + chunkSizeDefault);
        logger.info(`Chunk ${chunkCount}: ${chunk.length}`)
        const mintRemarks: string[] = [];
        let usedMetadataCidsDefault: string[] = [];
        // let selectedOptions = [];
        let count = 0;
        for (const vote of chunk) {
            // const selectedIndex = getRandom(weights);
            // const selectedOption = settings.options[selectedIndex];
            // selectedOptions.push(selectedOption);
            // const selectedMetadata = metadataCids[selectedIndex];

            let metadataCid = vote.isDelegating ? metadataCidDelegatedDefault : metadataCidDirectDefault

            const randRoyaltyInRange = Math.floor(Math.random() * (settings.default.royalty[1] - settings.default.royalty[0] + 1) + settings.default.royalty[0])
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
                sn: ((chunkCount * chunkSizeDefault) + count++).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: 1, //parseInt(selectedOption.transferable)
                metadata: metadataCid,
                collection: itemCollectionId,
                symbol: referendumIndex.toString() + settings.default.symbol,
                properties: {
                    royaltyInfo: {
                        ...itemRoyaltyProperty
                    }
                },
            };
            usedMetadataCidsDefault.push(metadataCid);
            const nft = new NFT(nftProps);
            // //remove this
            // if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
            //     || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
            //     || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
            //     || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                mintRemarks.push(nft.mint());
            // }
        }
        // logger.info("selectedOptions: ", JSON.stringify(selectedOptions))
        // logger.info("usedMetadataCidsDefault: ", JSON.stringify(usedMetadataCidsDefault))
        // put this for testing
        logger.info("mintRemarksDefault: ", JSON.stringify(mintRemarks))
        //mint
        if (mintRemarks.length > 0) {
            let blockMint, successMint, hashMint, feeMint;
            // if (chunkCount > 3) {
            ({ block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks));
            // const { block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks);
            if (!successMint) {
                logger.info(`Failure minting default NFTs at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
                return;
            }
            logger.info(`Default NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
            while ((await params.remarkBlockCountAdapter.get()) < blockMint) {
                await sleep(3000);
            }
            // add res to nft
            count = 0;
            const addResRemarks: string[] = [];
            for (const [index, vote] of chunk.entries()) {
                // const selectedOption = selectedOptions[index]
                const nftProps: INftProps = {
                    block: blockMint,
                    sn: ((chunkCount * chunkSizeDefault) + count++).toString(),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1, //parseInt(selectedOption.transferable)
                    metadata: usedMetadataCidsDefault[index],
                    collection: itemCollectionId,
                    symbol: referendumIndex.toString() + settings.default.symbol,
                };
                const nft = new NFT(nftProps);
                for (let i = 0; i < settings.default.resources.length; i++) {
                    let resource = settings.default.resources[i]
                    let mainCid = resourceCidsDefault[i][0]
                    let thumbCid = resourceCidsDefault[i][1]
                    // //remove this
                    // if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                    //     || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                    //     || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                    //     || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                        addResRemarks.push(
                            (resource.slot) ?
                                nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    slot: `${resource.slot}`,
                                    metadata: usedMetadataCidsDefault[index] //resourceMetadataCidsDefault[index][i]
                                }) : nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    metadata: usedMetadataCidsDefault[index] //resourceMetadataCidsDefault[index][i]
                                })
                        );
                    // }
                    // //get the parent nft
                    // let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(shelfCollectionId);

                    // const accountShelfNFTId = allNFTs.find(({ owner, rootowner, symbol, burned }) => {
                    //     return rootowner === vote.accountId.toString() &&
                    //         symbol === params.settings.shelfNFTSymbol &&
                    //         burned === ""
                    // }).id
                    // logger.info("idParent", accountShelfNFTId)
                    // addResAndSendRemarks.push(nft.send(accountShelfNFTId.toString())) //vote.accountId.toString() //accountShelfNFTId.toString()
                    //addResAndSendRemarks.push(nft.equip("base-11873516-SBP.181"))
                }
            }
            // put this for testing
            logger.info("addResRemarks: ", JSON.stringify(addResRemarks))
            const { block: resAddBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await mintAndSend(addResRemarks);
            logger.info(`Resource(s) added to default NFTs at block ${resAddBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
            while ((await params.remarkBlockCountAdapter.get()) < resAddBlock) {
                await sleep(3000);
            }
            if (chunkCount == 0) {
                await sleep(300000);
            }
            // }

            // if (chunkCount > 2) {
            count = 0;
            const sendRemarks: string[] = [];
            for (const [index, vote] of chunk.entries()) {

                // const selectedOption = selectedOptions[index]
                // block: chunkCount == 3 ? 12007826 : blockMint,
                const nftProps: INftProps = {
                    block: blockMint,
                    sn: ((chunkCount * chunkSizeDefault) + count++).toString(),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1, //parseInt(selectedOption.transferable)
                    metadata: usedMetadataCidsDefault[index],
                    collection: itemCollectionId,
                    symbol: referendumIndex.toString() + settings.default.symbol,
                };
                const nft = new NFT(nftProps);
                //get the parent nft
                let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(shelfCollectionId);

                const accountShelfNFTId = allNFTs.find(({ owner, rootowner, symbol, burned }) => {
                    return rootowner === vote.accountId.toString() &&
                        symbol === params.settings.shelfNFTSymbol &&
                        burned === ""
                })

                if (!accountShelfNFTId) {
                    logger.info(`couldn't find parent for rootowner: ${vote.accountId.toString()}`)
                }
                // add emergency send shelf command here in case shelf was sent away in process?
                // logger.info("idParent", accountShelfNFTId.id)
                // //remove this
                // if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                //     || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                //     || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                //     || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                    sendRemarks.push(nft.send(vote.accountId.toString())) //vote.accountId.toString() //accountShelfNFTId.id.toString()
                    //addResAndSendRemarks.push(nft.equip("base-11873516-SBP.181"))
                // }
            }
            // put this for testing
            logger.info("sendRemarks: ", JSON.stringify(sendRemarks))
            //split remarks into sets of 100?
            const { block: sendBlock, success: sendSuccess, hash: sendHash, fee: sendFee } = await mintAndSend(sendRemarks);
            logger.info(`Default NFTs sent at block ${sendBlock}: ${sendSuccess} for a total fee of ${sendFee}`)
            while ((await params.remarkBlockCountAdapter.get()) < sendBlock) {
                await sleep(3000);
            }
            // }
        }
        chunkCount++;
    }




    const metadataCids = []
    // const weights = []
    for (const option of settings.options) {
        const metadataCidDirect = await pinSingleMetadataWithoutFile(
            `Referendum ${referendumIndex}`,
            {
                description: option.text + `Type of vote: Direct.`,
                properties: {}
            }
        );

        const metadataCidDelegated = await pinSingleMetadataWithoutFile(
            `Referendum ${referendumIndex}`,
            {
                description: option.text + `Type of vote: Delegated.`,
                properties: {}
            }
        );

        if (!metadataCidDirect || !metadataCidDelegated) {
            logger.error(`one of metadataCids is null: dir: ${metadataCidDirect} del: ${metadataCidDelegated}. exiting.`)
            return;
        }

        metadataCids.push([metadataCidDirect, metadataCidDelegated])
        // weights.push(option.probability)
    }
    logger.info("metadataCids", metadataCids);
    // logger.info("weights: ", weights);
    //make sure weights total = 1
    // let weight_total = 0
    // for (const weight of weights) {
    //     weight_total += weight
    // }

    // if (weight_total !== 1) {
    //     logger.error(`weights don't add up to 1: ${weights}`);
    //     return;
    // }

    // const itemCollectionId = Collection.generateId(
    //     u8aToHex(params.account.publicKey),
    //     params.settings.itemCollectionSymbol
    // );

    chunkCount = 0

    let resourceCids = []
    for (const option of settings.options) {
        let optionResourceCids = []
        for (let i = 0; i < option.resources.length; i++) {
            const resource = option.resources[i]
            let mainCid = await pinSingleFileFromDir("/assets/shelf/referenda",
                resource.main,
                resource.name)
            let thumbCid = await pinSingleFileFromDir("/assets/shelf/referenda",
                resource.thumb,
                resource.name + "_thumb")
            optionResourceCids.push([mainCid, thumbCid])
        }
        resourceCids.push(optionResourceCids)
    }

    logger.info("resourceCids", resourceCids);

    // let resourceMetadataCids = []
    // for (const option of settings.options) {
    //     let optionResourceMetadataCids = []
    //     for (let i = 0; i < option.resources.length; i++) {
    //         const resource = option.resources[i]
    //         const metadataResource = await pinSingleMetadataWithoutFile(
    //             `Resource ${i + 1}: ${resource.title}`,
    //             {
    //                 description: resource.text,
    //                 properties: {}
    //             }
    //         );
    //         optionResourceMetadataCids.push(metadataResource)
    //     }
    //     resourceMetadataCids.push(optionResourceMetadataCids)
    // }

    // logger.info("resourceMetadataCids", resourceMetadataCids);

    const minVote = filteredVotes.reduce((prev, curr) => new BN(prev.convictionBalance).lt(new BN(curr.convictionBalance)) ? prev : curr);
    const maxVote = filteredVotes.reduce((prev, curr) => new BN(prev.convictionBalance).gt(new BN(curr.convictionBalance)) ? prev : curr);
    logger.info("minVote", minVote.convictionBalance.toString())
    logger.info("maxVote", maxVote.convictionBalance.toString())
    // const minOut = settings.minOut;
    // const maxOut = settings.maxOut;
    // logger.info("minOut", minOut)
    // logger.info("maxOut", maxOut)
    const promises = filteredVotes.map(async (vote) => {
        return await getDecimal(vote.convictionBalance.toString())
    })
    const voteAmounts = await Promise.all(promises);
    let { minValue, maxValue, median } = getMinMaxMedian(voteAmounts, settings.minAmount)
    console.log("min", minValue);
    console.log("median", median);
    console.log("max", maxValue);
    await sleep(10000);
    minValue = minValue < await getDecimal(minVote.convictionBalance.toString()) ? await getDecimal(minVote.convictionBalance.toString()) : minValue
    //remove this
    let luckArray = [];

    for (let i = 0; i < filteredVotes.length; i += chunkSize) {
        const chunk = filteredVotes.slice(i, i + chunkSize);
        logger.info(`Chunk ${chunkCount}: ${chunk.length}`)
        const mintRemarks: string[] = [];
        let usedMetadataCids: string[] = [];
        // let usedResourceMetadataCids: string[] = [];
        let selectedOptions = [];
        let count = 0;

        for (const vote of chunk) {
            // console.log(vote.balance.toString(), vote.vote.conviction.toNumber(), vote.convictionBalance.toString())
            let luck;
            let selectedIndex;
            let counter = 0;
            for (const option of settings.options) {
                if (counter < settings.options.length - 1) {
                    if (await getDecimal(vote.convictionBalance.toString()) < median) {
                        if (await getDecimal(vote.convictionBalance.toString()) < settings.minAmount) {
                            luck = option.minProbability;
                        }
                        else {
                            luck = await calculateLuck(vote.convictionBalance.toString(), minValue, median, option.minProbability, option.sweetspotProbability, 3)
                        }
                    }
                    else {
                        if (await getDecimal(vote.convictionBalance.toString()) > maxValue) {
                            luck = option.maxProbability;
                        }
                        else {
                            luck = await calculateLuck(vote.convictionBalance.toString(), median, maxValue, option.sweetspotProbability, option.maxProbability, 0.4)
                        }
                    }
                    selectedIndex = getRandom([luck / 100, (100 - luck) / 100]);
                    if (selectedIndex === 0) {
                        selectedIndex = counter;
                        break;
                    }
                }
                selectedIndex = counter;
                counter++;
            }

            // console.log("luck", luck)

            luckArray.push([vote.convictionBalance.toString(), luck, selectedIndex])
            // console.log("selectedIndex", selectedIndex)
            const selectedOption = settings.options[selectedIndex];
            selectedOptions.push(selectedOption);
            const selectedMetadata = metadataCids[selectedIndex];

            let metadataCid = vote.isDelegating ? selectedMetadata[1] : selectedMetadata[0]

            const randRoyaltyInRange = Math.floor(Math.random() * (selectedOption.royalty[1] - selectedOption.royalty[0] + 1) + selectedOption.royalty[0])
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
                sn: ((chunkCount * chunkSize) + count++).toString(),
                owner: encodeAddress(params.account.address, params.settings.network.prefix),
                transferable: 1, //parseInt(selectedOption.transferable)
                metadata: metadataCid,
                collection: itemCollectionId,
                symbol: referendumIndex.toString() + selectedOption.symbol,
                properties: {
                    royaltyInfo: {
                        ...itemRoyaltyProperty
                    }
                },
            };
            usedMetadataCids.push(metadataCid);
            // usedResourceMetadataCids.push(resourceMetadataCids[selectedIndex])
            const nft = new NFT(nftProps);
            // //remove this
            // if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
            //     || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
            //     || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
            //     || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                mintRemarks.push(nft.mint());
            // }
        }
        // logger.info("selectedOptions: ", JSON.stringify(selectedOptions))
        // logger.info("usedMetadataCids: ", JSON.stringify(usedMetadataCids))
        // // put this for testing
        logger.info("mintRemarks: ", JSON.stringify(mintRemarks))
        //mint
        if (mintRemarks.length > 0) {
            let blockMint, successMint, hashMint, feeMint;
            // if (chunkCount > 7) {
            ({ block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks));
            // const { block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await mintAndSend(mintRemarks);
            if (!successMint) {
                logger.info(`Failure minting NFTs at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
                return;
            }
            logger.info(`NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
            while ((await params.remarkBlockCountAdapter.get()) < blockMint) {
                await sleep(3000);
            }
            // }
            // if (chunkCount > 7) {
            // add res to nft
            count = 0;
            const addResRemarks: string[] = [];
            for (const [index, vote] of chunk.entries()) {

                // block: chunkCount == 7 ? 12421221 : blockMint,
                const selectedOption = selectedOptions[index]
                const nftProps: INftProps = {
                    block: blockMint,
                    sn: ((chunkCount * chunkSize) + count++).toString(),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1, //parseInt(selectedOption.transferable)
                    metadata: usedMetadataCids[index],
                    collection: itemCollectionId,
                    symbol: referendumIndex.toString() + selectedOption.symbol,
                };
                const nft = new NFT(nftProps);
                for (let i = 0; i < selectedOption.resources.length; i++) {
                    let resource = selectedOption.resources[i]
                    let mainCid = resourceCids[settings.options.indexOf(selectedOption)][i][0]
                    let thumbCid = resourceCids[settings.options.indexOf(selectedOption)][i][1]
                    // //remove this
                    // if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                    //     || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                    //     || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                    //     || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                        addResRemarks.push(
                            (resource.slot) ?
                                nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    slot: `${resource.slot}`,
                                    metadata: usedMetadataCids[index] // usedResourceMetadataCids[index][i]
                                }) : nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    metadata: usedMetadataCids[index] //usedResourceMetadataCids[index][i]
                                })
                        );
                    // }
                    // //get the parent nft
                    // let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(shelfCollectionId);

                    // const accountShelfNFTId = allNFTs.find(({ owner, rootowner, symbol, burned }) => {
                    //     return rootowner === vote.accountId.toString() &&
                    //         symbol === params.settings.shelfNFTSymbol &&
                    //         burned === ""
                    // }).id
                    // logger.info("idParent", accountShelfNFTId)
                    // addResAndSendRemarks.push(nft.send(accountShelfNFTId.toString())) //vote.accountId.toString() //accountShelfNFTId.toString()
                    //addResAndSendRemarks.push(nft.equip("base-11873516-SBP.181"))
                }
            }
            // // put this for testing
            logger.info("addResRemarks: ", JSON.stringify(addResRemarks))
            const { block: resAddBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await mintAndSend(addResRemarks);
            logger.info(`Resource(s) added to NFTs at block ${resAddBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
            while ((await params.remarkBlockCountAdapter.get()) < resAddBlock) {
                await sleep(3000);
            }
            if (chunkCount == 0) {
                await sleep(300000);
            }
            // }

            // if (chunkCount > 6) {
            count = 0;
            const sendRemarks: string[] = [];
            for (const [index, vote] of chunk.entries()) {

                const selectedOption = selectedOptions[index]
                // block: chunkCount == 7 ? 12421221 : blockMint,
                //block: blockMint,
                const nftProps: INftProps = {
                    block: blockMint,
                    sn: ((chunkCount * chunkSize) + count++).toString(),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1, //parseInt(selectedOption.transferable)
                    metadata: usedMetadataCids[index],
                    collection: itemCollectionId,
                    symbol: referendumIndex.toString() + selectedOption.symbol,
                };
                const nft = new NFT(nftProps);
                //get the parent nft
                let allNFTs = await params.remarkStorageAdapter.getNFTsByCollection(shelfCollectionId);

                const accountShelfNFTId = allNFTs.find(({ owner, rootowner, symbol, burned }) => {
                    return rootowner === vote.accountId.toString() &&
                        symbol === params.settings.shelfNFTSymbol &&
                        burned === ""
                })

                if (!accountShelfNFTId) {
                    logger.info(`couldn't find parent for rootowner: ${vote.accountId.toString()}`)
                }
                // add emergency send shelf command here in case shelf was sent away in process?
                // logger.info("idParent", accountShelfNFTId.id)
                // //remove this
                // if (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                //     || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                //     || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                //     || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK") {
                    sendRemarks.push(nft.send(vote.accountId.toString())) //vote.accountId.toString() //accountShelfNFTId.id.toString()
                    //addResAndSendRemarks.push(nft.equip("base-11873516-SBP.181"))
                // }
            }
            // // put this for testing
            logger.info("sendRemarks: ", JSON.stringify(sendRemarks))
            //split remarks into sets of 100?
            const { block: sendBlock, success: sendSuccess, hash: sendHash, fee: sendFee } = await mintAndSend(sendRemarks);
            logger.info(`NFTs sent at block ${sendBlock}: ${sendSuccess} for a total fee of ${sendFee}`)
            while ((await params.remarkBlockCountAdapter.get()) < sendBlock) {
                await sleep(3000);
            }
            // }
        }
        chunkCount++;
    }



    //equip new collection to base
    //get base
    const bases = await params.remarkStorageAdapter.getAllBases();
    const base: BaseConsolidated = bases.find(({ issuer, symbol }) => {
        return issuer === encodeAddress(params.account.address, params.settings.network.prefix).toString() &&
            symbol === params.settings.baseSymbol
    })
    logger.info("baseId: ", base.id)
    const baseConsolidated = new Base(
        base.block,
        base.symbol,
        base.issuer,
        base.type,
        base.parts,
        base.themes,
        base.metadata
    )
    const baseEquippableRemarks = [];
    if (settings.createNewCollection) {
        for (const slot of settings.makeEquippable) {
            baseEquippableRemarks.push(baseConsolidated.equippable({ slot: slot, collections: [itemCollectionId], operator: "+" }))
        }
        logger.info("baseEquippableRemarks: ", JSON.stringify(baseEquippableRemarks))
        const { block: equippableBlock, success: equippableSuccess, hash: equippableHash, fee: equippableFee } = await mintAndSend(baseEquippableRemarks);
        logger.info(`Collection whitelisted at block ${equippableBlock}: ${equippableSuccess} for a total fee of ${equippableFee}`)
        while ((await params.remarkBlockCountAdapter.get()) < equippableBlock) {
            await sleep(3000);
        }
    }

    fs.writeFile(`assets/shelf/luck/${referendumIndex}.txt`, JSON.stringify(luckArray), (err) => {

        // In case of a error throw err.
        if (err) throw err;
    })

    logger.info(`Sendout complete for Referendum ${referendumIndex}`);
}