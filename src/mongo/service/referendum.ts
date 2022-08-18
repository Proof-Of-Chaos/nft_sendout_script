import { getApi } from "../../../tools/substrateUtils.js";
import { sleep } from "../../../tools/utils.js";
import { getReferendumData, getReferendumVotes } from "../../saveVotesToDB.js";
import { getReferendumCollection } from "../index.js";
import { insertVotes } from "./vote.js";
import { logger } from '../../../tools/logger.js';

export const insertReferendum = async (referendum) => {
    const referendumCol = await getReferendumCollection();
    const maybeInDb = await referendumCol.findOne({
        referendum_index: referendum.referendum_index
    });
    if (maybeInDb) {
        return false;
    }

    await referendumCol.insertOne(referendum);
    return true;
};

const flatten = (ob) => {
    var toReturn = {};

    for (var i in ob) {
        if (!ob.hasOwnProperty(i)) continue;

        if ((typeof ob[i]) == 'object' && ob[i] !== null) {
            var flatObject = flatten(ob[i]);
            for (var x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;

                toReturn[i + '_' + x] = flatObject[x];
            }
        } else {
            toReturn[i] = ob[i];
        }
    }
    return toReturn;
};

export const upsertReferenda = async (referenda) => {
    const referendumCol = await getReferendumCollection();
    //loop over referenda
    for (const referendum of referenda) {
        const refDb = await referendumCol.findOne({
            referendum_index: referendum.referendum_index
        });

        let votes = []
        let totalIssuance;
        if (refDb && refDb.status && refDb.status === "started" && referendum.status !== "started") {
            const responseRef = await getReferendumData(referendum.referendum_index)
            sleep(1000);
            const responseJSONRef = await responseRef.json();
            let info;
            if (responseJSONRef && responseJSONRef.message == "Success" && responseJSONRef.data.info) {
                info = responseJSONRef.data.info;
            }

            //get total issuance
            const api = await getApi();
            const blockHash = await api.rpc.chain.getBlockHash(info.end);
            const blockApi = await api.at(blockHash);
            totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
            //saves votes as well
            let count = 0;
            let responseJSON = await getReferendumVotes(count, referendum.referendum_index)
            while (responseJSON.message == "Success" && responseJSON.data.list) {
                let referenda;
                if (responseJSON && responseJSON.message == "Success" && responseJSON.data.list) {
                    referenda = responseJSON.data.list;
                    votes.push(responseJSON.data.list)
                }
                sleep(1000);
                responseJSON = await getReferendumVotes(++count, referendum.referendum_index)
            }
            const flattenedInfo = flatten(info)
            let startedAt, endedAt;
            for (const element of info.timeline) {
                if (element.status === "started") {
                    startedAt = element.time
                }
                if (element.status === "passed" || element.status === "notPassed") {
                    endedAt = element.time
                }
            }
            const duration = endedAt - startedAt;
            try {
                await referendumCol.updateOne(
                    { referendum_index: referendum.referendum_index },
                    { $set: { ...flattenedInfo, total_issuance: totalIssuance, duration } },
                    { upsert: true });
            } catch (e) {
                logger.info(`Error saving referendum: ` + e);
            }

            const referendumIndexVotes = votes.map(vote => {
                return {
                    ...vote,
                    // account_id: vote.account.address,
                    // account_display: vote.account.display,
                    // account_identity: vote.account.identity,
                    referendum_index: referendum.referendum_index
                }
            })

            const flattenedVotes = referendumIndexVotes.map(ob => flatten(ob))

            await insertVotes(flattenedVotes)

        }
        else if (referendum.status !== "started" && !refDb) {
            const responseRef = await getReferendumData(referendum.referendum_index)
            sleep(1000);
            const responseJSONRef = await responseRef.json();
            let info;
            if (responseJSONRef && responseJSONRef.message == "Success" && responseJSONRef.data.info) {
                info = responseJSONRef.data.info;
            }
            //get total issuance
            const api = await getApi();
            const blockHash = await api.rpc.chain.getBlockHash(info.end);
            const blockApi = await api.at(blockHash);
            totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
            //saves votes as well
            let count = 0;
            let responseJSON = await getReferendumVotes(count, referendum.referendum_index)
            while (responseJSON.message == "Success" && responseJSON.data.list) {
                let referenda;
                if (responseJSON && responseJSON.message == "Success" && responseJSON.data.list) {
                    referenda = responseJSON.data.list;
                    votes.push(...responseJSON.data.list)
                }
                sleep(1000);
                responseJSON = await getReferendumVotes(++count, referendum.referendum_index)
            }
            const flattenedInfo = flatten(info)
            let startedAt, endedAt;
            for (const element of info.timeline) {
                if (element.status === "started") {
                    startedAt = element.time
                }
                if (element.status === "passed" || element.status === "notPassed") {
                    endedAt = element.time
                }
            }
            const duration = endedAt - startedAt;
            try {
                await referendumCol.updateOne(
                    { referendum_index: referendum.referendum_index },
                    { $set: { ...flattenedInfo, total_issuance: totalIssuance, duration } },
                    { upsert: true });
            } catch (e) {
                logger.info(`Error saving referendum: ` + e);
            }

            const referendumIndexVotes = votes.map(vote => {
                return {
                    ...vote,
                    // account_id: vote.account.address,
                    // account_display: vote.account.display,
                    // account_identity: vote.account.identity,
                    referendum_index: referendum.referendum_index
                }
            })

            const flattenedVotes = referendumIndexVotes.map(ob => flatten(ob))

            await insertVotes(flattenedVotes)

        }
        else if (referendum.status === "started") {
            const responseRef = await getReferendumData(referendum.referendum_index)
            sleep(1000);
            const responseJSONRef = await responseRef.json();
            let info;
            if (responseJSONRef && responseJSONRef.message == "Success" && responseJSONRef.data.info) {
                info = responseJSONRef.data.info;
            }
            const flattenedInfo = flatten(info)
            try {
                await referendumCol.updateOne(
                    { referendum_index: referendum.referendum_index },
                    { $set: { ...flattenedInfo, total_issuance: totalIssuance } },
                    { upsert: true });
            } catch (e) {
                logger.info(`Error saving referendum: ` + e);
            }
        }

    }
};