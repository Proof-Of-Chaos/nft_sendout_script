import seedrandom from "seedrandom";
// import { params } from "../config.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleFileFromDir, pinSingleMetadataWithoutFile } from "../tools/pinataUtils.js";
import fs from 'fs';
import { u8aToHex } from "@polkadot/util";
import { ConvictionVote, VoteConviction, VoteConvictionDragon, VoteConvictionRequirements } from "../types.js";
import { getApiKusama, getApiStatemine, getApiTest, getDecimal, initAccount } from "../tools/substrateUtils.js";
import { getDragonBonusFile, getConfigFile, sleep } from "../tools/utils.js";
import { VotingDelegating, VotingDirectVote } from "@polkadot/types/interfaces";
import { PalletDemocracyVoteVoting } from "@polkadot/types/lookup";
import { ApiDecoration } from "@polkadot/api/types";
import { cryptoWaitReady, encodeAddress } from "@polkadot/util-crypto";
import { nanoid } from "nanoid";
import { createNewCollection } from "./createNewCollection.js";
import { objectSpread } from '@polkadot/util';
import { useAccountLocksImpl } from "./locks.js";
import { u16 } from "@polkadot/types";
import { getSettings } from "../tools/settings.js";
import pinataSDK from "@pinata/sdk";
import { getApiAt, getConvictionVoting } from "./chainData.js";

function extractAddressAndTrackId(storageKey = "", api) {
    const sectionRemoved: string | Uint8Array = storageKey.slice(32);
    const accountHashRemoved: string | Uint8Array = sectionRemoved.slice(8);
    const accountU8a: string | Uint8Array = accountHashRemoved.slice(0, 32);

    const accountRemoved = accountHashRemoved.slice(32);
    const classIdU8a = accountRemoved.slice(8);

    const address = encodeAddress(accountU8a, api.registry.chainSS58);
    const trackId = api.registry.createType("U16", classIdU8a).toNumber();

    return {
        address,
        trackId,
    };
}

function normalizeVotingOfEntry([storageKey, voting], blockApi) {
    const { address, trackId } = extractAddressAndTrackId(storageKey, blockApi);
    return { account: address, trackId, voting };
}

function extractVotes(mapped, targetReferendumIndex) {
    return mapped
        .filter(({ voting }) => voting.isCasting)
        .map(({ account, voting }) => {
            return {
                account,
                votes: voting.asCasting.votes.filter(([idx]) =>
                    idx.eq(targetReferendumIndex)
                ),
            };
        })
        .filter(({ votes }) => votes.length > 0)
        .map(({ account, votes }) => {
            return {
                account,
                vote: votes[0][1],
            };
        })
        .reduce((result, { account, vote }) => {
            if (vote.isStandard) {
                const standard = vote.asStandard;
                const balance = standard.balance.toBigInt().toString();

                result.push(
                    objectSpread(
                        {
                            account,
                            isDelegating: false,
                        },
                        {
                            balance,
                            aye: standard.vote.isAye,
                            split: standard.vote.isSplit,
                            splitAbstain: standard.vote.isSplitAbstain,
                            conviction: standard.vote.conviction.toNumber(),
                        }
                    )
                );
            }
            if (vote.isSplit) {
                const split = vote.asSplit;
                const { aye, nay } = split;

                const balance = aye.add(nay).toString();

                result.push(
                    objectSpread(
                        {
                            account,
                            isDelegating: false,
                        },
                        {
                            balance,
                            aye: split.vote.isAye,
                            split: split.vote.isSplit,
                            splitAbstain: split.vote.isSplitAbstain,
                            conviction: split.vote.conviction.toNumber(),
                        }
                    )
                );
            }
            if (vote.isSplitAbstain) {
                const splitAbstain = vote.asSplitAbstain;
                const { aye, nay, abstain } = splitAbstain;

                const balance = aye.add(nay).add(abstain).toString();

                result.push(
                    objectSpread(
                        {
                            account,
                            isDelegating: false,
                        },
                        {
                            balance,
                            aye: splitAbstain.vote.isAye,
                            split: splitAbstain.vote.isSplit,
                            splitAbstain: splitAbstain.vote.isSplitAbstain,
                            conviction: splitAbstain.vote.conviction.toNumber(),
                        }
                    )
                );
            }

            return result;
        }, []);
}

