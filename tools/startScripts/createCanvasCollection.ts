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
      params.settings.parentCollectionSymbol
    );
    console.log("collection Id: ", collectionId);

    const collectionMetadataCid = await pinSingleMetadataFromDir(
      "/assets",
      "GPR.png",
      "Canvas",
      {
        description: "Trade tiles to create your canvas. Tiles are distributed to all referendum voters.",
        external_url: params.settings.externalUrl,
        properties: {},
      }
    );

    const parentCollection = new Collection(
      0,
      0,
      encodeAddress(params.account.address, params.settings.network.prefix),
      params.settings.parentCollectionSymbol,
      collectionId,
      collectionMetadataCid
    );

    const { block } = await sendAndFinalize(
      params.api.tx.system.remark(parentCollection.create()),
      params.account
    );
    console.log("CANVAS COLLECTION CREATION REMARK: ", parentCollection.create());
    console.log("Collection created at block: ", block);

    return block;
  } catch (error: any) {
    console.error(error);
  }
};