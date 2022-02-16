import { params } from "../../config.js";
import { NFT, Collection } from "rmrk-tools";
import { u8aToHex } from "@polkadot/util";
import { encodeAddress } from "@polkadot/util-crypto";
import { pinSingleMetadataFromDir } from "../pinataUtils.js";
import { sendAndFinalize } from "../substrateUtils.js";

export const createTileCollections = async () => {
  for (let i = 1; i <= params.settings.parentHeight * params.settings.parentWidth; i++) {
    try {
      const collectionId = Collection.generateId(
        u8aToHex(params.account.publicKey),
        params.settings.tileCollectionSymbolPrefix +
        `(${Math.floor(i / params.settings.parentWidth)},${i % params.settings.parentWidth})`
      );
      console.log(`Collection Id Tile : ${i}`, collectionId);

      const collectionMetadataCid = await pinSingleMetadataFromDir(
        "/assets/collections",
        `Tile(${i % params.settings.parentWidth},${Math.floor(i / params.settings.parentWidth)}).png`,
        `Tile(${i % params.settings.parentWidth},${Math.floor(i / params.settings.parentWidth)})`,
        {
          description: `A collection of tiles for pixel with coordinates (${i % params.settings.parentWidth},${Math.floor(i / params.settings.parentWidth)})\n\n` +
            `The only way to get these tiles to participate in referendum voting!`,
          external_url: params.settings.externalUrl,
          properties: {},
        }
      );

      const ItemsCollection = new Collection(
        0,
        0,
        encodeAddress(params.account.address, params.settings.network.prefix),
        params.settings.tileCollectionSymbolPrefix +
        `(${i % params.settings.parentWidth},${Math.floor(i / params.settings.parentWidth)})`,
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
  }

};