import { params } from "../../config.js"
import { Base, Collection } from "rmrk-tools"
import { IBasePart } from "rmrk-tools/dist/classes/base"
import { encodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { sendAndFinalize } from "../../tools/substrateUtils.js";
import { pinSingleFileFromDir } from "../../tools/pinataUtils.js";
import { logger } from "../logger.js";

export const createBase = async () => {
    try {
        let baseParts: IBasePart[] = [];
        const backgroundCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.backgroundCollectionSymbol
        );
        const foregroundCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.foregroundCollectionSymbol
        );
        const itemCollectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.itemCollectionSymbol
        );

        const backgroundPart: IBasePart = {
            id: "background",
            type: "slot",
            equippable: [backgroundCollectionId],
            z: 0
        }
        baseParts.push(backgroundPart);

        let shelfCid = await pinSingleFileFromDir("/assets/shelf",
            "shelf.png",
            `Your Shelf`)

        const shelfPart: IBasePart = {
            id: "shelf",
            type: "fixed",
            z: 1,
            src: `ipfs://ipfs/${shelfCid}`
        }
        baseParts.push(shelfPart);
        let i;
        for (i = params.settings.startReferendum; i <= params.settings.startReferendum + params.settings.itemCount; i++) {
            const basePart: IBasePart = {
                id: `REFERENDUM_${i.toString()}`,
                type: "slot",
                equippable: [itemCollectionId],
                z: i
            }
            baseParts.push(basePart);
        }

        const foregroundPart: IBasePart = {
            id: "foreground",
            type: "slot",
            equippable: [foregroundCollectionId],
            z: i
        }

        baseParts.push(foregroundPart);

        logger.info("baseParts", baseParts)

        const base = new Base(0,
            params.settings.baseSymbol,
            encodeAddress(params.account.address, params.settings.network.prefix),
            "png",
            baseParts)

        const { block } = await sendAndFinalize(
            params.api.tx.system.remark(base.base()),
            params.account
        );
        logger.info("BASE CREATION REMARK: ", base.base());
        logger.info("Base created at block: ", block);

    } catch (error: any) {
        console.error(error);
    }
}