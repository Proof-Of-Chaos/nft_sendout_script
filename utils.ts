import { ApiPromise, WsProvider } from "@polkadot/api";
import { DeriveReferendumVote } from "@polkadot/api-derive/types";
import { ApiDecoration } from "@polkadot/api/types";
import { AccountId, VotingDelegating, VotingDirectVote } from "@polkadot/types/interfaces";
import { PalletDemocracyVoteVoting } from "@polkadot/types/lookup";
import type { BN } from '@polkadot/util';

export const getApi = async (): Promise<ApiPromise> => {
    const wsNodeUri = process.env.WS_NODE_URI || "ws://127.0.0.1:9944/";
    const wsProvider = new WsProvider(wsNodeUri);
    const api = await ApiPromise.create({ provider: wsProvider });
    return api;
};

const extractVotes = (mapped: [AccountId, PalletDemocracyVoteVoting][], referendumId: BN) => {
    return mapped
        .filter(([, voting]) => voting.isDirect)
        .map(([accountId, voting]): [AccountId, VotingDirectVote[]] => [
            accountId,
            voting.asDirect.votes.filter(([idx]) => idx.eq(referendumId))
        ])
        .filter(([, directVotes]) => !!directVotes.length)
        .reduce((result: DeriveReferendumVote[], [accountId, votes]) =>
            // FIXME We are ignoring split votes
            votes.reduce((result: DeriveReferendumVote[], [, vote]): DeriveReferendumVote[] => {
                if (vote.isStandard) {
                    result.push({
                        accountId,
                        isDelegating: false,
                        ...vote.asStandard
                    });
                }

                return result;
            }, result), []
        );
}

export const votesCurr = async (api: ApiDecoration<"promise">, referendumId: BN) => {
    const allVoting = await api.query.democracy.votingOf.entries()
    const mapped = allVoting.map(([{ args: [accountId] }, voting]): [AccountId, PalletDemocracyVoteVoting] => [accountId, voting]);
    const votes: DeriveReferendumVote[] = extractVotes(mapped, referendumId);
    const delegations = mapped
        .filter(([, voting]) => {
            voting.isDelegating
        })
        .map(([accountId, voting]): [AccountId, VotingDelegating] => [accountId, voting.asDelegating]);

    // add delegations
    delegations.forEach(([accountId, { balance, conviction, target }]): void => {
        // Are we delegating to a delegator
        const toDelegator = delegations.find(([accountId]) => accountId.eq(target));
        const to = votes.find(({ accountId }) => accountId.eq(toDelegator ? toDelegator[0] : target));

        // this delegation has a target
        if (to) {
            votes.push({
                accountId,
                balance,
                isDelegating: true,
                vote: api.registry.createType('Vote', { aye: to.vote.isAye, conviction })
            });
        }
    });
    return votes;
}