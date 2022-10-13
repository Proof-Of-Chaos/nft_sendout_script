import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { IProperties } from "rmrk-tools/dist/tools/types";
import { BN } from '@polkadot/util';

export interface INftProps {
    block: number;
    collection: string;
    symbol: string;
    transferable: number;
    sn: string;
    metadata?: string;
    owner?: string;
    rootowner?: string;
    properties?: IProperties;
}

export interface VoteConviction extends DeriveReferendumVote {
    convictionBalance?: string
}

export interface VoteConvictionDragon extends VoteConviction {
    dragonEquipped: string
}

export interface VoteConvictionRequirements extends VoteConvictionDragon {
    meetsRequirements: boolean
}