import { logger } from "../tools/logger.js";
import { params } from "../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../tools/pinataUtils.js";
import { getApi, sendAndFinalize } from "../tools/substrateUtils.js";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";

export const createNewCollection = async (newCollectionId, settings) => {
    try {
        logger.info(`New Collection Id: `, newCollectionId);

        const royaltyProperty: IRoyaltyAttribute = {
            type: "royalty",
            value: {
                receiver: encodeAddress(params.account.address, params.settings.network.prefix),
                royaltyPercentFloat: 5
            }
        }

        const collectionMetadataCid = await pinSingleMetadataFromDir(
            settings.newCollectionPath,
            settings.newCollectionFile,
            settings.newCollectionName,
            {
                description: settings.newCollectionDescription,
                external_url: params.settings.externalUrl,
                properties: {
                    royaltyInfo: {
                        ...royaltyProperty
                    }
                },
            }
        );

        const NewCollection = new Collection(
            0,
            0,
            encodeAddress(params.account.address, params.settings.network.prefix),
            settings.newCollectionSymbol,
            newCollectionId,
            collectionMetadataCid
        );

        const api = await getApi()

        const { block } = await sendAndFinalize(
            api.tx.system.remark(NewCollection.create()),
            params.account
        );
        logger.info("NEW COLLECTION CREATION REMARK: ", NewCollection.create());
        logger.info("Collection created at block: ", block);
        return collectionMetadataCid

    } catch (error: any) {
        logger.error(error);
    }
}