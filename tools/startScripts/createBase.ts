import { params } from "../../config.js"
import { Base, Collection } from "rmrk-tools"
import { IBasePart } from "rmrk-tools/dist/classes/base"
import { encodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";

export const createBase = () => {
    let baseParts: IBasePart[];
    for (let i = 1; i <= params.settings.parentHeight * params.settings.parentWidth; i++) {
        const collectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.tileCollectionSymbolPrefix +
            `(${Math.floor(i / params.settings.parentWidth)},${i % params.settings.parentWidth})`
        );
        const basePart: IBasePart = {
            id: "1",
            type: "slot",
            equippable: [collectionId],
            //unequip?: "unequip" | "burn";
            z: i
            //src?: string;
        }
        baseParts.push(basePart);
    }

    new Base(0,
        "canvas_blueprint",
        encodeAddress(params.account.address, params.settings.network.prefix),
        "png",
        baseParts)
}