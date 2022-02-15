import { BN } from '@polkadot/util';
import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { insertReferendum } from "./mongo/service/referendum.js";
import { logger } from '../tools/logger.js';

export const saveVotesToDB = async (referendumIndex: BN,
    votes: DeriveReferendumVote[],
    totalIssuance: String,
    passed: boolean,
    indexer) => {
    const formattedVotes = votes.map(({ balance, accountId, vote }) => ({
        balance: balance.toString(),
        accountId: accountId.toString(),
        createdAt: vote?.createdAtHash,
        conviction: vote.conviction.toString(),
        isAye: vote.isAye,
        isNay: vote.isNay,
        isEmpty: vote.isEmpty
    }))
    const referendum = {
        id: referendumIndex.toString(),
        passed,
        block: indexer.blockHeight,
        time: indexer.blockTime,
        totalIssuance: totalIssuance.toString(),
        votes: formattedVotes
    }
    if (!await insertReferendum(referendum)){
        return logger.info(`Referendum ${referendumIndex} already exists in DB.`)
    }
    logger.info(`Referendum ${referendumIndex} saved to DB.`)
} 