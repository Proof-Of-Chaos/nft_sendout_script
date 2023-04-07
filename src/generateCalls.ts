import seedrandom from "seedrandom";
// import { params } from "../config.js";
import { BN, u8aToU8a } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleFileFromDir, pinSingleMetadataFromDir, pinSingleMetadataWithoutFile } from "../tools/pinataUtils.js";
import fs from 'fs';
import { Config, ConvictionVote, EncointerCommunity, EncointerMetadata, ParaInclusions, QuizSubmission, RNG, SquidStatus, VoteConviction, VoteConvictionDragon, VoteConvictionDragonQuiz, VoteConvictionDragonQuizEncointer, VoteConvictionRequirements } from "../types.js";
import { getApiEncointer, getApiKusama, getApiStatemine, getBlockIndexer, getDecimal, initAccount } from "../tools/substrateUtils.js";
import { getDragonBonusFile, getConfigFile, sleep } from "../tools/utils.js";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { createNewCollection } from "./createNewCollection.js";
import { useAccountLocksImpl } from "./locks.js";
import { getSettings } from "../tools/settings.js";
import pinataSDK from "@pinata/sdk";
import { getApiAt, getConvictionVoting } from "./chainData.js";
import { GraphQLClient } from 'graphql-request';
import { MultiAddress } from "@polkadot/types/interfaces/types.js";

/**
 * Retrieve account locks for the given votes and endBlock.
 * @param votes Array of ConvictionVote objects.
 * @param endBlock The block number to calculate locked balances.
 * @returns Array of VoteWithLock objects containing lockedWithConviction property.
 */
const retrieveAccountLocks = async (votes: ConvictionVote[], endBlock: number): Promise<VoteConviction[]> => {
    const api = await getApiAt("kusama", endBlock);
    const LOCKS = [1, 10, 20, 30, 40, 50, 60];
    const LOCKPERIODS = [0, 1, 2, 4, 8, 16, 32];
    const sevenDaysBlocks = api.consts.convictionVoting.voteLockingPeriod;

    const endBlockBN = new BN(endBlock);
    const promises = votes.map(async (vote) => {
        const userVotes = await useAccountLocksImpl(api, 'referenda', 'convictionVoting', vote.address.toString());

        const userLockedBalancesWithConviction = userVotes
            .filter((userVote) => userVote.endBlock.sub(endBlockBN).gte(new BN(0)) || userVote.endBlock.eqn(0))
            .map((userVote) => {
                const lockPeriods = userVote.endBlock.eqn(0) ? 0 : Math.floor((userVote.endBlock.sub(endBlockBN)).muln(10).div(sevenDaysBlocks).toNumber() / 10);
                const matchingPeriod = LOCKPERIODS.reduce((acc, curr, index) => (lockPeriods >= curr ? index : acc), 0);
                return userVote.total.muln(LOCKS[matchingPeriod]).div(new BN(10));
            });

        const maxLockedWithConviction = userLockedBalancesWithConviction.length > 0
            ? userLockedBalancesWithConviction.reduce((max, current) => BN.max(max, current))
            : new BN(0);

        return { ...vote, lockedWithConviction: maxLockedWithConviction };
    });

    return await Promise.all(promises);
};

/**
 * Check if votes meet the specified requirements.
 * @param votes Array of VoteConvictionDragon objects.
 * @param totalIssuance Total issuance as a string.
 * @param config Configuration object with min, max, directOnly, and first properties.
 * @returns Array of VoteCheckResult objects containing meetsRequirements property.
 */
const checkVotesMeetingRequirements = async (
    votes: VoteConvictionDragonQuizEncointer[],
    totalIssuance: string,
    config: Config
): Promise<VoteConvictionRequirements[]> => {
    const minVote = BN.max(new BN(config.min), new BN("0"));
    const maxVote = BN.min(new BN(config.max), new BN(totalIssuance));

    config.min = await getDecimal(minVote.toString());
    config.max = await getDecimal(maxVote.toString());

    const filtered: VoteConvictionRequirements[] = votes.map((vote, i) => {
        const meetsRequirements = !(
            vote.lockedWithConviction.lt(minVote)
            || vote.lockedWithConviction.gt(maxVote)
            || (config.directOnly && vote.voteType === "Delegating")
            || (config.first !== null && i > config.first)
        );

        return { ...vote, meetsRequirements };
    });

    return filtered;
};

