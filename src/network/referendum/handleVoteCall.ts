import { getReferendumCollection } from "../../mongo/index.js";
import { logger } from "../../../tools/logger.js";
import { DemocracyMethods, Modules, TimelineItemTypes } from "../../../tools/constants.js";
import { updateVoteByHash } from "../../mongo/service/vote.js";
// import { getVoteCommonUpdates } from "./referendumHelpers.js";

export const handleReferendumCall = async (call, author, extrinsicIndexer) => {
    if (
        ![Modules.Democracy].includes(call.section) //||
        // DemocracyMethods.propose !== call.method
    ) {
        return;
    }
    console.log("call", call.toJSON())

    console.log("method1", call.method.toHuman())
    const {
        args: { ref_index: referendumIndex },
    } = call.toJSON();
    console.log("proposalValue", referendumIndex)
    const referendumCol = await getReferendumCollection();
    const referendum = await referendumCol.findOne({ referendumIndex, isFinal: false });
    // if (!vote) {
    //     logger.info(`vote with hash: ${hash} voteped but doesnt exist in db.`);
    //     return;
    // }
    // const updates = await getVoteCommonUpdates(hash, extrinsicIndexer);
    // const timelineItem = {
    //     type: TimelineItemTypes.extrinsic,
    //     method: VoteMethods.vote,
    //     args: {
    //         voteper: author,
    //         value: voteValue,
    //     },
    //     indexer: extrinsicIndexer,
    // };

    // await updateVoteByHash(hash, updates, timelineItem);
};

