import { params } from "../../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { sendAndFinalize } from "../substrateUtils.js";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";

export const createTrophyCollection = async () => {
    try {
        const collectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.trophyCollectionSymbol
        );
        console.log(`Trophy Collection Id: `, collectionId);

        const royaltyProperty: IRoyaltyAttribute = {
            type: "royalty",
            value: {
                receiver: encodeAddress(params.account.address, params.settings.network.prefix),
                royaltyPercentFloat: 5
            }
        }

        const collectionMetadataCid = await pinSingleMetadataFromDir(
            "/assets/collections",
            `trophy.png`,
            `Trophies`,
            {
                description: `A collection of trophies with which to fill up your shelf.\n\n` +
                    `The only way to get these tiles to participate in referendum voting!`,
                external_url: params.settings.externalUrl,
                properties: {
                    royalty: {
                        ...royaltyProperty
                    }
                },
            }
        );

        const TrophyCollection = new Collection(
            0,
            0,
            encodeAddress(params.account.address, params.settings.network.prefix),
            params.settings.trophyCollectionSymbol,
            collectionId,
            collectionMetadataCid
        );

        const { block } = await sendAndFinalize(
            params.api.tx.system.remark(TrophyCollection.create()),
            params.account
        );
        console.log("COLLECTION CREATION REMARK: ", TrophyCollection.create());
        console.log("Collection created at block: ", block);

    } catch (error: any) {
        console.error(error);
    }

};