import { BN } from '@polkadot/util';
import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { insertReferendum } from "./mongo/service/referendum.js";
import { logger } from '../tools/logger.js';

const addInfo = (vote) => {
    //check if wallet has set identity
    //check if wallet is validator etc.
}

export const saveVotesToDB = async (referendumIndex: BN,
    votes: DeriveReferendumVote[],
    totalIssuance: String,
    passed: boolean,
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

    const votesWithAdditionalInfo = formattedVotes.map(addInfo);
    const referendum = {
        id: referendumIndex.toString(),
        passed,
        block: indexer.blockHeight,
        time: indexer.blockTime,
        totalIssuance: totalIssuance.toString(),
        votes: formattedVotes
    }

    if (!await insertReferendum(referendum)) {
        return logger.info(`Referendum ${referendumIndex} already exists in DB.`)
    }
    logger.info(`Referendum ${referendumIndex} saved to DB.`)
}