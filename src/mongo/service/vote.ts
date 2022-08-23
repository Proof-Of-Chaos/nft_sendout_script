import { logger } from "../../../tools/logger.js";
import { getVoteCollection } from "../index.js";

export const insertVotes = async (votes) => {
    const voteCol = await getVoteCollection();
    if (votes.length > 0){
        try {
            await voteCol.insertMany(votes, {upsert: true});
        } catch (e) {
            logger.info(`Error saving votes: ` + e);
        }
    }
};