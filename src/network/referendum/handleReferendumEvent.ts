import { getVoteCollection } from "../../mongo/index.js";
import {
    DemocracyEvents,
    //ReferendumEvents,
    Modules,
} from "../../../tools/constants.js";
import { saveNewReferendum } from "./saveNewReferendum.js";
// import { saveNewVote } from "./saveNewReferendum.js";
// import { updateVoteWithClosing } from "./updateReferendum.js";
// import { logger } from "../../../tools/logger.js";
// import { updateVoteWithVoteClosed } from "./updateVoteWithVoteClosed.js.js";
// import { updateVoteWithVoteRetracted } from "./updateVoteWithVoteRetracted.js.js";
// import { updateVoteWithVoteSlashed } from "./updateVoteWithVoteSlashed.js.js";

const isDemocracyEvent = (section, method) => {

    if (![Modules.Democracy].includes(section)) {
        return false;
    }
    console.log("method", method)
    return DemocracyEvents.hasOwnProperty(method);
}

export const handleDemocracyEvent = async (event, extrinsic, indexer) => {
    const { section, method, data } = event;
    if (!isDemocracyEvent(section, method)) {
        return;
    }
    const [hash] = data;
    const hashString = hash.toString();
    // const eventData = data.toJSON();
    // const hash = eventData[0];
    if (DemocracyEvents.Proposed === method) {
        await saveNewReferendum(event, extrinsic, indexer);
    }
    //else if (VoteEvents.VoteClosing === method) {
    //     const voteCol = await getVoteCollection();
    //     const vote = await voteCol.findOne({ hash: hashString, isFinal: false });
    //     if (!vote) {
    //         logger.info(`vote with hash: ${hashString} VoteClosing but doesnt exist in db.`);
    //         return;
    //     }
    //     await updateVoteWithClosing(hash.toString(), indexer);
    // } else if (VoteEvents.VoteClosed === method) {
    //     const voteCol = await getVoteCollection();
    //     const vote = await voteCol.findOne({ hash: hashString, isFinal: false });
    //     if (!vote) {
    //         logger.info(`vote with hash: ${hashString} VoteClosed but doesnt exist in db.`);
    //         return;
    //     }
    //     await updateVoteWithVoteClosed(event, extrinsic, indexer);
    // } else if (VoteEvents.VoteRetracted === method) {
    //     const voteCol = await getVoteCollection();
    //     const vote = await voteCol.findOne({ hash: hashString, isFinal: false });
    //     if (!vote) {
    //         logger.info(`vote with hash: ${hashString} VoteRetracted but doesnt exist in db.`);
    //         return;
    //     }
    //     await updateVoteWithVoteRetracted(event, extrinsic, indexer);
    // } else if (VoteEvents.VoteSlashed === method) {
    //     const voteCol = await getVoteCollection();
    //     const vote = await voteCol.findOne({ hash: hashString, isFinal: false });
    //     if (!vote) {
    //         logger.info(`vote with hash: ${hashString} VoteSlashed but doesnt exist in db.`);
    //         return;
    //     }
    //     await updateVoteWithVoteSlashed(event, extrinsic, indexer);
    // }
}