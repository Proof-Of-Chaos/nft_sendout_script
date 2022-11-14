import { params } from "../../config.js";
import { Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { getApi, getApiTest, sendAndFinalize } from "../substrateUtils.js";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";
import { logger } from "../logger.js";

export const createBitsCollection = async () => {
    try {
        const bitsCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            "BITS"
        );
        logger.info(`Bits Collection Id: `, bitsCollectionId);

        const royaltyProperty: IRoyaltyAttribute = {
            type: "royalty",
            value: {
                receiver: encodeAddress(params.account.address, params.settings.network.prefix),
                royaltyPercentFloat: 5
            }
        }

        const collectionMetadataCid = await pinSingleMetadataFromDir(
            "/assets/frame/collections",
            `bits.png`,
            `The Bits`,
            {
                description: `A collection of bits and pieces airdropped to Kusama referendum voters.`,
                external_url: "https://www.proofofchaos.app/",
                properties: {
                    royaltyInfo: {
                        ...royaltyProperty
                    }
                },
            }
        );

        const BitsCollection = new Collection(
            0,
            0,
            encodeAddress(params.account.address, params.settings.network.prefix),
            "BITS",
            bitsCollectionId,
            collectionMetadataCid
        );

        const api = params.settings.isTest ? await getApiTest() : await getApi() ;

        const { block } = await sendAndFinalize(
            api.tx.system.remark(BitsCollection.create()),
            params.account
        );
        logger.info("COLLECTION CREATION REMARK: ", BitsCollection.create());
        logger.info("Collection created at block: ", block);

    } catch (error: any) {
        logger.error(error);
    }

};