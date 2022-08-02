import { getApi } from "../../../tools/substrateUtils.js";
import { sleep } from "../../../tools/utils.js";
import { getReferendumData, getReferendumVotes } from "../../saveVotesToDB.js";
import { getReferendumCollection } from "../index.js";

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
            const blockHash = await api.rpc.chain.getBlockHash(referendum.end);
            const blockApi = await api.at(blockHash);
            totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
            //saves votes as well
            let count = 0;
            const response = await getReferendumVotes(count, referendum.referendum_index)
            let responseJSON = await response.json();
            while (responseJSON.message == "Success" && responseJSON.data.list) {
                let referenda;
                if (responseJSON && responseJSON.message == "Success" && responseJSON.data.list) {
                    referenda = responseJSON.data.list;
                    votes.push(responseJSON.data.list)
                }
                sleep(1000);
                const response = await getReferendumVotes(++count, referendum.referendum_index)
                responseJSON = await response.json();
            }
            await referendumCol.updateOne(
                { referendum_index: referendum.referendum_index },
                { $set: { ...info, votes, total_issuance: totalIssuance } },
                { upsert: true });

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
            const blockHash = await api.rpc.chain.getBlockHash(referendum.end);
            const blockApi = await api.at(blockHash);
            totalIssuance = (await blockApi.query.balances.totalIssuance()).toString()
            //saves votes as well
            let count = 0;
            const response = await getReferendumVotes(count, referendum.referendum_index)
            let responseJSON = await response.json();
            while (responseJSON.message == "Success" && responseJSON.data.list) {
                let referenda;
                if (responseJSON && responseJSON.message == "Success" && responseJSON.data.list) {
                    referenda = responseJSON.data.list;
                    votes.push(...responseJSON.data.list)
                }
                sleep(1000);
                const response = await getReferendumVotes(++count, referendum.referendum_index)
                responseJSON = await response.json();
            }
            await referendumCol.updateOne(
                { referendum_index: referendum.referendum_index },
                { $set: { ...info, votes, total_issuance: totalIssuance } },
                { upsert: true });

        }
        else if (referendum.status === "started") {
            const responseRef = await getReferendumData(referendum.referendum_index)
            sleep(1000);
            const responseJSONRef = await responseRef.json();
            let info;
            if (responseJSONRef && responseJSONRef.message == "Success" && responseJSONRef.data.info) {
                info = responseJSONRef.data.info;
            }
            await referendumCol.updateOne(
                { referendum_index: referendum.referendum_index },
                { $set: { ...info, votes, total_issuance: totalIssuance } },
                { upsert: true });


        }

    }
};