function getNested(accountId, delegationsInput, track) {
    //find delegations for towallet
    const delegations = delegationsInput
        .filter(({ delegating }) => delegating.target == accountId);
    if (delegations && delegations.length > 0) {
        let nestedDelegations = []
        for (let i = 0; i < delegations.length; i++) {
            const delegation = delegations[i]
            nestedDelegations.push(...(getNested(delegation.wallet, delegationsInput, track)))
        }
        return [...delegations, ...nestedDelegations]
    }
    else {
        return []
    }

    // let delegations = await ctx.store.find(ConvictionVotingDelegation, { where: { to: voter, blockNumberEnd: IsNull(), track} })
    // if (delegations && delegations.length > 0) {
    //     let nestedDelegations = []
    //     for (let i = 0; i < delegations.length; i++) {
    //         const delegation = delegations[i]
    //         nestedDelegations.push(...(await getAllNestedDelegations(ctx, delegation.wallet, track)))
    //     }
    //     return [...delegations, ...nestedDelegations]
    // }
    // else {
    //     return []
    // }
}

function extractDelegations(mapped, track, directVotes = []) {
    // const mywallet = mapped.filter(({account}) => {
    //     return account == "E8Gips4w5F9PXj5P3RT6Q8fQWP5SrMjbxGMmWtYr7FgS77q"
    // })
    // console.log("mywallet", mywallet)
    const delegations = mapped
        .filter(({ trackId, voting }) => voting.isDelegating && trackId == track.toString())
        .map(({ account, voting }) => {
            return {
                account,
                delegating: voting.asDelegating,
            };
        });
    // console.log(delegations[0].account)
    const delegationVotes = [];
    directVotes.forEach((directVote) => {
        const nestedDelegations = getNested(directVote.account, delegations, track.toString())
        if (nestedDelegations.length > 0) {
            delegationVotes.push(...nestedDelegations);
        }

    })
    console.log("delegationVotes", delegationVotes)
    // delegations.forEach(
    //     ({ account, delegating: { balance, conviction, target } }) => {
    //         const to = directVotes.find(
    //             ({ account }) => account === target.toString()
    //         );

    //         if (to) {
    //             delegationVotes.push({
    //                 account,
    //                 balance: balance.toBigInt().toString(),
    //                 isDelegating: true,
    //                 aye: to.aye,
    //                 conviction: conviction.toNumber(),
    //             });
    //         }
    //     }
    // );
    return delegationVotes;
}

