import { params } from "../../config.js"
import { Base, Collection } from "rmrk-tools"
import { IBasePart } from "rmrk-tools/dist/classes/base"
import { encodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { sendAndFinalize } from "../../tools/substrateUtils.js";

export const createBase = async () => {
    try {
        let baseParts: IBasePart[] = [];
        const collectionId = Collection.generateId(
            u8aToHex(params.account.publicKey),
            params.settings.trophyCollectionSymbol
        );
        for (let i = params.settings.startReferendum; i <= params.settings.startReferendum + params.settings.trophyCount; i++) {            
            const basePart: IBasePart = {
                id: i.toString(),
                type: "slot",
                equippable: [collectionId],
                //unequip?: "unequip" | "burn";
                z: i
                //src?: string;
            }
            baseParts.push(basePart);
        }
        //console.log("baseParts", baseParts)

        const base = new Base(0,
            params.settings.baseSymbol,
            encodeAddress(params.account.address, params.settings.network.prefix),
            "png",
            baseParts)
        const { block } = await sendAndFinalize(
            params.api.tx.system.remark(base.base()),
            params.account
        );
        console.log("BASE CREATION REMARK: ", base.base());
        console.log("Base created at block: ", block);

    } catch (error: any) {
        console.error(error);
    }
}