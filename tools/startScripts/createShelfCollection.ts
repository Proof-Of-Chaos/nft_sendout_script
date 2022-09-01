import { params } from "../../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { getApi, getApiTest, sendAndFinalize } from "../substrateUtils.js";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";
import { logger } from "../logger.js";

export const createShelfCollection = async () => {
  try {
    const collectionId = Collection.generateId(
      u8aToHex(params.account.publicKey),
      params.settings.parentCollectionSymbol
    );
    logger.info("collection Id: ", collectionId);

    const royaltyProperty: IRoyaltyAttribute = {
      type: "royalty",
      value: {
        receiver: encodeAddress(params.account.address, params.settings.network.prefix),
        royaltyPercentFloat: 5
      }
    }

    const collectionMetadataCid = await pinSingleMetadataFromDir(
      "/assets/shelf/collections",
      "shelf.png",
      "Shelf",
      {
        description: "A collection of shelves on which Kusama referendum voters can showcase their collected items.",
        external_url: params.settings.externalUrl,
        properties: {
          royaltyInfo: {
            ...royaltyProperty
          }
        },
      }
    );

    const ShelfCollection = new Collection(
      0,
      0,
      encodeAddress(params.account.address, params.settings.network.prefix),
      params.settings.parentCollectionSymbol,
      collectionId,
      collectionMetadataCid
    );

    const api = params.settings.isTest ? await getApiTest() : await getApi() ;

    const { block } = await sendAndFinalize(
      api.tx.system.remark(ShelfCollection.create()),
      params.account
    );
    logger.info("COLLECTION CREATION REMARK: ", ShelfCollection.create());
    logger.info("Collection created at block: ", block);

    return block;
  } catch (error: any) {
    logger.error(error);
  }
};