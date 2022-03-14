import { params } from "../../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { sendAndFinalize } from "../substrateUtils.js";
import { IRoyaltyAttribute } from "rmrk-tools/dist/tools/types";

export const createShelfCollection = async () => {
  try {
    const collectionId = Collection.generateId(
      u8aToHex(params.account.publicKey),
      params.settings.collectionSymbol
    );
    console.log("collection Id: ", collectionId);

    const royaltyProperty: IRoyaltyAttribute = {
      type: "royalty",
      value: {
        receiver: encodeAddress(params.account.address, params.settings.network.prefix),
        royaltyPercentFloat: 5
      }
    }

    const collectionMetadataCid = await pinSingleMetadataFromDir(
      "/assets",
      "GPR.png",
      "GovernanceParticipationRewards",
      {
        description: "A project that rewards all referendum voters with NFTs.",
        properties: {
          royalty: {
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

    const { block } = await sendAndFinalize(
      params.api.tx.system.remark(ShelfCollection.create()),
      params.account
    );
    console.log("COLLECTION CREATION REMARK: ", ShelfCollection.create());
    console.log("Collection created at block: ", block);

    return block;
  } catch (error: any) {
    console.error(error);
  }
};