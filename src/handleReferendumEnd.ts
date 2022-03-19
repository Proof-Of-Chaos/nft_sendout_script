import { Modules, ReferendumMethods } from "../tools/constants.js";
import { sendNFTs } from "./sendNFTs.js";
import { logger } from "../tools/logger.js";

const isReferendumEvent = (section, method) => {
    if (
        ![Modules.Democracy].includes(section)
    ) {
        return false;
    }

    return ReferendumMethods.hasOwnProperty(method);
};

export const handleReferendumEnd = async (
    event,
    indexer // this indexer doesn't have extrinsic index
) => {
    const { section, method } = event;
    if (!isReferendumEvent(section, method)) {
        return;
    }
    logger.info("method", method)
    logger.info("block", indexer.blockHeight)
    if (ReferendumMethods.Passed === method) {
        const [id, type] = event.data;
        sendNFTs(true, id, indexer)
        //await saveNewReferendum(event, indexer);
    }
    if (ReferendumMethods.NotPassed === method) {
        const [id, type] = event.data;
        sendNFTs(false, id, indexer)
    }
};