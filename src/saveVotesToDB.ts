import { BN } from '@polkadot/util';
import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { insertReferendum } from "./mongo/service/referendum.js";
import { logger } from '../tools/logger.js';
import dotenv from "dotenv";
import fetch from 'node-fetch';
import { ApiPromise } from '@polkadot/api';
import { sleep } from '../tools/utils.js';

dotenv.config();

const addInfo = (vote) => {
    //check if wallet has set identity
    //check if wallet is validator etc.
}

const getReferendumData = async (referendumIndex: BN, retry = 0): Promise<any> => {
    try {
        const response = await fetch("https://kusama.api.subscan.io/api/scan/democracy/referendum", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.SUBSCAN_API
            },
            body: JSON.stringify({ "referendum_index": referendumIndex.toNumber() })
        });
        return response
    } catch (e) {
        if (retry < 10) {
            logger.info(`getReferendumData request failed. Retrying`);
            await sleep(2 * 1000);
            return await getReferendumData(referendumIndex, retry + 1);
        }
        else {
            logger.error(`Error in getReferendumData`, e);
            return;
        }
    }
}

export const saveVotesToDB = async (referendumIndex: BN,
    votes: DeriveReferendumVote[],
    totalIssuance: String,
    indexer) => {

    const formattedVotes = votes.map(({ balance, accountId, vote, isDelegating }) => (

        {
            balance: balance.toString(),
            accountId: accountId.toString(),
            createdAt: vote?.createdAtHash,
            conviction: vote.conviction.toString(),
            isAye: vote.isAye,
            isNay: vote.isNay,
            isDelegating: isDelegating,
            isEmpty: vote.isEmpty
        }
    ))
    const response = await getReferendumData(referendumIndex)
    const responseJSON = await response.json();
    let info;
    if (responseJSON && responseJSON.message == "Success" && responseJSON.data.info){
        info = responseJSON.data.info;
    }
    const votesWithAdditionalInfo = formattedVotes.map(addInfo);
    const referendum = {
        ...info,
        time: indexer.blockTime,
        totalIssuance: totalIssuance.toString(),
        votes: formattedVotes
    }

    if (!await insertReferendum(referendum)) {
        return logger.info(`Referendum ${referendumIndex} already exists in DB.`)
    }
    logger.info(`Referendum ${referendumIndex} saved to DB.`)
}