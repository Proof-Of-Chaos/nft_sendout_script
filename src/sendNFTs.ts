import seedrandom from "seedrandom";
import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleFileFromDir, pinSingleMetadataWithoutFile } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Collection, NFT } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { INftProps, VoteConviction, VoteConvictionDragon, VoteConvictionRequirements } from "../types.js";
import { getApi, getApiTest, getDecimal, sendBatchTransactions } from "../tools/substrateUtils.js";
import { amountToHumanString, getDragonBonusFile, getConfigFile, sleep } from "../tools/utils.js";
import { AccountId, VotingDelegating, VotingDirectVote } from "@polkadot/types/interfaces";
import { PalletDemocracyVoteVoting } from "@polkadot/types/lookup";
import { ApiDecoration } from "@polkadot/api/types";
import { encodeAddress } from "@polkadot/util-crypto";
import { nanoid } from "nanoid";
import { IAttribute, IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";
import { createNewCollection } from "./createNewCollection.js";
import { objectSpread } from '@polkadot/util';
import { locks } from "./locks.js";

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
                    result.push(
                        objectSpread({
                            accountId,
                            isDelegating: false
                        }, vote.asStandard)
                    );

                }

                return result;
            }, result), []
        );
}

const votesCurr = async (api: ApiDecoration<"promise">, referendumId: BN, expiryBlock: BN) => {
    const allVoting = await api.query.democracy.votingOf.entries()
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
    const LOCKPERIODS = [0, 1, 2, 4, 8, 16, 32];
    const sevenDaysBlocks = api.consts.democracy.voteLockingPeriod || api.consts.democracy.enactmentPeriod
    const promises = votes.map(async (vote) => {
        let maxLockedWithConviction = new BN(0);
        const userVotes = await locks(api, vote.accountId)
        let userLockedBalancesWithConviction: BN[] = []
        userVotes.map((userVote) => {
            if (userVote.unlockAt.sub(expiryBlock).gte(new BN(0)) || userVote.unlockAt.eqn(0)) {
                const lockPeriods = userVote.unlockAt.eqn(0) ? 0 : Math.floor((userVote.unlockAt.sub(expiryBlock)).muln(10).div(sevenDaysBlocks).toNumber() / 10)
                let matchingPeriod = 0
                for (let i = 0; i < LOCKPERIODS.length; i++) {
                    matchingPeriod = lockPeriods >= LOCKPERIODS[i] ? i : matchingPeriod
                }
                const lockedBalanceWithConviction = (userVote.balance.muln(LOCKS[matchingPeriod])).div(new BN(10))
                userLockedBalancesWithConviction.push(lockedBalanceWithConviction)
            }

        })

        //take max lockedBalanceWithConviction
        for (let i = 0; i < userLockedBalancesWithConviction.length; ++i) {
            maxLockedWithConviction = BN.max(userLockedBalancesWithConviction[i], maxLockedWithConviction)
        }
        return { ...vote, lockedWithConviction: maxLockedWithConviction }
    })
    votes = await Promise.all(promises);
    return votes;
}

const checkVotesMeetingRequirements = async (votes: VoteConvictionDragon[], totalIssuance: string, config): Promise<VoteConvictionRequirements[]> => {
    const minVote = BN.max(new BN(config.min), new BN("0"));
    const maxVote = BN.min(new BN(config.max), new BN(totalIssuance));
    logger.info("min:", minVote.toString());
    logger.info("minHuman:", await amountToHumanString(minVote.toString()))
    config.min = await getDecimal(minVote.toString())
    logger.info("max:", maxVote.toString());
    logger.info("maxHuman:", await amountToHumanString(maxVote.toString()))
    config.max = await getDecimal(maxVote.toString())
    let filtered = [];
    for (let i = 0; i < votes.length; i++) {
        if (votes[i].lockedWithConviction.lt(minVote)
            || votes[i].lockedWithConviction.gt(maxVote)
            || (config.directOnly && votes[i].isDelegating)
            || (config.first !== null && i > config.first)
        ) {
            filtered.push({ ...votes[i], meetsRequirements: false })
        }
        else {
            filtered.push({ ...votes[i], meetsRequirements: true })
        }
    }
    return filtered
}