/**
 * Returns a random index based on the given weights.
 * @param rng - A random number generator function.
 * @param weights - An array of weights corresponding to each index.
 * @returns A randomly selected index, with a higher probability for indices with higher weights.
 */
const getRandom = (rng: RNG, weights: number[]): number => {
    // Generate a random number using the provided rng function
    const num = rng();
    let sum = 0;
    const lastIndex = weights.length - 1;

    // Iterate through the weights array
    for (let i = 0; i < lastIndex; ++i) {
        // Update the sum with the current weight
        sum += weights[i];

        // If the random number is less than the sum, return the current index
        if (num < sum) {
            return i;
        }
    }

    // If none of the previous conditions were met, return the last index
    return lastIndex;
};

/**
 * Retrieves the latest Encointer ceremony index.
 * @param block - The block number to query at.
 * @returns The latest ceremony index as a number.
 */
const getLatestEncointerCeremony = async (block: number): Promise<number> => {
    const api = await getApiAt("encointer", block);
    const latestCeremonyIndex = await api.query.encointerScheduler.currentCeremonyIndex();
    return parseInt(latestCeremonyIndex.toString());
};

/**
 * Retrieves the reputation lifetime value from the Encointer chain.
 * @param block - The block number to query at.
 * @returns The reputation lifetime value as a number.
 */
const getReputationLifetime = async (block: number): Promise<number> => {
    const api = await getApiAt("encointer", block);
    const reputationLifetime = await api.query.encointerCeremonies.reputationLifetime();
    return parseInt(reputationLifetime.toString());
};

/**
 * Retrieves the ceremony attendants for a given community and ceremony index.
 * @param community - The Encointer community object.
 * @param ceremonyIndex - The index of the ceremony to query.
 * @param block - The block number to query at.
 * @returns An array of participant addresses as strings.
 */
const getCeremonyAttendants = async (
    community: EncointerCommunity,
    ceremonyIndex: number,
    block: number,
): Promise<string[]> => {
    const api = await getApiAt("encointer", block);
    const communityIdentifier = api.registry.createType('CommunityIdentifier', {
        geohash: api.registry.createType('GeoHash', u8aToU8a(community.geoHash)),
        digest: api.registry.createType('CidDigest', u8aToU8a(community.digest)),
    });
    const communityIdentifierWithCeremonyIndex = [
        communityIdentifier,
        ceremonyIndex,
    ];
    const participants = await api.query.encointerCeremonies.participantReputation.entries(communityIdentifierWithCeremonyIndex);
    const participantAddresses = participants.reduce((walletAddresses, currentValue, index) => {
        if (
            (currentValue[1].toHuman() === 'VerifiedLinked' || currentValue[1].toHuman() === 'VerifiedUnlinked')
        ) {
            walletAddresses.push(participants[index][0].toHuman()[1]);
        }
        return walletAddresses;
    }, []);

    return participantAddresses;
};

/**
 * Retrieves the Encointer block number corresponding to a given Kusama block number.
 * @param kusamaBlockNumber - The Kusama block number.
 * @returns The Encointer block number as a number or null if not found.
 */
const getEncointerBlockNumberFromKusama = async (kusamaBlockNumber: number): Promise<number | null> => {
    const kusamaApi = await getApiKusama();
    const encointerApi = await getApiEncointer();
    const blockHash = await kusamaApi.rpc.chain.getBlockHash(kusamaBlockNumber);
    const block = await kusamaApi.rpc.chain.getBlock(blockHash);
    const paraInherentExtrinsic = block.block.extrinsics.find(
        (extrinsic) => extrinsic.method.section === 'paraInherent' && extrinsic.method.method === 'enter'
    );

    if (!paraInherentExtrinsic) {
        return null;
    }
    const paraInclusions = (paraInherentExtrinsic.args[0].toJSON() as unknown) as ParaInclusions;
    const backedCandidates = paraInclusions.backedCandidates;

    const encointerParaId = 1001;
    let encointerBlockHeaderHash = null;

    for (const candidate of backedCandidates) {
        if (candidate.candidate.descriptor.paraId === encointerParaId) {
            encointerBlockHeaderHash = candidate.candidate.descriptor.paraHead;
            break;
        }
    }
    const encointerBlockHeader = await encointerApi.rpc.chain.getHeader(encointerBlockHeaderHash);
    const encointerBlockNumber = encointerBlockHeader.number.toNumber();
    return encointerBlockNumber;
}

