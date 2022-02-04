import { params } from "../config.js";
import { votesCurr } from "../utils.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import { pinSingleMetadataFromDir } from "../tools/pinataUtils.js";

const getVotes = async (referendumIndex: BN) => {
    const info = await params.api.query.democracy.referendumInfoOf(referendumIndex);
    let blockNumber;
    try {
        blockNumber = info.unwrap().asFinished.end.toNumber()
    }
    catch (e) {
        logger.error(`Referendum is still ongoing: ${e}`);
        return;
    }
    const blockHash = await params.api.rpc.chain.getBlockHash(blockNumber - 1);
    const blockApi = await params.api.at(blockHash);
    votesCurr(blockApi, referendumIndex)
}

export const sendNFTs = async (referendumIndex: BN) => {
    getVotes(referendumIndex);
    const collectionMetadataCid = await pinSingleMetadataFromDir(
        "/assets",
        "governanceParticipation.png",
        "KusamaGo - Gen1",
        {
            description: "KusamaGo - Generation One",
            external_url: params.settings.externalUrl,
            properties: {},
        }
    );
}

