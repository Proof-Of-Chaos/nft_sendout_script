import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { BN } from '@polkadot/util';

export interface VoteConviction extends ConvictionVote {
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

export type ConvictionVote = {
    // The particular governance track
    track: number;
    // The account that is voting
    address: string;
    // The index of the referendum
    referendumIndex: number;
    // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
    conviction: string;
    // The balance they are voting with themselves, sans delegated balance
    balance: {
        aye: number;
        nay: number;
        abstain: number;
    };
    // The total amount of tokens that were delegated to them (including conviction)
    delegatedConvictionBalance: number;
    // the total amount of tokens that were delegated to them (without conviction)
    delegatedBalance: number;
    // The vote type, either 'aye', or 'nay'
    voteDirection: string;
    // Either "Standard", "Split", or "SplitAbstain",
    voteDirectionType: string;
    // Whether the person is voting themselves or delegating
    voteType: string;
    // Who the person is delegating to
    delegatedTo: string;
};

export type ConvictionDelegation = {
    track: number;
    address: string;
    target: string;
    balance: number;
    // The balance times the conviction
    effectiveBalance: number;
    conviction: string;
    // The total amount of tokens that were delegated to them (including conviction)
    delegatedConvictionBalance: number;
    // the total amount of tokens that were delegated to them (without conviction)
    delegatedBalance: number;
    prior: any;
};

// The constant data of an OpenGov Track
export type TrackInfo = {
    trackIndex: string;
    name: string;
    maxDeciding: number;
    decisionDeposit: number;
    preparePeriod: number;
    decisionPeriod: number;
    confirmPeriod: number;
    minEnactmentPeriod: number;
};

export type OpenGovReferendum = {
    index: number;
    track: number;
    origin: string;
    proposalHash: string;
    enactmentAfter: number;
    submitted: number;
    submissionWho: string | null;
    // submissionIdentity: string | null;
    submissionAmount: number | null;
    decisionDepositWho: string | null;
    decisionDepositAmount: number | null;
    decidingSince: number | null;
    decidingConfirming: boolean | null;
    ayes: number;
    nays: number;
    support: number;
    inQueue: boolean;
    currentStatus: string;
    confirmationBlockNumber: number | null;
    //alarm
};


