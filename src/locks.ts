import type { AccountId, ReferendumInfoTo239, Vote } from '@polkadot/types/interfaces';
import type { PalletDemocracyReferendumInfo, PalletDemocracyVoteVoting } from '@polkadot/types/lookup';
import type { BN } from '@polkadot/util';

import { BN_ZERO, isUndefined } from '@polkadot/util';
import { DeriveDemocracyLock } from '@polkadot/api-derive/types';
import { ApiDecoration } from '@polkadot/api/types';

type ReferendumInfoFinished = PalletDemocracyReferendumInfo['asFinished'];
type VotingDelegating = PalletDemocracyVoteVoting['asDelegating'];
type VotingDirect = PalletDemocracyVoteVoting['asDirect'];
type VotingDirectVote = VotingDirect['votes'][0];

const LOCKUPS = [0, 1, 2, 4, 8, 16, 32];

function parseEnd(api: ApiDecoration<"promise">, vote: Vote, { approved, end }: ReferendumInfoFinished): [BN, BN] {
    return [
        end,
        (approved.isTrue && vote.isAye) || (approved.isFalse && vote.isNay)
            ? end.add(
                (
                    api.consts.democracy.voteLockingPeriod ||
                    api.consts.democracy.enactmentPeriod
                ).muln(LOCKUPS[vote.conviction.index])
            )
            : BN_ZERO
    ];
}

function parseLock(api: ApiDecoration<"promise">, [referendumId, accountVote]: VotingDirectVote, referendum: PalletDemocracyReferendumInfo): DeriveDemocracyLock {
    const { balance, vote } = accountVote.asStandard;
    const [referendumEnd, unlockAt] = referendum.isFinished
        ? parseEnd(api, vote, referendum.asFinished)
        : [BN_ZERO, BN_ZERO];

    return { balance, isDelegated: false, isFinished: referendum.isFinished, referendumEnd, referendumId, unlockAt, vote };
}

const delegateLocks = async (api: ApiDecoration<"promise">, { balance, conviction, target }: VotingDelegating): Promise<DeriveDemocracyLock[]> => {
    const targetLocks = await locks(api, target)
    return targetLocks.map(({ isFinished, referendumEnd, referendumId, unlockAt, vote }): DeriveDemocracyLock => ({
        balance,
        isDelegated: true,
        isFinished,
        referendumEnd,
        referendumId,
        unlockAt: unlockAt.isZero()
            ? unlockAt
            : referendumEnd.add(
                (
                    api.consts.democracy.voteLockingPeriod ||
                    api.consts.democracy.enactmentPeriod
                ).muln(LOCKUPS[conviction.index])
            ),
        vote: api.registry.createType('Vote', { aye: vote.isAye, conviction })
    }))
}

const directLocks = async (api: ApiDecoration<"promise">, { votes }: VotingDirect): Promise<DeriveDemocracyLock[]> => {
    if (!votes.length) {
        return [];
    }

    const referendums = await api.query.democracy.referendumInfoOf.multi(votes.map(([referendumId]) => referendumId))

    return votes
        .map((vote, index): [VotingDirectVote, PalletDemocracyReferendumInfo | ReferendumInfoTo239 | null] =>
            [vote, referendums[index].unwrapOr(null)]
        )
        .filter((item): item is [VotingDirectVote, PalletDemocracyReferendumInfo] =>
            !!item[1] && isUndefined((item[1] as ReferendumInfoTo239).end) && item[0][1].isStandard
        )
        .map(([directVote, referendum]) =>
            parseLock(api, directVote, referendum)
        )
}

export const locks = async (api: ApiDecoration<"promise">, accountId: string | AccountId) => {
    if (api.query.democracy.votingOf) {
        const voting = await api.query.democracy.votingOf(accountId)
        return voting.isDirect
            ? directLocks(api, voting.asDirect)
            : voting.isDelegating
                ? delegateLocks(api, voting.asDelegating)
                : []
    }
    return []
}