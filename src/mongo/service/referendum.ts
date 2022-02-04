import { getReferendumCollection } from "../index.js";

export const insertReferendum = async (referendum) => {
    const {
        indexer: { blockHeight },
        hash,
    } = referendum;

    const referendumCol = await getReferendumCollection();
    const maybeInDb = await referendumCol.findOne({
        "indexer.blockHeight": blockHeight,
        hash,
    });
    if (maybeInDb) {
        return false;
    }

    await referendumCol.insertOne(referendum);
    return true;
};

export const updateReferendumByHash = async (hash, updates, timelineItem) => {
    const col = await getReferendumCollection();

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

    await col.updateOne({ hash: hash, isFinal: false }, update);
};