/**
 * Get the current list of Encointer communities at a specific block.
 *
 * @param block - The block number to query the communities.
 * @returns - A Promise that resolves to an array of EncointerCommunity objects.
 */
const getCurrentEncointerCommunities = async (block: number): Promise<EncointerCommunity[]> => {
    // Get the Encointer API instance at the specified block
    const api = await getApiAt("encointer", block);

    // Query the Encointer communities' metadata
    const communityMetadata = await api.query.encointerCommunities.communityMetadata.entries();

    // Map the metadata to an array of EncointerCommunity objects
    const communities: EncointerCommunity[] = communityMetadata.map(([key, value]) => {
        const decodedKey = key.toHuman();
        const metadata: EncointerMetadata = JSON.parse(JSON.stringify(value.toHuman()));
        return {
            geoHash: decodedKey[0].geohash,
            digest: decodedKey[0].digest,
            name: metadata.name,
            symbol: metadata.symbol
        }
    });

    // Return the array of EncointerCommunity objects
    return communities;
}

/**
 * Calculate luck value based on various factors.
 *
 * @param n - The initial luck value.
 * @param minIn - The minimum input value.
 * @param maxIn - The maximum input value.
 * @param minOut - The minimum output value.
 * @param maxOut - The maximum output value.
 * @param exponent - The exponent value for scaling.
 * @param babyBonus - The bonus for baby dragons.
 * @param toddlerBonus - The bonus for toddler dragons.
 * @param adolescentBonus - The bonus for adolescent dragons.
 * @param adultBonus - The bonus for adult dragons.
 * @param quizBonus - The bonus for quiz correctness.
 * @param encointerBonus - The bonus for encointer score.
 * @param dragonEquipped - The type of dragon equipped.
 * @param quizCorrect - Whether the quiz was answered correctly.
 * @param encointerScore - The encointer score.
 * @returns - A Promise that resolves to the calculated luck value.
 */
const calculateLuck = async (
    voteAmountWithConviction: string,
    minIn: number,
    maxIn: number,
    minOut: number,
    maxOut: number,
    exponent: number,
    babyBonus: number,
    toddlerBonus: number,
    adolescentBonus: number,
    adultBonus: number,
    quizBonus: number,
    encointerBonus: number,
    dragonEquipped: string,
    quizCorrect: number,
    encointerScore: number
): Promise<string> => {
    let n = await getDecimal(voteAmountWithConviction);
    minOut = parseInt(minOut.toString());
    maxOut = parseInt(maxOut.toString());
    if (n > maxIn) {
        n = maxOut;
    } else if (n < minIn) {
        n = minOut;
    } else {
        // Unscale input
        n -= minIn;
        n /= maxIn - minIn;
        n = Math.pow(n, exponent);

        // Scale output
        n *= maxOut - minOut;
        n += minOut;
    }

    // Check if dragon bonus
    switch (dragonEquipped) {
        case 'Adult':
            n = n * (1 + adultBonus / 100);
            break;
        case 'Adolescent':
            n = n * (1 + adolescentBonus / 100);
            break;
        case 'Toddler':
            n = n * (1 + toddlerBonus / 100);
            break;
        case 'Baby':
            n = n * (1 + babyBonus / 100);
            break;
        case 'No':
            // No change
            break;
    }

    if (quizCorrect) {
        n = n * (1 + quizBonus / 100);
    }

    const maxEncointerScore = 5;
    const base = 2; // Change this value to adjust the exponential factor

    let bonus: number;

    if (encointerScore) {
        if (encointerScore < 0 || encointerScore > 5) {
            throw new Error('Score must be between 0 and 5');
        }
        if (encointerScore === maxEncointerScore) {
            bonus = (encointerBonus / 100) * Math.pow(base, maxEncointerScore - encointerScore);
            n = n * (1 + bonus);
        } else {
            bonus = (encointerBonus / 100) * Math.pow(base, maxEncointerScore - encointerScore - 1);
            n = n * (1 + bonus);
        }
    }
    return n.toFixed(2);
}

/**
 * Calculate the minimum, maximum, and median values of an array of vote amounts, considering only those above a critical value.
 * @param voteAmounts An array of vote amounts.
 * @param criticalValue The critical value to filter the vote amounts.
 * @returns An object containing the minimum, maximum, and median values.
 */
