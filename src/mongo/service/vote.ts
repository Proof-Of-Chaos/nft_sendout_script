import { getVoteCollection } from "../index.js";

export const insertVote = async (vote) => {
    const {
        indexer: { blockHeight },
        hash,
    } = vote;
    const voteCol = await getVoteCollection();
    const maybeInDb = await voteCol.findOne({
        "indexer.blockHeight": blockHeight,
        hash,
    });
    if (maybeInDb) {
        return false;
    }

    await voteCol.insertOne(vote);
    return true;
};

export const getActiveVoteByHash = async (hash) => {
    const voteCol = await getVoteCollection();
    return await voteCol.findOne({ hash, isFinal: false });
};

export const updateVoteByHash = async (hash, updates, timelineItem?) => {
    const voteCol = await getVoteCollection();

    let update = {
        $set: updates,
        $push: {}
    };

    if (timelineItem) {
        update = {
            ...update,
            $push: { timeline: timelineItem },
        };
    }

    await voteCol.updateOne({ hash: hash, isFinal: false }, update);
};