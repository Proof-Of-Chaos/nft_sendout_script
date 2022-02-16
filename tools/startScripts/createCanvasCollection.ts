import { params } from "../../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { sendAndFinalize } from "../substrateUtils.js";

export const createCanvasCollection = async () => {
  try {
    const collectionId = Collection.generateId(
      u8aToHex(params.account.publicKey),
      params.settings.collectionSymbol
    );
    console.log("collection Id: ", collectionId);

    const collectionMetadataCid = await pinSingleMetadataFromDir(
      "/assets",
      "GPR.png",
      "Mosaic",
      {
        description: "Trade tiles to create your canvas. Tiles are distributed to all referendum voters.",
        external_url: params.settings.externalUrl,
        properties: {},
      }
    );

    const ItemsCollection = new Collection(
      0,
      0,
      encodeAddress(params.account.address, params.settings.network.prefix),
      params.settings.collectionSymbol,
      collectionId,
      collectionMetadataCid
    );

    const { block } = await sendAndFinalize(
      params.api.tx.system.remark(ItemsCollection.create()),
      params.account
    );
    console.log("COLLECTION CREATION REMARK: ", ItemsCollection.create());
    console.log("Collection created at block: ", block);

    return block;
  } catch (error: any) {
    console.error(error);
  }
};