const getMinMaxMedian = (voteAmounts: number[], criticalValue: number): { minValue: number; maxValue: number; median: number } => {
    if (voteAmounts.length < 4) {
        return { minValue: Math.min(...voteAmounts), maxValue: Math.max(...voteAmounts), median: voteAmounts[Math.floor(voteAmounts.length / 2)] };
    }

    const filteredVotes = voteAmounts.filter(vote => vote > criticalValue);

    let values, q1, q3, iqr, maxValue, minValue, median;

    values = filteredVotes.slice().sort((a, b) => a - b); // Copy array and sort
    if ((values.length / 4) % 1 === 0) { // Find quartiles
        q1 = 1 / 2 * (values[(values.length / 4)] + values[(values.length / 4) + 1]);
        q3 = 1 / 2 * (values[(values.length * (3 / 4))] + values[(values.length * (3 / 4)) + 1]);
    } else {
        q1 = values[Math.floor(values.length / 4 + 1)];
        q3 = values[Math.ceil(values.length * (3 / 4) + 1)];
    }

    if ((values.length / 2) % 1 === 0) { // Find median
        median = 1 / 2 * (values[(values.length / 2)] + values[(values.length / 2) + 1]);
    } else {
        median = values[Math.floor(values.length / 2 + 1)];
    }

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


    const { referendum, totalIssuance, votes } = await getConvictionVoting(99);
    logger.info("Number of votes: ", votes.length)

    const voteLocks = await retrieveAccountLocks(votes, referendum.confirmationBlockNumber)

    const encointerBlock = await getEncointerBlockNumberFromKusama(referendum.confirmationBlockNumber)
    const communities: EncointerCommunity[] = await getCurrentEncointerCommunities(encointerBlock)
    const currentCeremonyIndex = await getLatestEncointerCeremony(encointerBlock)
    const reputationLifetime = await getReputationLifetime(encointerBlock)

    const lowerIndex = Math.max(0, currentCeremonyIndex - reputationLifetime);
    let attendants = []
    //for each community get latest 5 ceremony attendants
    for (const community of communities) {
        for (let cIndex = lowerIndex; cIndex < currentCeremonyIndex; cIndex++) {
            const unformattedAttendants = await getCeremonyAttendants(community, cIndex, encointerBlock)
            attendants.push(unformattedAttendants)
        }
    }
    const arrayOfReputables = attendants.flat();

    const countPerWallet = arrayOfReputables.reduce((elementCounts, element) => {
        elementCounts[element] = (elementCounts[element] || 0) + 1;
        return elementCounts;
    }, {});

    //apply encointer bonus

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


    //check quizzes
    //make sure indexer is up to date
    const queryIndexerBlock = `
    query {
        squidStatus {
          height
        }
      }
  `;

    let indexerBlock;
    // Instantiate the GraphQL client
    const client = new GraphQLClient('https://squid.subsquid.io/referenda-dashboard/v/0/graphql');
    // Fetch the data using the query
    (async () => {
        try {
            indexerBlock = (await client.request<{ squidStatus: SquidStatus }>(queryIndexerBlock)).squidStatus.height;
        } catch (error) {
            logger.error(error)
        }
    })();

    if (indexerBlock < blockNumber) {
        //indexer has not caught up to end block yet
        logger.info("Indexer has not caught up to endBlock of Referendum and is possibly stuck")
        return
    }

    // Define the GraphQL query
    const queryQuizSubmissions = `
  query {
    quizSubmissions(where: {governanceVersion_eq: 2, referendumIndex_eq: 34}) {
        blockNumber,
        quizId,
        timestamp,
        version,
        wallet,
        answers {
            isCorrect
        }
      }
  }
`;
    let quizSubmissions = [];
    // Fetch the data using the query
    (async () => {
        try {
            quizSubmissions = (await client.request<{ quizSubmissions: QuizSubmission[] }>(queryQuizSubmissions)).quizSubmissions;
        } catch (error) {
            logger.error(error)
        }
    })();

    //loop over votes and add a quiz correct number to each
    const votesWithDragonAndQuiz: VoteConvictionDragonQuiz[] = votesWithDragon.map((vote) => {
        const walletSubmissions = quizSubmissions.filter(submission => submission.wallet === vote.address);

        if (walletSubmissions.length == 0) {
            return { ...vote, quizCorrect: 0 }
        }
        // Get the latest submission
        const latestSubmission = walletSubmissions.reduce((latest, submission) => {
            return submission.blockNumber > latest.blockNumber ? submission : latest;
        }, walletSubmissions[0]);

        // Loop over the answers array and check if each answer is correct
        const someAnswersMissingCorrect = latestSubmission.answers.some(answer => answer.isCorrect === null || answer.isCorrect === undefined);

        // If any answers are incorrect, throw an error
        if (someAnswersMissingCorrect) {
            logger.info("Some answers are missing correct answer");
            return;
        }

        // Loop over the answers array and check if each answer is correct
        const allAnswersCorrect = latestSubmission.answers.every(answer => answer.isCorrect);

        // Return 1 if all answers are correct, otherwise return 0
        const quizCorrect = allAnswersCorrect ? 1 : 0;

        return { ...vote, quizCorrect }
    })

    //loop over votes and add a encointer score
    const votesWithDragonAndQuizAndEncointer: VoteConvictionDragonQuizEncointer[] = votesWithDragonAndQuiz.map((vote) => {
        const encointerScore = countPerWallet[vote.address];
        if (encointerScore) {
            console.log(vote.address, encointerScore)
        }
        return { ...vote, encointerScore: encointerScore ? encointerScore : 0 }
    })

    // if (settings.isTest) {
    //     const votesAddresses = votes.map(vote => {
    //         return vote.address.toString()
    //     })
    //     fs.writeFile(`assets/frame/votes/${referendumIndex}.json`, JSON.stringify(votes), (err) => {
    //         // In case of a error throw err.
    //         if (err) throw err;
    //     })
    // }

    const mappedVotes: VoteConvictionRequirements[] = await checkVotesMeetingRequirements(votesWithDragonAndQuizAndEncointer, totalIssuance.toString(), config)

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
    let selectedIndexArray = [];
    for (const vote of mappedVotes) {
        let chance;
        let selectedIndex;
        let zeroOrOne;
        let counter = 0;
        let chances = {};
        if (vote.meetsRequirements) {
            for (const option of config.options) {
                if (counter < config.options.length - 1) {
                    if (await getDecimal(vote.lockedWithConviction.toString()) < median) {
                        chance = await calculateLuck(vote.lockedWithConviction.toString(),
                            minValue,
                            median,
                            option.minProbability,
                            (option.maxProbability + option.minProbability) / 2,
                            3,
                            config.babyBonus,
                            config.toddlerBonus,
                            config.adolescentBonus,
                            config.adultBonus,
                            config.quizBonus,
                            config.encointerBonus,
                            vote.dragonEquipped,
                            vote.quizCorrect,
                            vote.encointerScore)
                    }
                    else {
                        chance = await calculateLuck(vote.lockedWithConviction.toString(),
                            median,
                            maxValue,
                            (option.maxProbability + option.minProbability) / 2,
                            option.maxProbability,
                            0.4,
                            config.babyBonus,
                            config.toddlerBonus,
                            config.adolescentBonus,
                            config.adultBonus,
                            config.quizBonus,
                            config.encointerBonus,
                            vote.dragonEquipped,
                            vote.quizCorrect,
                            vote.encointerScore)
                    }
                    zeroOrOne = getRandom(rng, [chance / 100, (100 - chance) / 100]);
                    if (zeroOrOne === 0 && selectedIndex == null) {
                        selectedIndex = counter;
                    }
                }

                if (counter === config.options.length - 1) {
                    chances[option.rarity] = 100 - chance
                    if (selectedIndex == null) {
                        selectedIndex = counter
                    }
                }
                else {
                    chances[option.rarity] = chance
                }
                counter++;
            }
            distribution.push({
                wallet: vote.address.toString(),
                amountConsidered: await getDecimal(vote.lockedWithConviction.toString()),
                chances,
                selectedIndex,
                dragonEquipped: vote.dragonEquipped,
                meetsRequirements: vote.meetsRequirements,
                quizCorrect: vote.quizCorrect,
                encointerScore: vote.encointerScore
            })
            selectedIndexArray.push(selectedIndex)
        }
        else {
            const commonIndex = config.options.length - 1
            const chances = { "epic": 0, "rare": 0, "common": 100 };
            distribution.push({
                wallet: vote.address.toString(),
                amountConsidered: await getDecimal(vote.lockedWithConviction.toString()),
                chances,
                selectedIndex: commonIndex,
                dragonEquipped: vote.dragonEquipped,
                meetsRequirements: vote.meetsRequirements,
                quizCorrect: vote.quizCorrect,
                encointerScore: vote.encointerScore
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
    const proxyWallet = "D3iNikJw3cPq6SasyQCy3k4Y77ZeecgdweTWoSegomHznG3";
    const proxyWalletSignature = {
        system: {
            Signed: proxyWallet
        }
    }
    const proxyWalletAdmin = {
        Id: proxyWallet
    }
    if (config.createNewCollection) {
        txs.push(apiStatemine.tx.uniques.create(config.newCollectionSymbol, proxyWallet))
        config.newCollectionMetadataCid = await createNewCollection(pinata, config);
        txs.push(apiStatemine.tx.uniques.setCollectionMetadata(config.newCollectionSymbol, config.newCollectionMetadataCid, true))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.create(config.newCollectionSymbol, proxyWallet)))
        // config.newCollectionMetadataCid = await createNewCollection(pinata, account.address, config);
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setCollectionMetadata(config.newCollectionSymbol, config.newCollectionMetadataCid, false)))
    }
    else {
        // use a default collection

    }
    logger.info("collectionID Item: ", itemCollectionId)

    const metadataCids = []
    const attributes = []
    for (const option of config.options) {
        const attributesDirect = [
            {
                name: "rarity",
                value: option.rarity
            },
            {
                name: "totalSupply",
                value: uniqs[config.options.indexOf(option).toString()]
            },
            {
                name: "artist",
                value: option.artist
            },
            {
                name: "creativeDirector",
                value: option.creativeDirector
            },
            {
                name: "name",
                value: option.itemName
            },
            {
                name: "typeOfVote",
                value: "direct"
            }
        ]
        const metadataCidDirect = await pinSingleMetadataFromDir(
            pinata,
            "/assets/frame/referenda",
            option.main,
            `Referendum ${referendumIndex}`,
            {
                description: option.text
            }
        );
        option.metadataCidDirect = metadataCidDirect

        const attributesDelegated = [
            {
                name: "rarity",
                value: option.rarity
            },
            {
                name: "totalSupply",
                value: uniqs[config.options.indexOf(option).toString()]
            },
            {
                name: "artist",
                value: option.artist
            },
            {
                name: "creativeDirector",
                value: option.creativeDirector
            },
            {
                name: "name",
                value: option.itemName
            },
            {
                name: "typeOfVote",
                value: "delegated"
            }
        ]

        const metadataCidDelegated = await pinSingleMetadataFromDir(
            pinata,
            "/assets/frame/referenda",
            option.main,
            `Referendum ${referendumIndex}`,
            {
                description: option.text
            }
        );
        option.metadataCidDelegated = metadataCidDelegated

        if (!metadataCidDirect || !metadataCidDelegated) {
            logger.error(`one of metadataCids is null: dir: ${metadataCidDirect} del: ${metadataCidDelegated}. exiting.`)
            return;
        }

        metadataCids.push([metadataCidDirect, metadataCidDelegated])
        attributes.push([attributesDirect, attributesDelegated])
    }
    logger.info("metadataCids", metadataCids);

    if (settings.isTest) {
        fs.writeFile(`assets/frame/sendoutConfig/${referendumIndex}.json`, JSON.stringify(config), (err) => {
            // In case of a error throw err.
            if (err) throw err;
        })
    }

    for (let i = 0; i < mappedVotes.length; i++) {
        let usedMetadataCids: string[] = [];
        let selectedOptions = [];

        const vote = mappedVotes[i]
        const selectedOption = config.options[selectedIndexArray[i]];
        selectedOptions.push(selectedOption);
        const selectedMetadata = metadataCids[selectedIndexArray[i]];

        let metadataCid = vote.voteType == "Delegating" ? selectedMetadata[1] : selectedMetadata[0]
        const randRoyaltyInRange = Math.floor(rng() * (selectedOption.maxRoyalty - selectedOption.minRoyalty + 1) + selectedOption.minRoyalty)
        if (!metadataCid) {
            logger.error(`metadataCid is null. exiting.`)
            return;
        }
        usedMetadataCids.push(metadataCid);
        // if (vote.address.toString() == "FF4KRpru9a1r2nfWeLmZRk6N8z165btsWYaWvqaVgR6qVic") {
        txs.push(apiStatemine.tx.uniques.mint(config.newCollectionSymbol, i, proxyWallet))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "royaltyPercentFloat", vote.meetsRequirements ? randRoyaltyInRange : config.defaultRoyalty))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "royaltyReceiver", "DhvRNnnsyykGpmaa9GMjK9H4DeeQojd5V5qCTWd1GoYwnTc"))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "amountLockedInGovernance", distribution[i].amountConsidered))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "voteDirection", vote.voteDirection))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "aye", vote.balance.aye.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "nay", vote.balance.nay.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "abstain", vote.balance.abstain.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "delegatedConvictionBalance", vote.delegatedConvictionBalance.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "chanceAtEpic", distribution[i].chances.epic.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "chanceAtRare", distribution[i].chances.rare.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "chanceAtCommon", distribution[i].chances.common.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "wallet", vote.address.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "dragonEquipped", distribution[i].dragonEquipped))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "quizCorrect", distribution[i].quizCorrect.toString()))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "encointerScore", distribution[i].encointerScore))
        txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "referendumIndex", referendumIndex.toString()))
        for (const attribute of vote.voteType == "Delegating" ? attributes[selectedIndexArray[i]][1] : attributes[selectedIndexArray[i]][0]) {
            txs.push(apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, attribute.name, attribute.value))
        }
        txs.push(apiStatemine.tx.uniques.setMetadata(config.newCollectionSymbol, i, metadataCid, true))
        txs.push(apiStatemine.tx.uniques.transfer(config.newCollectionSymbol, i, vote.address.toString()))


        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.mint(config.newCollectionSymbol, i, proxyWallet)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setMetadata(config.newCollectionSymbol, i, metadataCid, true)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "royaltyPercentFloat", vote.meetsRequirements ? randRoyaltyInRange : config.defaultRoyalty)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "royaltyReceiver", "DhvRNnnsyykGpmaa9GMjK9H4DeeQojd5V5qCTWd1GoYwnTc")))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "amountLockedInGovernance", distribution[i].amountConsidered)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "voteDirection", vote.voteDirection)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "aye", vote.balance.aye || 0)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "nay", vote.balance.nay || 0)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "abstain", vote.balance.abstain || 0)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "delegatedConvictionBalance", vote.delegatedConvictionBalance || 0)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "chanceAtEpic", distribution[i].chances.epic)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "chanceAtRare", distribution[i].chances.rare)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "chanceAtCommon", distribution[i].chances.common)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "dragonEquipped", distribution[i].dragonEquipped)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "quizCorrect", distribution[i].quizCorrect)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "identityScore", distribution[i].identityScore)))
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, "referendumIndex", referendumIndex.toString())))
        // for (const attribute of vote.isDelegating ? attributes[selectedIndexArray[i]][1] : attributes[selectedIndexArray[i]][0]) {
        //     txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.setAttribute(config.newCollectionSymbol, i, attribute.name, attribute.value)))
        // }
        // txs.push(apiStatemine.tx.utility.dispatchAs(proxyWalletSignature, apiStatemine.tx.uniques.transfer(config.newCollectionSymbol, i, vote.address.toString())))
        // }
    }
    const batchtx = apiStatemine.tx.utility.batchAll(txs).toHex()
    fs.writeFile(`assets/output/${referendumIndex}.json`, batchtx, (err) => {
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
    // const finalCall = apiKusama.tx.xcmPallet.send(dest, message)
    // fs.writeFile(`assets/output/1.json`, JSON.stringify(finalCall), (err) => {
    //     // In case of a error throw err.
    //     if (err) throw err;
    // })

    let distributionAndConfigRemarks = []
    logger.info("Writing Distribution and Config to Chain")
    //write distribution to chain
    // distributionAndConfigRemarks.push('PROOFOFCHAOS2::' + referendumIndex.toString() + '::DISTRIBUTION::' + JSON.stringify(distribution))
    //write config to chain
    // distributionAndConfigRemarks.push('PROOFOFCHAOS2::' + referendumIndex.toString() + '::CONFIG::' + JSON.stringify(config))
    // if (!settings.isTest) {
    //     logger.info("distributionAndConfigRemarks: ", JSON.stringify(distributionAndConfigRemarks))
    // }

}