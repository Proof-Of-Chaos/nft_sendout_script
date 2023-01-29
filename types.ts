import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { BN } from '@polkadot/util';

export interface VoteConviction extends DeriveReferendumVote {
    lockedWithConviction?: BN
}

export interface VoteConvictionDragon extends VoteConviction {
    dragonEquipped: string
}

export interface VoteConvictionRequirements extends VoteConvictionDragon {
    meetsRequirements: boolean
}

export type PalletReferenda = 'referenda' | 'rankedPolls' | 'fellowshipReferenda';

export type PalletVote = 'convictionVoting' | 'rankedCollective' | 'fellowshipCollective';

export interface Lock {
    classId: BN;
    endBlock: BN;
    locked: string;
    refId: BN;
    total: BN;
}