const getVotesAndIssuance = async (referendumIndex: BN, config?): Promise<[String, VoteConviction[]]> => {
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

    let cutOffBlock: BN;

    cutOffBlock = config.blockCutOff !== null ?
        new BN(config.blockCutOff) : blockNumber
    logger.info("Cut-off Block: ", cutOffBlock.toString())
    const blockHashEnd = await api.rpc.chain.getBlockHash(blockNumber);
    const blockApiEnd = await api.at(blockHashEnd);
    const totalIssuance = (await blockApiEnd.query.balances.totalIssuance()).toString()
    return [totalIssuance, await votesCurr(blockApiEnd, referendumIndex, blockNumber)];
}

const getRandom = (rng, weights) => {
    var num = rng(),
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



const calculateLuck = async (n, minIn, maxIn, minOut, maxOut, exponent, babyBonus, toddlerBonus, adolescentBonus, adultBonus, dragonEquipped) => {
    n = await getDecimal(n);
    minOut = parseInt(minOut);
    maxOut = parseInt(maxOut);
    if (n > maxIn) {
        n = maxOut;
    }
    else if (n < minIn) {
        n = minOut;
    }
    else {
        // unscale input
        n -= minIn
        n /= maxIn - minIn
        n = Math.pow(n, exponent)
        // scale output
        n *= maxOut - minOut
        n += minOut

    }
    //check if dragon bonus
    switch (dragonEquipped) {
        case "Adult":
            return n * (1 + (adultBonus / 100))
        case "Adolescent":
            return n * (1 + (adolescentBonus / 100))
        case "Toddler":
            return n * (1 + (toddlerBonus / 100))
        case "Baby":
            return n * (1 + (babyBonus / 100))
        case "No":
            return n
    }
}

const getMinMaxMedian = (voteAmounts, criticalValue) => {
    if (voteAmounts.length < 4)
        return voteAmounts;
    voteAmounts = voteAmounts.filter(vote => {
        return vote > criticalValue
    })

    let values, q1, q3, iqr, maxValue, minValue, median;

    values = voteAmounts.slice().sort((a, b) => a - b);//copy array fast and sort
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
    logger.info("q1", q1);
    logger.info("q3", q3);
    iqr = q3 - q1;
    maxValue = q3 + iqr * 1.5;
    minValue = Math.max(q1 - iqr * 1.5, 0);
    return { minValue, maxValue, median };
}

export const sendNFTs = async (passed: boolean, referendumIndex: BN, indexer = null) => {
    //wait a bit since blocks after will be pretty full
    await sleep(10000);
    let api = await getApi();
    if (params.settings.isTest) {
        api = await getApiTest();
    }
    let votes: VoteConviction[] = [];
    let totalIssuance: String;
    let votesWithDragon: VoteConvictionDragon[];
    const chunkSize = params.settings.chunkSize;

    let configFile = await getConfigFile(referendumIndex);
    if (configFile === "") {
        return;
    }
    let config = await JSON.parse(configFile);
    const rng = seedrandom(referendumIndex.toString() + config.seed);
    let bonusFile = await getDragonBonusFile(referendumIndex);
    if (bonusFile === "") {
        return;
    }
    let bonuses = await JSON.parse(bonusFile);
    //check that bonusFile is from correct block
    if (bonuses.block != indexer.blockHeight) {
        logger.info(`Wrong Block in Bonus File. Exiting.`);
        return;
    }
    const babyDragons = bonuses.babies;
    const toddlerDragons = bonuses.toddlers;
    const adolescentDragons = bonuses.adolescents;
    const adultDragons = bonuses.adults;
    const babyWallets = babyDragons.map(({ wallet }) => wallet);
    const toddlerWallets = toddlerDragons.map(({ wallet }) => wallet);
    const adolescentWallets = adolescentDragons.map(({ wallet }) => wallet);
    const adultWallets = adultDragons.map(({ wallet }) => wallet);
    [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex, config);
    logger.info("Number of votes: ", votes.length)
    votesWithDragon = votes.map((vote) => {
        let dragonEquipped
        if (adultWallets.includes(vote.accountId.toString())) {
            dragonEquipped = "Adult"
        }
        else if (adolescentWallets.includes(vote.accountId.toString())) {
            dragonEquipped = "Adolescent"
        }
        else if (toddlerWallets.includes(vote.accountId.toString())) {
            dragonEquipped = "Toddler"
        }
        else if (babyWallets.includes(vote.accountId.toString())) {
            dragonEquipped = "Baby"
        }
        else {
            dragonEquipped = "No"
        }
        return { ...vote, dragonEquipped }
    })

    if (params.settings.isTest) {
        const votesAddresses = votes.map(vote => {
            return vote.accountId.toString()
        })
        fs.writeFile(`assets/frame/votes/${referendumIndex}.json`, JSON.stringify(votesAddresses), (err) => {
            // In case of a error throw err.
            if (err) throw err;
        })
    }

    const mappedVotes: VoteConvictionRequirements[] = await checkVotesMeetingRequirements(votesWithDragon, totalIssuance.toString(), config)

    const votesMeetingRequirements: VoteConvictionRequirements[] = mappedVotes.filter(vote => {
        return vote.meetsRequirements
    })

    logger.info(`${votesMeetingRequirements.length} votes meeting the requirements.`)

    const votesNotMeetingRequirements: VoteConvictionRequirements[] = mappedVotes.filter(vote => {
        return !vote.meetsRequirements
    })

    logger.info(`${votesNotMeetingRequirements.length} votes not meeting the requirements.`)

    let distribution = [];
    const minVote = votesMeetingRequirements.reduce((prev, curr) => prev.lockedWithConviction.lt(curr.lockedWithConviction) ? prev : curr);
    const maxVote = votesMeetingRequirements.reduce((prev, curr) => prev.lockedWithConviction.gt(curr.lockedWithConviction) ? prev : curr);
    logger.info("minVote", minVote.lockedWithConviction.toString())
    logger.info("maxVote", maxVote.lockedWithConviction.toString())
    const promises = votesMeetingRequirements.map(async (vote) => {
        return await getDecimal(vote.lockedWithConviction.toString())
    })
    const voteAmounts = await Promise.all(promises);
    let { minValue, maxValue, median } = getMinMaxMedian(voteAmounts, config.minAmount)
    minValue = Math.max(minValue, await getDecimal(minVote.lockedWithConviction.toString()))
    config.minValue = Math.max(minValue, config.minAmount)
    logger.info("minValue", minValue)
    config.maxValue = maxValue
    logger.info("maxValue", maxValue)
    config.median = median
    logger.info("median", median)
    await sleep(10000);

    let selectedIndexArray = [];
    for (const vote of mappedVotes) {
        let chance;
        let selectedIndex;
        let zeroOrOne;
        let counter = 0;
        let chances = [];
        if (vote.meetsRequirements) {
            for (const option of config.options) {
                if (counter < config.options.length - 1) {
                    if (await getDecimal(vote.lockedWithConviction.toString()) < median) {
                        chance = await calculateLuck(vote.lockedWithConviction.toString(),
                            minValue,
                            median,
                            option.minProbability,
                            option.sweetspotProbability,
                            3,
                            config.babyBonus,
                            config.toddlerBonus,
                            config.adolescentBonus,
                            config.adultBonus,
                            vote.dragonEquipped)
                    }
                    else {
                        chance = await calculateLuck(vote.lockedWithConviction.toString(),
                            median,
                            maxValue,
                            option.sweetspotProbability,
                            option.maxProbability,
                            0.4,
                            config.babyBonus,
                            config.toddlerBonus,
                            config.adolescentBonus,
                            config.adultBonus,
                            vote.dragonEquipped)
                    }
                    zeroOrOne = getRandom(rng, [chance / 100, (100 - chance) / 100]);
                    if (zeroOrOne === 0 && selectedIndex == null) {
                        selectedIndex = counter;
                    }
                }

                if (counter === config.options.length - 1) {
                    chances.push(100 - chance)
                    if (selectedIndex == null) {
                        selectedIndex = counter
                    }
                }
                else {
                    chances.push(chance)
                }
                counter++;
            }
            distribution.push({
                wallet: vote.accountId.toString(),
                amountConsidered: vote.lockedWithConviction.toString(),
                chances,
                selectedIndex,
                dragonEquipped: vote.dragonEquipped,
                meetsRequirements: vote.meetsRequirements,
                quizCorrect: null,
                identity: null,
            })
            selectedIndexArray.push(selectedIndex)
        }
        else {
            const commonIndex = config.options.length - 1
            const chances = new Array(commonIndex).fill(0)
            chances.push(100)
            distribution.push({
                wallet: vote.accountId.toString(),
                amountConsidered: vote.lockedWithConviction.toString(),
                chances,
                selectedIndex: commonIndex,
                dragonEquipped: vote.dragonEquipped,
                meetsRequirements: vote.meetsRequirements,
                quizCorrect: null,
                identity: null,
            })
            selectedIndexArray.push(commonIndex)
        }
    }
    var uniqs = selectedIndexArray.reduce((acc, val) => {
        acc[val] = acc[val] === undefined ? 1 : acc[val] += 1;
        return acc;
    }, {});

    logger.info(uniqs)

    fs.writeFile(`assets/frame/luck/${referendumIndex}.json`, JSON.stringify(distribution), (err) => {

        // In case of a error throw err.
        if (err) throw err;
    })

    let itemCollectionId;
    //create collection if required
    config.newCollectionMetadataCid = ""
    if (config.createNewCollection) {
        itemCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            config.newCollectionSymbol
        );
        config.newCollectionMetadataCid = await createNewCollection(itemCollectionId, config);
    }
    else {
        itemCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            "BITS"
        );
    }
    logger.info("collectionID Item: ", itemCollectionId)

    await sleep(10000);

    const metadataCids = []
    for (const option of config.options) {
        const rarityAttribute: IAttribute = {
            type: "string",
            value: option.rarity,
        }
        const supplyAttribute: IAttribute = {
            type: "number",
            value: uniqs[config.options.indexOf(option).toString()],
        }
        const artistAttribute: IAttribute = {
            type: "string",
            value: option.artist,
        }
        const creativeDirectorAttribute: IAttribute = {
            type: "string",
            value: option.creativeDirector,
        }
        const refIndexAttribute: IAttribute = {
            type: "string",
            value: referendumIndex.toString(),
        }
        const nameAttribute: IAttribute = {
            type: "string",
            value: option.itemName,
        }
        const typeOfVoteDirectAttribute: IAttribute = {
            type: "string",
            value: "direct",
        }
        const typeOfVoteDelegatedAttribute: IAttribute = {
            type: "string",
            value: "delegated",
        }

        const metadataCidDirect = await pinSingleMetadataWithoutFile(
            `Referendum ${referendumIndex}`,
            {
                description: option.text,
                properties: {
                    "rarity": {
                        ...rarityAttribute
                    },
                    "total_supply": {
                        ...supplyAttribute
                    },
                    "artist": {
                        ...artistAttribute
                    },
                    "creative_director": {
                        ...creativeDirectorAttribute
                    },
                    "referendum_index": {
                        ...refIndexAttribute
                    },
                    "name": {
                        ...nameAttribute
                    },
                    "type_of_vote": {
                        ...typeOfVoteDirectAttribute
                    }
                }
            }
        );
        option.metadataCidDirect = metadataCidDirect

        const metadataCidDelegated = await pinSingleMetadataWithoutFile(
            `Referendum ${referendumIndex}`,
            {
                description: option.text,
                properties: {
                    "rarity": {
                        ...rarityAttribute
                    },
                    "total_supply": {
                        ...supplyAttribute
                    },
                    "artist": {
                        ...artistAttribute
                    },
                    "creative_director": {
                        ...creativeDirectorAttribute
                    },
                    "referendum_index": {
                        ...refIndexAttribute
                    },
                    "name": {
                        ...nameAttribute
                    },
                    "type_of_vote": {
                        ...typeOfVoteDelegatedAttribute
                    }
                }
            }
        );
        option.metadataCidDelegated = metadataCidDelegated

        if (!metadataCidDirect || !metadataCidDelegated) {
            logger.error(`one of metadataCids is null: dir: ${metadataCidDirect} del: ${metadataCidDelegated}. exiting.`)
            return;
        }

        metadataCids.push([metadataCidDirect, metadataCidDelegated])
        // weights.push(option.probability)
    }
    logger.info("metadataCids", metadataCids);

    let chunkCount = 0

    let resourceCids = []
    for (const option of config.options) {
        let optionResourceCids = []
        for (let i = 0; i < option.resources.length; i++) {
            const resource = option.resources[i]
            let mainCid = await pinSingleFileFromDir("/assets/frame/referenda",
                resource.main,
                resource.name)
            let thumbCid = await pinSingleFileFromDir("/assets/frame/referenda",
                resource.thumb,
                resource.name + "_thumb")
            option.resources[i].mainCid = "ipfs://ipfs/" + mainCid
            option.resources[i].thumbCid = "ipfs://ipfs/" + thumbCid
            optionResourceCids.push([mainCid, thumbCid])
        }
        resourceCids.push(optionResourceCids)
    }

    logger.info("resourceCids", resourceCids);

    let resourceMetadataCids = []
    for (const option of config.options) {
        let optionResourceMetadataCids = []
        for (let i = 0; i < option.resources.length; i++) {
            const resource = option.resources[i]
            const rarityAttribute: IAttribute = {
                type: "string",
                value: resource.rarity,
            }
            const supplyAttribute: IAttribute = {
                type: "number",
                value: uniqs[config.options.indexOf(option).toString()],
            }
            const artistAttribute: IAttribute = {
                type: "string",
                value: resource.artist,
            }
            const creativeDirectorAttribute: IAttribute = {
                type: "string",
                value: resource.creativeDirector,
            }
            const refIndexAttribute: IAttribute = {
                type: "string",
                value: referendumIndex.toString(),
            }
            const nameAttribute: IAttribute = {
                type: "string",
                value: resource.itemName,
            }
            const typeOfVoteDirectAttribute: IAttribute = {
                type: "string",
                value: "direct",
            }
            const typeOfVoteDelegatedAttribute: IAttribute = {
                type: "string",
                value: "delegated",
            }
            const metadataResourceDirect = await pinSingleMetadataWithoutFile(
                `Referendum ${referendumIndex}`,
                {
                    description: resource.text,
                    properties: {
                        "rarity": {
                            ...rarityAttribute
                        },
                        "total_supply": {
                            ...supplyAttribute
                        },
                        "artist": {
                            ...artistAttribute
                        },
                        "creative_director": {
                            ...creativeDirectorAttribute
                        },
                        "referendum_index": {
                            ...refIndexAttribute
                        },
                        "name": {
                            ...nameAttribute
                        },
                        "type_of_vote": {
                            ...typeOfVoteDirectAttribute
                        }
                    }
                }
            );
            option.resources[i].metadataCidDirect = metadataResourceDirect

            const metadataResourceDelegated = await pinSingleMetadataWithoutFile(
                `Referendum ${referendumIndex}`,
                {
                    description: resource.text,
                    properties: {
                        "rarity": {
                            ...rarityAttribute
                        },
                        "total_supply": {
                            ...supplyAttribute
                        },
                        "artist": {
                            ...artistAttribute
                        },
                        "creative_director": {
                            ...creativeDirectorAttribute
                        },
                        "referendum_index": {
                            ...refIndexAttribute
                        },
                        "name": {
                            ...nameAttribute
                        },
                        "type_of_vote": {
                            ...typeOfVoteDelegatedAttribute
                        }
                    }
                }
            );
            option.resources[i].metadataCidDelegated = metadataResourceDelegated

            optionResourceMetadataCids.push([metadataResourceDirect, metadataResourceDelegated])
        }
        resourceMetadataCids.push(optionResourceMetadataCids)
    }

    if (params.settings.isTest) {
        fs.writeFile(`assets/frame/sendoutConfig/${referendumIndex}.json`, JSON.stringify(config), (err) => {
            // In case of a error throw err.
            if (err) throw err;
        })
    }


    logger.info("resourceMetadataCids", resourceMetadataCids);


    for (let i = 0; i < mappedVotes.length; i += chunkSize) {
        const chunk = mappedVotes.slice(i, i + chunkSize);
        logger.info(`Chunk ${chunkCount}: ${chunk.length}`)
        const mintRemarks: string[] = [];
        let usedMetadataCids: string[] = [];
        let usedResourceMetadataCids: string[] = [];
        let selectedOptions = [];
        let count = 0;

        for (let j = 0; j < chunk.length; j++) {
            const vote = chunk[j]
            const selectedOption = config.options[selectedIndexArray[i + j]];
            selectedOptions.push(selectedOption);
            const selectedMetadata = metadataCids[selectedIndexArray[i + j]];

            let metadataCid = vote.isDelegating ? selectedMetadata[1] : selectedMetadata[0]
            const randRoyaltyInRange = Math.floor(rng() * (selectedOption.maxRoyalty - selectedOption.minRoyalty + 1) + selectedOption.minRoyalty)
            const itemRoyaltyProperty: IRoyaltyAttribute = {
                type: "royalty",
                value: {
                    receiver: encodeAddress(params.account.address, params.settings.network.prefix),
                    royaltyPercentFloat: vote.meetsRequirements ? randRoyaltyInRange : config.defaultRoyalty
                }
            }
            if (!metadataCid) {
                logger.error(`metadataCid is null. exiting.`)
                return;
            }
            const nftProps: INftProps = {
                block: 0,
                sn: ('00000000' + ((chunkCount * chunkSize) + count++).toString()).slice(-8),
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
            usedResourceMetadataCids.push(resourceMetadataCids[selectedIndexArray[i + j]])
            const nft = new NFT(nftProps);
            if (params.settings.isTest && (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK")) {
                mintRemarks.push(nft.mint());
            }
            else if (!params.settings.isTest) {
                mintRemarks.push(nft.mint());
            }
        }
        logger.info("mintRemarks: ", JSON.stringify(mintRemarks))
        //mint
        if (mintRemarks.length > 0) {
            let blockMint, successMint, hashMint, feeMint;
            // if (chunkCount > 7) {
            ({ block: blockMint, success: successMint, hash: hashMint, fee: feeMint } = await sendBatchTransactions(mintRemarks));
            if (!successMint) {
                logger.info(`Failure minting NFTs at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
                return;
            }
            logger.info(`NFTs minted at block ${blockMint}: ${successMint} for a total fee of ${feeMint}`)
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
                    sn: ('00000000' + ((chunkCount * chunkSize) + count++).toString()).slice(-8),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1, //parseInt(selectedOption.transferable)
                    metadata: usedMetadataCids[index],
                    collection: itemCollectionId,
                    symbol: referendumIndex.toString() + selectedOption.symbol,
                };
                const nft = new NFT(nftProps);
                for (let i = 0; i < selectedOption.resources.length; i++) {
                    let resource = selectedOption.resources[i]
                    let mainCid = resourceCids[config.options.indexOf(selectedOption)][i][0]
                    let thumbCid = resourceCids[config.options.indexOf(selectedOption)][i][1]
                    if (params.settings.isTest && (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                        || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                        || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                        || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK")) {
                        addResRemarks.push(
                            (resource.slot) ?
                                nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    slot: `${resource.slot}`,
                                    metadata: vote.isDelegating ? usedResourceMetadataCids[index][i][1] : usedResourceMetadataCids[index][i][0]
                                }) : nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    metadata: vote.isDelegating ? usedResourceMetadataCids[index][i][1] : usedResourceMetadataCids[index][i][0]
                                })
                        );
                    }
                    else if (!params.settings.isTest) {
                        addResRemarks.push(
                            (resource.slot) ?
                                nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    slot: `${resource.slot}`,
                                    metadata: vote.isDelegating ? usedResourceMetadataCids[index][i][1] : usedResourceMetadataCids[index][i][0]
                                }) : nft.resadd({
                                    src: `ipfs://ipfs/${mainCid}`,
                                    thumb: `ipfs://ipfs/${thumbCid}`,
                                    id: nanoid(16),
                                    metadata: vote.isDelegating ? usedResourceMetadataCids[index][i][1] : usedResourceMetadataCids[index][i][0]
                                })
                        );
                    }
                }
            }
            logger.info("addResRemarks: ", JSON.stringify(addResRemarks))
            const { block: resAddBlock, success: resAddSuccess, hash: resAddHash, fee: resAddFee } = await sendBatchTransactions(addResRemarks);
            logger.info(`Resource(s) added to NFTs at block ${resAddBlock}: ${resAddSuccess} for a total fee of ${resAddFee}`)
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
                const nftProps: INftProps = {
                    block: blockMint,
                    sn: ('00000000' + ((chunkCount * chunkSize) + count++).toString()).slice(-8),
                    owner: encodeAddress(params.account.address, params.settings.network.prefix),
                    transferable: 1, //parseInt(selectedOption.transferable)
                    metadata: usedMetadataCids[index],
                    collection: itemCollectionId,
                    symbol: referendumIndex.toString() + selectedOption.symbol,
                };
                const nft = new NFT(nftProps);

                if (params.settings.isTest && (vote.accountId.toString() === "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic"
                    || vote.accountId.toString() === "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3"
                    || vote.accountId.toString() === "HWP8QiZRs3tVbHUFJwA4NANgCx2HbbSSsevgJWhHJaGNLeV"
                    || vote.accountId.toString() === "D2v2HoA6Kgd4czRT3Yo1uUq6XYntAk81GuYpCgVNjmZaETK")) {
                    sendRemarks.push(nft.send(vote.accountId.toString()))
                }
                else if (!params.settings.isTest) {
                    sendRemarks.push(nft.send(vote.accountId.toString()))
                }
            }
            logger.info("sendRemarks: ", JSON.stringify(sendRemarks))
            const { block: sendBlock, success: sendSuccess, hash: sendHash, fee: sendFee } = await sendBatchTransactions(sendRemarks);
            logger.info(`NFTs sent at block ${sendBlock}: ${sendSuccess} for a total fee of ${sendFee}`)
            // }
        }
        chunkCount++;
    }

    const baseEquippableRemarks = [];
    if (config.makeEquippable?.length > 0) {
        for (const slot of config.makeEquippable) {
            baseEquippableRemarks.push(`RMRK::EQUIPPABLE::2.0.0::base-15322902-FBP::${slot}::+${itemCollectionId}`)
        }
        logger.info("baseEquippableRemarks: ", JSON.stringify(baseEquippableRemarks))
        const { block: equippableBlock, success: equippableSuccess, hash: equippableHash, fee: equippableFee } = await sendBatchTransactions(baseEquippableRemarks);
        logger.info(`Collection whitelisted at block ${equippableBlock}: ${equippableSuccess} for a total fee of ${equippableFee}`)
    }
    let distributionAndConfigRemarks = []
    logger.info("Writing Distribution and Config to Chain")
    //write distribution to chain
    distributionAndConfigRemarks.push('PROOFOFCHAOS::' + referendumIndex.toString() + '::DISTRIBUTION::' + JSON.stringify(distribution))
    //write config to chain
    distributionAndConfigRemarks.push('PROOFOFCHAOS::' + referendumIndex.toString() + '::CONFIG::' + JSON.stringify(config))
    if (!params.settings.isTest) {
        logger.info("distributionAndConfigRemarks: ", JSON.stringify(distributionAndConfigRemarks))
    }
    const { block: writtenBlock, success: writtenSuccess, hash: writtenHash, fee: writtenFee } = await sendBatchTransactions(distributionAndConfigRemarks);
    logger.info(`Distribution and Config written to chain at block ${writtenBlock}: ${writtenSuccess} for a total fee of ${writtenFee}`)

    logger.info(`Sendout complete for Referendum ${referendumIndex}`);
}