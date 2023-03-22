import { logger } from "../tools/logger.js";
// import { params } from "../config.js";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../tools/pinataUtils.js";
// import { getApi, getApiTest, sendAndFinalize } from "../tools/substrateUtils.js";

export const createNewCollection = async (pinata, settings) => {
    try {
        const collectionMetadataCid = await pinSingleMetadataFromDir(
            pinata,
            settings.newCollectionPath,
            settings.newCollectionFile,
            settings.newCollectionName,
            {
                description: settings.newCollectionDescription,
                external_url: "https://www.proofofchaos.app/",
            }
        );
        return collectionMetadataCid

    } catch (error: any) {
        logger.error(error);
    }
}