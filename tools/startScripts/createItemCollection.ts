import { params } from "../../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { sendAndFinalize } from "../substrateUtils.js";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";
import { logger } from "../logger.js";

export const createItemCollection = async () => {
    try {
        const itemCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.itemCollectionSymbol
        );
        logger.info(`Item Collection Id: `, itemCollectionId);

        const royaltyProperty: IRoyaltyAttribute = {
            type: "royalty",
            value: {
                receiver: encodeAddress(params.account.address, params.settings.network.prefix),
                royaltyPercentFloat: 5
            }
        }

        const collectionMetadataCid = await pinSingleMetadataFromDir(
            "/assets/shelf/collections",
            `item.png`,
            `Shelf Items`,
            {
                description: `A collection of items with which to fill up your shelf.`,
                external_url: params.settings.externalUrl,
                properties: {
                    royaltyInfo: {
                        ...royaltyProperty
                    }
                },
            }
        );

        const ItemCollection = new Collection(
            0,
            0,
            encodeAddress(params.account.address, params.settings.network.prefix),
            params.settings.itemCollectionSymbol,
            itemCollectionId,
            collectionMetadataCid
        );

        const { block } = await sendAndFinalize(
            params.api.tx.system.remark(ItemCollection.create()),
            params.account
        );
        logger.info("COLLECTION CREATION REMARK: ", ItemCollection.create());
        logger.info("Collection created at block: ", block);

    } catch (error: any) {
        console.error(error);
    }

};