import type { ApiPromise } from '@polkadot/api';
import type { Option } from '@polkadot/types';
import type { PalletConvictionVotingVoteCasting, PalletConvictionVotingVoteVoting, PalletReferendaReferendumInfoConvictionVotingTally } from '@polkadot/types/lookup';
import { BN } from '@polkadot/util';
import type { Lock, PalletReferenda, PalletVote } from '../types.js';

// import { BN_MAX_INTEGER } from '@polkadot/util';
import { ApiDecoration } from "@polkadot/api/types";

function getVoteParams(accountId: string, lockClasses?: BN[]): [[accountId: string, classId: BN][]] | undefined {
    if (lockClasses) {
        return [lockClasses.map((classId) => [accountId, classId])];
    }

    return undefined;
}

function getRefParams(votes?: [classId: BN, refIds: BN[], casting: PalletConvictionVotingVoteCasting][]): [BN[]] | undefined {
    if (votes && votes.length) {
        const refIds = votes.reduce<BN[]>((all, [, refIds]) => all.concat(refIds), []);
        if (refIds.length) {
            return [refIds];
        }
    }

    return undefined;
}

function getLocks(api: ApiDecoration<"promise">, palletVote: PalletVote, votes: [classId: BN, refIds: BN[], casting: PalletConvictionVotingVoteCasting][], referenda: [BN, PalletReferendaReferendumInfoConvictionVotingTally][]): Lock[] {
    const lockPeriod = api.consts[palletVote].voteLockingPeriod as BN;
    const locks: Lock[] = [];

    for (let i = 0; i < votes.length; i++) {
        const [classId, , casting] = votes[i];

        for (let i = 0; i < casting.votes.length; i++) {
            const [refId, accountVote] = casting.votes[i];
            const refInfo = referenda.find(([id]) => id.eq(refId));

            if (refInfo) {
                const [, tally] = refInfo;
                let total: BN | undefined;
                let endBlock: BN | undefined;
                let conviction = 0;
                let locked = 'None';

                if (accountVote.isStandard) {
                    const { balance, vote } = accountVote.asStandard;

                    total = balance;

                    if ((tally.isApproved && vote.isAye) || (tally.isRejected && vote.isNay)) {
                        conviction = vote.conviction.index;
                        locked = vote.conviction.type;
                    }
                } else if (accountVote.isSplit) {
                    const { aye, nay } = accountVote.asSplit;

                    total = aye.add(nay);
                } else if (accountVote.isSplitAbstain) {
                    const { abstain, aye, nay } = accountVote.asSplitAbstain;

                    total = aye.add(nay).add(abstain);
                } else {
                    console.error(`Unable to handle ${accountVote.type}`);
                }

                if (tally.isOngoing) {
                    endBlock = new BN(0); //BN_MAX_INTEGER
                } else if (tally.isKilled) {
                    endBlock = tally.asKilled;
                } else if (tally.isCancelled || tally.isTimedOut) {
                    endBlock = tally.isCancelled
                        ? tally.asCancelled[0]
                        : tally.asTimedOut[0];
                } else if (tally.isApproved || tally.isRejected) {
                    endBlock = lockPeriod
                        .muln(conviction)
                        .add(
                            tally.isApproved
                                ? tally.asApproved[0]
                                : tally.asRejected[0]
                        );
                } else {
                    console.error(`Unable to handle ${tally.type}`);
                }

                if (total && endBlock) {
                    locks.push({ classId, endBlock, locked, refId, total });
                }
            }
        }
    }

    return locks;
}

export async function useAccountLocksImpl(api: ApiDecoration<"promise">, palletReferenda: PalletReferenda, palletVote: PalletVote, accountId: string): Promise<Lock[]> {
    const locks: [BN, BN][] = await api.query.convictionVoting?.classLocksFor(accountId)
    const lockClassesFormatted: BN[] = locks.map(([classId]) => classId)
    const voteParams: [[string, BN][]] = getVoteParams(accountId, lockClassesFormatted)
    let [params]: [[string, BN][]] = voteParams
    const votes: PalletConvictionVotingVoteVoting[] = await api.query.convictionVoting?.votingFor.multi(params)
    const votesFormatted: [classId: BN, refIds: BN[], casting: PalletConvictionVotingVoteCasting][] = votes
        .map((v, index): null | [BN, BN[], PalletConvictionVotingVoteCasting] => {
            if (!v.isCasting) {
                //then is delegating
                return null;
            }

            const casting = v.asCasting;

            return [
                params[index][1],
                casting.votes.map(([refId]) => refId),
                casting
            ];
        })
        .filter((v): v is [BN, BN[], PalletConvictionVotingVoteCasting] => !!v)

    if (votesFormatted.length == 0) {
        return []
    }
    const refParams: [BN[]] = getRefParams(votesFormatted)
    if (!refParams) {
        return []
    }
    
    const [paramsref]: [BN[]] = refParams
    
    const optTally: Option<PalletReferendaReferendumInfoConvictionVotingTally>[] = await api.query.referenda?.referendumInfoFor.multi(paramsref)

    const referendaFormatted: [BN, PalletReferendaReferendumInfoConvictionVotingTally][] = optTally
        .map((v, index): null | [BN, PalletReferendaReferendumInfoConvictionVotingTally] =>
            v.isSome
                ? [paramsref[index], v.unwrap()]
                : null
        )
        .filter((v): v is [BN, PalletReferendaReferendumInfoConvictionVotingTally] => !!v)
    
    // combine the referenda outcomes and the votes into locks
    return getLocks(api, palletVote, votesFormatted, referendaFormatted)
 
}