const votesCurr = async (api: ApiDecoration<"promise">, referendumId: BN, trackId: u16, expiryBlock: BN) => {
    const voting = await api.query.convictionVoting.votingFor.entries();
    const mapped = voting.map((item) => normalizeVotingOfEntry(item, api));

    const directVotes = extractVotes(mapped, referendumId);
    // const votesViaDelegating = extractDelegations(mapped, trackId, directVotes);
    let votes = [
        ...directVotes,
        // ...votesViaDelegating,
    ];

    const LOCKS = [1, 10, 20, 30, 40, 50, 60];
    const LOCKPERIODS = [0, 1, 2, 4, 8, 16, 32];
    const sevenDaysBlocks = api.consts.convictionVoting.voteLockingPeriod
    const promises = votes.map(async (vote) => {
        let maxLockedWithConviction = new BN(0);
        // api, vote.account, trackId
        const userVotes = await useAccountLocksImpl(api, 'referenda', 'convictionVoting', vote.account.toString())
        let userLockedBalancesWithConviction: BN[] = []
        userVotes.map((userVote) => {
            if (userVote.endBlock.sub(expiryBlock).gte(new BN(0)) || userVote.endBlock.eqn(0)) {
                const lockPeriods = userVote.endBlock.eqn(0) ? 0 : Math.floor((userVote.endBlock.sub(expiryBlock)).muln(10).div(sevenDaysBlocks).toNumber() / 10)
                let matchingPeriod = 0
                for (let i = 0; i < LOCKPERIODS.length; i++) {
                    matchingPeriod = lockPeriods >= LOCKPERIODS[i] ? i : matchingPeriod
                }
                const lockedBalanceWithConviction = (userVote.total.muln(LOCKS[matchingPeriod])).div(new BN(10))
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

const getLocks = async (votes: ConvictionVote[], endBlock: number) => {
    const api = await getApiAt(endBlock)
    const LOCKS = [1, 10, 20, 30, 40, 50, 60];
    const LOCKPERIODS = [0, 1, 2, 4, 8, 16, 32];
    const sevenDaysBlocks = api.consts.convictionVoting.voteLockingPeriod
    const endBlockBN = new BN(endBlock)
    const promises = votes.map(async (vote) => {
        let maxLockedWithConviction = new BN(0);
        // api, vote.account, trackId
        const userVotes = await useAccountLocksImpl(api, 'referenda', 'convictionVoting', vote.address.toString())
        let userLockedBalancesWithConviction: BN[] = []
        userVotes.map((userVote) => {
            if (userVote.endBlock.sub(endBlockBN).gte(new BN(0)) || userVote.endBlock.eqn(0)) {
                const lockPeriods = userVote.endBlock.eqn(0) ? 0 : Math.floor((userVote.endBlock.sub(endBlockBN)).muln(10).div(sevenDaysBlocks).toNumber() / 10)
                let matchingPeriod = 0
                for (let i = 0; i < LOCKPERIODS.length; i++) {
                    matchingPeriod = lockPeriods >= LOCKPERIODS[i] ? i : matchingPeriod
                }
                const lockedBalanceWithConviction = (userVote.total.muln(LOCKS[matchingPeriod])).div(new BN(10))
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

const checkVotesMeetingRequirements = async (votes: VoteConvictionDragon[], totalIssuance: string, config): Promise<any[]> => {
    const minVote = BN.max(new BN(config.min), new BN("0"));
    const maxVote = BN.min(new BN(config.max), new BN(totalIssuance));
    logger.info("min:", minVote.toString());
    // logger.info("minHuman:", await amountToHumanString(minVote.toString()))
    config.min = await getDecimal(minVote.toString())
    logger.info("max:", maxVote.toString());
    // logger.info("maxHuman:", await amountToHumanString(maxVote.toString()))
    config.max = await getDecimal(maxVote.toString())
    let filtered = [];
    for (let i = 0; i < votes.length; i++) {
        if (votes[i].lockedWithConviction.lt(minVote)
            || votes[i].lockedWithConviction.gt(maxVote)
            || (config.directOnly && votes[i].voteType == "Delegating")
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

const getVotesAndIssuance = async (referendumIndex: BN, blockNumber: BN, config?) => {
    const api = await getApiKusama();
    let cutOffBlock: BN;

    cutOffBlock = config.blockCutOff !== null ?
        new BN(config.blockCutOff) : blockNumber
    logger.info("Cut-off Block: ", cutOffBlock.toString())
    const blockHashEnd = await api.rpc.chain.getBlockHash(blockNumber.subn(1));
    const blockApiEnd = await api.at(blockHashEnd);
    const infoOngoing = await blockApiEnd.query.referenda.referendumInfoFor(referendumIndex);
    const totalIssuance = (await blockApiEnd.query.balances.totalIssuance()).toString()
    return [totalIssuance, await votesCurr(blockApiEnd, referendumIndex, infoOngoing.unwrap().asOngoing.track, blockNumber)];
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

export const generateCalls = async (referendumIndex: BN) => {
    await cryptoWaitReady()
    const settings = getSettings();
    const account = initAccount();
    let apiKusama = await getApiKusama();
    let apiStatemine = await getApiStatemine();

    const info = await apiKusama.query.referenda.referendumInfoFor(referendumIndex);
    let blockNumber: BN;
    try {
        blockNumber = info.unwrap().asApproved[0] || info.unwrap().asRejected[0] || info.unwrap().asKilled[0] || info.unwrap().asCancelled[0]
    }
    catch (e) {
        logger.error(`Referendum is still ongoing: ${e}`);
        return;
    }

    // const networkProperties = await apiKusama.rpc.system.properties();
    // if (!settings.network.prefix && networkProperties.ss58Format) {
    //     settings.network.prefix = networkProperties.ss58Format.toString();
    // }
    // if (!settings.network.decimals && networkProperties.tokenDecimals) {
    //     settings.network.decimals = networkProperties.tokenDecimals.toString();
    // }
    // if (
    //     settings.network.token === undefined &&
    //     networkProperties.tokenSymbol
    // ) {
    //     settings.network.token = networkProperties.tokenSymbol.toString();
    // }

    //setup pinata
    const pinata = pinataSDK(process.env.PINATA_API, process.env.PINATA_SECRET);
    try {
        const result = await pinata.testAuthentication();
        logger.info(result);
    }
    catch (err) {
        //handle error here
        logger.info(err);
    }

    // let votes;
    let votesWithDragon: VoteConvictionDragon[];



    let configFile = await getConfigFile(referendumIndex);
    if (configFile === "") {
        return;
    }
    let config = await JSON.parse(configFile);
    const rng = seedrandom(referendumIndex.toString() + config.seed);


    // [totalIssuance, votes] = await getVotesAndIssuance(referendumIndex, blockNumber, config);
    const {referendum, totalIssuance, votes } = await getConvictionVoting(54);
    const voteLocks = await getLocks(votes, referendum.confirmationBlockNumber)
    console.log("one", voteLocks.length)
    logger.info("Number of votes: ", votes.length)




    let bonusFile = await getDragonBonusFile(referendumIndex);
    if (bonusFile === "") {
        return;
    }
    let bonuses = await JSON.parse(bonusFile);
    // check that bonusFile is from correct block
    if (bonuses.block != blockNumber) {
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

    votesWithDragon = voteLocks.map((vote) => {
        let dragonEquipped
        if (adultWallets.includes(vote.address.toString())) {
            dragonEquipped = "Adult"
        }
        else if (adolescentWallets.includes(vote.address.toString())) {
            dragonEquipped = "Adolescent"
        }
        else if (toddlerWallets.includes(vote.address.toString())) {
            dragonEquipped = "Toddler"
        }
        else if (babyWallets.includes(vote.address.toString())) {
            dragonEquipped = "Baby"
        }
        else {
            dragonEquipped = "No"
        }
        return { ...vote, dragonEquipped }
    })

    if (settings.isTest) {
        const votesAddresses = votes.map(vote => {
            return vote.address.toString()
        })
        fs.writeFile(`assets/frame/votes/${referendumIndex}.json`, JSON.stringify(votesAddresses), (err) => {
            // In case of a error throw err.
            if (err) throw err;
        })
    }

    const mappedVotes = await checkVotesMeetingRequirements(votesWithDragon, totalIssuance.toString(), config)

    const votesMeetingRequirements = mappedVotes.filter(vote => {
        return vote.meetsRequirements
    })

    logger.info(`${votesMeetingRequirements.length} votes meeting the requirements.`)

    const votesNotMeetingRequirements = mappedVotes.filter(vote => {
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
                wallet: vote.address.toString(),
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
                wallet: vote.account.toString(),
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
    let txs = [];
    const proxyWallet = "DhvRNnnsyykGpmaa9GMjK9H4DeeQojd5V5qCTWd1GoYwnTc";
    const proxyWalletSignature = {
        system: {
            Signed: proxyWallet
        }
    }
    if (config.createNewCollection) {
        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.create(config.newCollectionSymbol, proxyWallet)))
        config.newCollectionMetadataCid = await createNewCollection(pinata, account.address, config);
        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setCollectionMetadata(config.newCollectionSymbol, config.newCollectionMetadataCid, false)))
    }
    else {
        // use a default collection

    }
    logger.info("collectionID Item: ", itemCollectionId)

    await sleep(10000);

    const metadataCids = []
    for (const option of config.options) {
        const rarityAttribute = {
            type: "string",
            value: option.rarity,
        }
        const supplyAttribute = {
            type: "number",
            value: uniqs[config.options.indexOf(option).toString()],
        }
        const artistAttribute = {
            type: "string",
            value: option.artist,
        }
        const creativeDirectorAttribute = {
            type: "string",
            value: option.creativeDirector,
        }
        const refIndexAttribute = {
            type: "string",
            value: referendumIndex.toString(),
        }
        const nameAttribute = {
            type: "string",
            value: option.itemName,
        }
        const typeOfVoteDirectAttribute = {
            type: "string",
            value: "direct",
        }
        const typeOfVoteDelegatedAttribute = {
            type: "string",
            value: "delegated",
        }

        const metadataCidDirect = await pinSingleMetadataWithoutFile(
            pinata,
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
            pinata,
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
            let mainCid = await pinSingleFileFromDir(pinata,
                "/assets/frame/referenda",
                resource.main,
                resource.name)
            let thumbCid = await pinSingleFileFromDir(pinata,
                "/assets/frame/referenda",
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
            const rarityAttribute = {
                type: "string",
                value: resource.rarity,
            }
            const supplyAttribute = {
                type: "number",
                value: uniqs[config.options.indexOf(option).toString()],
            }
            const artistAttribute = {
                type: "string",
                value: resource.artist,
            }
            const creativeDirectorAttribute = {
                type: "string",
                value: resource.creativeDirector,
            }
            const refIndexAttribute = {
                type: "string",
                value: referendumIndex.toString(),
            }
            const nameAttribute = {
                type: "string",
                value: resource.itemName,
            }
            const typeOfVoteDirectAttribute = {
                type: "string",
                value: "direct",
            }
            const typeOfVoteDelegatedAttribute = {
                type: "string",
                value: "delegated",
            }
            const metadataResourceDirect = await pinSingleMetadataWithoutFile(
                pinata,
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
                pinata,
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

    if (settings.isTest) {
        fs.writeFile(`assets/frame/sendoutConfig/${referendumIndex}.json`, JSON.stringify(config), (err) => {
            // In case of a error throw err.
            if (err) throw err;
        })
    }


    logger.info("resourceMetadataCids", resourceMetadataCids);


    for (let i = 0; i < 2; i++) {
        const mintRemarks: string[] = [];
        let usedMetadataCids: string[] = [];
        let usedResourceMetadataCids: string[] = [];
        let selectedOptions = [];
        let count = 0;

        const vote = mappedVotes[i]
        const selectedOption = config.options[selectedIndexArray[i]];
        selectedOptions.push(selectedOption);
        const selectedMetadata = metadataCids[selectedIndexArray[i]];

        let metadataCid = vote.isDelegating ? selectedMetadata[1] : selectedMetadata[0]
        const randRoyaltyInRange = Math.floor(rng() * (selectedOption.maxRoyalty - selectedOption.minRoyalty + 1) + selectedOption.minRoyalty)
        // const itemRoyaltyProperty = {
        //     type: "royalty",
        //     value: {
        //         receiver: encodeAddress(account.address, parseInt(settings.network.prefix)),
        //         royaltyPercentFloat: vote.meetsRequirements ? randRoyaltyInRange : config.defaultRoyalty
        //     }
        // }
        if (!metadataCid) {
            logger.error(`metadataCid is null. exiting.`)
            return;
        }
        usedMetadataCids.push(metadataCid);

        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.mint(config.newCollectionSymbol, i, proxyWallet)))
        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setMetadata(config.newCollectionSymbol, i, metadataCid, false)))
        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "royaltyPercentFloat", vote.meetsRequirements ? randRoyaltyInRange : config.defaultRoyalty)))
        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "royaltyReceiver", "DhvRNnnsyykGpmaa9GMjK9H4DeeQojd5V5qCTWd1GoYwnTc")))
        txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.transfer(config.newCollectionSymbol, i, vote.address.toString())))
    }
    const batchtx = apiStatemine.tx.utility.batch(txs).toHex()
    fs.writeFile(`assets/output/${referendumIndex}.json`, JSON.stringify(batchtx), (err) => {
        // In case of a error throw err.
        if (err) throw err;
    })
    // console.log(apiStatemine.tx.utility.batch(txs).toHex())
    const dest = {
        V1: {
            interior: {
                X1: {
                    parachain: 1000
                }
            }
        }
    }
    const message = {
        V2: {
            0: {
                transact: {
                    call: batchtx,
                    originType: 'Superuser',
                    require_weight_at_most: 1000000000
                }
            }
        }
    }
    const finalCall = apiKusama.tx.xcmPallet.send(dest, message)
    fs.writeFile(`assets/output/1.json`, JSON.stringify(finalCall), (err) => {
        // In case of a error throw err.
        if (err) throw err;
    })

    let distributionAndConfigRemarks = []
    logger.info("Writing Distribution and Config to Chain")
    //write distribution to chain
    distributionAndConfigRemarks.push('PROOFOFCHAOS2::' + referendumIndex.toString() + '::DISTRIBUTION::' + JSON.stringify(distribution))
    //write config to chain
    distributionAndConfigRemarks.push('PROOFOFCHAOS2::' + referendumIndex.toString() + '::CONFIG::' + JSON.stringify(config))
    // if (!settings.isTest) {
    //     logger.info("distributionAndConfigRemarks: ", JSON.stringify(distributionAndConfigRemarks))
    // }

}