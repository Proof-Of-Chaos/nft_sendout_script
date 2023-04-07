import { getApiEncointer, getApiKusama, getApiStatemine } from "../tools/substrateUtils.js";
import { BN } from '@polkadot/util';
import { logger } from "../tools/logger.js";
import {
    ConvictionDelegation,
    ConvictionVote,
    OpenGovReferendum,
    TrackInfo,
} from "../types";

// Returns the denomination of the chain. Used for formatting planck denomianted amounts
export const getDenom = async (): Promise<number> => {
    const api = await getApiKusama();
    const base = new BN(10);
    const denom = base.pow(new BN(api.registry.chainDecimals)).toNumber()
    return denom;
};

/**
 * Gets the identity root for an account.
 * @param account The account to check.
 * @returns The identity root string.
 */
const getIdentity = async (account: string): Promise<string | null> => {
    const api = await getApiKusama();
    if (!api.isConnected) {
        logger.warn(`{Chaindata::API::Warn} API is not connected, returning...`);
        return;
    }

    const identitiy = await api.query.identity.identityOf(account);
    if (!identitiy.isSome) {
        const superOf = await api.query.identity.superOf(account);
        if (superOf.isSome) {
            const id = await api.query.identity.identityOf(
                superOf.unwrap()[0]
            );
            if (id.isNone) {
                return null;
            }
            return id.unwrap().info.toString();
        }
    }
    if (identitiy.isSome) {
        return identitiy.unwrap().info.toString();
    }

    return null;
};

export const getApiAt = async (network: string, blockNumber: number): Promise<any> => {
    let api;
    switch (network) {
        case "kusama":
            api = await getApiKusama();
            break;
        case "encointer":
            api = await getApiEncointer();
            break;
        case "statemine":
            api = await getApiStatemine();
            break;
        default:
            break;
    }
    const hash = await getBlockHash(network, blockNumber);
    return await api.at(hash);
};

const getBlockHash = async (network: string, blockNumber: number): Promise<string> => {
    let api;
    switch (network) {
        case "kusama":
            api = await getApiKusama();
            break;
        case "encointer":
            api = await getApiEncointer();
            break;
        case "statemine":
            api = await getApiStatemine();
            break;
        default:
            break;
    }
    return (await api.rpc.chain.getBlockHash(blockNumber)).toString();
};

const getOpenGovReferendum = async (referendumIndex: number) => {
    const denom = await getDenom();
    const api = await getApiKusama();
    const referendum =
        await api.query.referenda.referendumInfoFor(referendumIndex); //.entries()

    const trackJSON = referendum.toJSON();
    if (trackJSON["ongoing"]) {
        const {
            track,
            enactment: { after },
            submitted,
            submissionDeposit: { who: submissionWho, amount: submissionAmount },
            decisionDeposit,
            deciding,
            tally: { ayes, nays, support },
            inQueue,
            alarm,
        } = trackJSON["ongoing"];
        const origin = trackJSON["ongoing"]?.origin?.origins
            ? trackJSON["ongoing"]?.origin?.origins
            : "root";
        const hash = trackJSON["ongoing"]?.proposal?.lookup
            ? trackJSON["ongoing"]?.proposal?.lookup?.hash
            : trackJSON["ongoing"]?.proposal?.inline;
        let decisionDepositWho, decisionDepositAmount, since, confirming;
        if (decisionDeposit) {
            const { who: decisionDepositWho, amount: decisionDepositAmount } =
                decisionDeposit;
        }
        if (deciding) {
            const { since, confirming } = deciding;
        }

        // const identity = await getIdentity(submissionWho.toString());

        const r: OpenGovReferendum = {
            index: referendumIndex,
            track: track,
            origin: origin,
            proposalHash: hash,
            enactmentAfter: after,
            submitted: submitted,
            submissionWho: submissionWho,
            //   submissionIdentity: identity?.name ? identity?.name : submissionWho,
            submissionAmount: submissionAmount / denom,
            decisionDepositWho: decisionDepositWho ? decisionDepositWho : null,
            decisionDepositAmount: decisionDepositAmount
                ? decisionDepositAmount / denom
                : null,
            decidingSince: since ? since : null,
            decidingConfirming: confirming ? confirming : null,
            ayes: ayes / denom,
            nays: nays / denom,
            support: support / denom,
            inQueue: inQueue,
            currentStatus: "Ongoing",
            confirmationBlockNumber: null,
        };
        return r;
    } else if (
        trackJSON["approved"] ||
        trackJSON["cancelled"] ||
        trackJSON["rejected"] ||
        trackJSON["timedOut"]
    ) {
        let status, confirmationBlockNumber;
        if (trackJSON["approved"]) {
            confirmationBlockNumber = trackJSON["approved"][0];
            status = "Approved";
        } else if (trackJSON["cancelled"]) {
            confirmationBlockNumber = trackJSON["cancelled"][0];
            status = "Cancelled";
        } else if (trackJSON["rejected"]) {
            confirmationBlockNumber = trackJSON["rejected"][0];
            status = "Rejected";
        } else if (trackJSON["timedOut"]) {
            confirmationBlockNumber = trackJSON["timedOut"][0];
            status = "TimedOut";
        }

        const apiAt = await getApiAt("kusama", confirmationBlockNumber - 1);
        // Get the info at the last block before it closed.
        const referendumInfo = await apiAt.query.referenda.referendumInfoFor(
            referendumIndex
        );
        const referendumJSON = referendumInfo.toJSON();

        const {
            track,
            enactment: { after },
            submitted,
            submissionDeposit: { who: submissionWho, amount: submissionAmount },
            decisionDeposit,
            deciding,
            tally: { ayes, nays, support },
            inQueue,
            alarm,
        } = referendumJSON["ongoing"];
        const origin = referendumJSON["ongoing"]?.origin?.origins
            ? referendumJSON["ongoing"]?.origin?.origins
            : "root";
        const hash = referendumJSON["ongoing"]?.proposal?.lookup
            ? referendumJSON["ongoing"]?.proposal?.lookup?.hash
            : referendumJSON["ongoing"]?.proposal?.inline;
        let decisionDepositWho, decisionDepositAmount, since, confirming;
        if (decisionDeposit) {
            const { who: decisionDepositWho, amount: decisionDepositAmount } =
                decisionDeposit;
        }
        if (deciding) {
            const { since, confirming } = deciding;
        }

        // const identity = await this.getIdentity(submissionWho);

        const r: OpenGovReferendum = {
            index: referendumIndex,
            track: track,
            origin: origin,
            proposalHash: hash,
            enactmentAfter: after,
            submitted: submitted,
            submissionWho: submissionWho,
            //   submissionIdentity: identity?.name ? identity?.name : submissionWho,
            submissionAmount: submissionAmount / denom,
            decisionDepositWho: decisionDepositWho ? decisionDepositWho : null,
            decisionDepositAmount: decisionDepositAmount
                ? decisionDepositAmount / denom
                : null,
            decidingSince: since ? since : null,
            decidingConfirming: confirming ? confirming : null,
            ayes: ayes / denom,
            nays: nays / denom,
            support: support / denom,
            inQueue: inQueue,
            currentStatus: status,
            confirmationBlockNumber: confirmationBlockNumber,
        };

        return r;
    }
};

const getTrackInfo = async () => {
    const api = await getApiKusama();
    const trackTypes = [];
    const tracks = await api.consts.referenda.tracks;

    for (const [trackIndex, trackInfo] of tracks) {
        const {
            name,
            maxDeciding,
            decisionDeposit,
            preparePeriod,
            decisionPeriod,
            confirmPeriod,
            minEnactmentPeriod,
            minApproval,
            minSupport,
        } = trackInfo;
        const t: TrackInfo = {
            trackIndex: trackIndex.toString(),
            name: name.toString(),
            maxDeciding: parseFloat(maxDeciding.toString()),
            decisionDeposit: parseFloat(decisionDeposit.toString()),
            preparePeriod: parseFloat(preparePeriod.toString()),
            decisionPeriod: parseFloat(decisionPeriod.toString()),
            confirmPeriod: parseFloat(confirmPeriod.toString()),
            minEnactmentPeriod: parseFloat(confirmPeriod.toString()),
            // minApproval,
            // minSupport
        };
        trackTypes.push(t);
    }
    return trackTypes;
};

const getOpenGovDelegations = async () => {
    const api = await getApiKusama();
    const denom = await getDenom();
    const allDelegations = [];
    const votingFor = await api.query.convictionVoting.votingFor.entries();
    for (const [key, entry] of votingFor) {
        // Each of these is the votingFor for an account for a given governance track
        // @ts-ignore
        const [address, track] = key.toHuman();

        // For each track, an account is either voting themselves, or delegating to another account

        // The account is voting themselves
        // @ts-ignore
        if (entry.isDelegating) {
            // The address is delegating to another address for this particular track

            const {
                balance,
                target,
                conviction,
                delegations: { votes: delegationVotes, capital: delegationCapital },
                prior,
                // @ts-ignore
            } = entry.asDelegating;

            let effectiveBalance = 0;
            switch (conviction.toString()) {
                case "None":
                    {
                        effectiveBalance = (balance / denom) * 0.1;
                    }
                    break;
                case "Locked1x":
                    {
                        effectiveBalance = balance / denom;
                    }
                    break;
                case "Locked2x":
                    {
                        effectiveBalance = (balance / denom) * 2;
                    }
                    break;
                case "Locked3x":
                    {
                        effectiveBalance = (balance / denom) * 3;
                    }
                    break;
                case "Locked4x":
                    {
                        effectiveBalance = (balance / denom) * 4;
                    }
                    break;
                case "Locked5x":
                    {
                        effectiveBalance = (balance / denom) * 5;
                    }
                    break;
                case "Locked6x":
                    {
                        effectiveBalance = (balance / denom) * 6;
                    }
                    break;
            }
            const delegation: ConvictionDelegation = {
                track: track,
                address: address.toString(),
                target: target.toString(),
                balance: balance.toString() / denom,
                effectiveBalance: effectiveBalance,
                conviction: conviction.toString(),
                // The total amount of tokens that were delegated to them (including conviction)
                delegatedConvictionBalance: delegationVotes.toString() / denom,
                // the total amount of tokens that were delegated to them (without conviction)
                delegatedBalance: delegationCapital.toString() / denom,
                prior: prior,
            };
            allDelegations.push(delegation);
        }
    }
    return allDelegations;
};

// OpenGov Conviction Voting
export const getConvictionVoting = async (referendumIndex: number) => {
    const api = await getApiKusama();
    const referendaVotes: ConvictionVote[] = [];
    // const ongoingVotes: ConvictionVote[] = [];
    // const allDelegations: ConvictionDelegation[] = [];

    const denom = await getDenom();
    // Create a map to more easily check the status of a referenda, is it ongoing or finished
    // const referendaMap = new Map();
    const referendum =
        await getOpenGovReferendum(referendumIndex);
    // for (const ref of ongoingReferenda) {
    //     referendaMap.set(ref.index, ref);
    // }
    // for (const ref of finishedReferenda) {
    //     referendaMap.set(ref.index, ref);
    // }
    const tracks = api.consts.referenda.tracks;

    // Query the keys and storage of all the entries of `votingFor`
    // These are all the accounts voting, for which tracks, for which referenda
    // And whether they are delegating or not.
    // const votingFor = await api.query.convictionVoting.votingFor.entries();
    // for (const [key, entry] of votingFor) {
    //     // Each of these is the votingFor for an account for a given governance track
    //     // @ts-ignore
    //     const [address, track] = key.toHuman();

    //     // For each track, an account is either voting themselves, or delegating to another account

    //     // The account is voting themselves
    //     // @ts-ignore
    //     if (entry.isCasting) {
    //         // For each given track, these are the invididual votes for that track,
    //         //     as well as the total delegation amounts for that particular track
    //         // @ts-ignore
    //         const { votes, delegations } = entry.asCasting;

    //         // The total delegation amounts.
    //         //     delegationVotes - the _total_ amount of tokens applied in voting. This takes the conviction into account
    //         //     delegationCapital - the base level of tokens delegated to this address
    //         const { votes: delegationVotes, capital: delegationCapital } =
    //             delegations;

    //         // The list of votes for that track
    //         for (const referendumVote of votes) {
    //             // The vote for each referendum - this is the referendum index,the conviction, the vote type (aye,nay), and the balance
    //             const [referendumIndex, voteType] = referendumVote;

    //             // const isReferendumFinished =
    //             //     referendaMap.get(parseInt(referendumIndex))?.currentStatus !=
    //             //     "Ongoing";
    //             // const isReferendumOngoing =
    //             //     referendaMap.get(parseInt(referendumIndex))?.currentStatus ==
    //             //     "Ongoing";
    //             let v: ConvictionVote;
    //             if (voteType.isStandard) {
    //                 const { vote: refVote, balance } = voteType.asStandard;
    //                 const { conviction, vote: voteDirection } = refVote.toHuman();

    //                 // The formatted vote
    //                 v = {
    //                     // The particular governance track
    //                     track: Number(track.toString()),
    //                     // The account that is voting
    //                     address: address.toString(),
    //                     // The index of the referendum
    //                     referendumIndex: Number(referendumIndex.toString()),
    //                     // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
    //                     conviction: conviction.toString(),
    //                     // The balance they are voting with themselves, sans delegated balance
    //                     balance: {
    //                         aye:
    //                             voteDirection.toString() == "Aye"
    //                                 ? Number(balance.toJSON()) / denom
    //                                 : 0,
    //                         nay:
    //                             voteDirection.toString() == "Nay"
    //                                 ? Number(balance.toJSON()) / denom
    //                                 : 0,
    //                         abstain: 0,
    //                     },
    //                     // The total amount of tokens that were delegated to them (including conviction)
    //                     delegatedConvictionBalance:
    //                         Number(delegationVotes.toString()) / denom,
    //                     // the total amount of tokens that were delegated to them (without conviction)
    //                     delegatedBalance: Number(delegationCapital.toString()) / denom,
    //                     // The vote type, either 'aye', or 'nay'
    //                     voteDirection: voteDirection.toString(),
    //                     // The vote direction type, either "Standard", "Split", or "SplitAbstain"
    //                     voteDirectionType: "Standard",
    //                     // Whether the person is voting themselves or delegating
    //                     voteType: "Casting",
    //                     // Who the person is delegating to
    //                     delegatedTo: null,
    //                 };
    //             } else if (voteType.isSplit) {
    //                 const { aye, nay } = voteType.asSplit;

    //                 // The formatted vote
    //                 v = {
    //                     // The particular governance track
    //                     track: Number(track.toString()),
    //                     // The account that is voting
    //                     address: address.toString(),
    //                     // The index of the referendum
    //                     referendumIndex: Number(referendumIndex.toString()),
    //                     // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
    //                     conviction: "Locked1x",
    //                     // The balance they are voting with themselves, sans delegated balance
    //                     balance: {
    //                         aye: Number(aye.toString()) / denom,
    //                         nay: Number(nay.toString()) / denom,
    //                         abstain: 0,
    //                     },
    //                     // The total amount of tokens that were delegated to them (including conviction)
    //                     delegatedConvictionBalance:
    //                         Number(delegationVotes.toString()) / denom,
    //                     // the total amount of tokens that were delegated to them (without conviction)
    //                     delegatedBalance: Number(delegationCapital.toString()) / denom,
    //                     // The vote type, either 'aye', or 'nay'
    //                     voteDirection: aye >= nay ? "Aye" : "Nay",
    //                     // The vote direction type, either "Standard", "Split", or "SplitAbstain"
    //                     voteDirectionType: "Split",
    //                     // Whether the person is voting themselves or delegating
    //                     voteType: "Casting",
    //                     // Who the person is delegating to
    //                     delegatedTo: null,
    //                 };
    //             } else {
    //                 const voteJSON = voteType.toJSON();

    //                 if (voteJSON["splitAbstain"]) {
    //                     const { aye, nay, abstain } = voteJSON["splitAbstain"];
    //                     // The formatted vote
    //                     v = {
    //                         // The particular governance track
    //                         track: Number(track.toString()),
    //                         // The account that is voting
    //                         address: address.toString(),
    //                         // The index of the referendum
    //                         referendumIndex: Number(referendumIndex.toString()),
    //                         // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
    //                         conviction: "Locked1x",
    //                         // The balance they are voting with themselves, sans delegated balance
    //                         balance: {
    //                             aye: Number(aye) / denom,
    //                             nay: Number(nay) / denom,
    //                             abstain: Number(abstain) / denom,
    //                         },
    //                         // The total amount of tokens that were delegated to them (including conviction)
    //                         delegatedConvictionBalance:
    //                             Number(delegationVotes.toString()) / denom,
    //                         // the total amount of tokens that were delegated to them (without conviction)
    //                         delegatedBalance: Number(delegationCapital.toString()) / denom,
    //                         // The vote type, either 'aye', or 'nay'
    //                         voteDirection:
    //                             abstain >= aye && abstain >= nay
    //                                 ? "Abstain"
    //                                 : aye > +nay
    //                                     ? "Aye"
    //                                     : "Nay",
    //                         // The vote direction type, either "Standard", "Split", or "SplitAbstain"
    //                         voteDirectionType: "SplitAbstain",
    //                         // Whether the person is voting themselves or delegating
    //                         voteType: "Casting",
    //                         // Who the person is delegating to
    //                         delegatedTo: null,
    //                     };
    //                 }
    //             }
    //             finishedVotes.push(v);
    //             // if (isReferendumOngoing) ongoingVotes.push(v);
    //         }
    //         // @ts-ignore
    //     } else if (entry.isDelegating) {
    //         // The address is delegating to another address for this particular track

    //         const {
    //             balance,
    //             target,
    //             conviction,
    //             delegations: { votes: delegationVotes, capital: delegationCapital },
    //             prior,
    //             // @ts-ignore
    //         } = entry.asDelegating;
    //         let effectiveBalance = 0;
    //         switch (conviction) {
    //             case "None":
    //                 {
    //                     effectiveBalance = (balance / denom) * 0.1;
    //                 }
    //                 break;
    //             case "Locked1x":
    //                 {
    //                     effectiveBalance = balance / denom;
    //                 }
    //                 break;
    //             case "Locked2x":
    //                 {
    //                     effectiveBalance = (balance / denom) * 2;
    //                 }
    //                 break;
    //             case "Locked3x":
    //                 {
    //                     effectiveBalance = (balance / denom) * 3;
    //                 }
    //                 break;
    //             case "Locked4x":
    //                 {
    //                     effectiveBalance = (balance / denom) * 4;
    //                 }
    //                 break;
    //             case "Locked5x":
    //                 {
    //                     effectiveBalance = (balance / denom) * 5;
    //                 }
    //                 break;
    //             case "Locked6x":
    //                 {
    //                     effectiveBalance = (balance / denom) * 6;
    //                 }
    //                 break;
    //         }
    //         const delegation: ConvictionDelegation = {
    //             track: track,
    //             address: address.toString(),
    //             target: target.toString(),
    //             balance: parseInt(balance.toString()) / denom,
    //             effectiveBalance: effectiveBalance,
    //             conviction: conviction.toString(),
    //             // The total amount of tokens that were delegated to them (including conviction)
    //             delegatedConvictionBalance: delegationVotes.toString() / denom,
    //             // the total amount of tokens that were delegated to them (without conviction)
    //             delegatedBalance: delegationCapital.toString() / denom,
    //             prior: prior,
    //         };
    //         allDelegations.push(delegation);
    //     }
    // }

    // // ONGOING REFERENDA DELEGATIONS
    // // Create a vote entry for everyone that is delegating for current ongoing referenda
    // for (const delegation of allDelegations) {
    //     // Find the vote of the person they are delegating to for a given track
    //     const v = ongoingVotes.filter((vote) => {
    //         return (
    //             vote.address == delegation.target && vote.track == delegation.track
    //         );
    //     });
    //     if (v.length > 0) {
    //         // There are votes for a given track that a person delegating will have votes for.
    //         for (const vote of v) {
    //             const voteDirectionType = vote.voteDirectionType;
    //             const voteDirection = vote.voteDirection;
    //             let balance;

    //             switch (voteDirectionType) {
    //                 case "Standard":
    //                     balance = {
    //                         aye:
    //                             voteDirection == "Aye"
    //                                 ? Number(delegation.balance)
    //                                 : Number(0),
    //                         nay:
    //                             voteDirection == "Nay"
    //                                 ? Number(delegation.balance)
    //                                 : Number(0),
    //                         abstain: Number(0),
    //                     };
    //                     break;
    //                 case "Split":
    //                     balance = {
    //                         aye:
    //                             Number(delegation.balance) *
    //                             (vote.balance.aye / (vote.balance.aye + vote.balance.nay)),
    //                         nay:
    //                             Number(delegation.balance) *
    //                             (vote.balance.nay / (vote.balance.aye + vote.balance.nay)),
    //                         abstain: Number(0),
    //                     };
    //                     break;
    //                 case "SplitAbstain":
    //                     const ayePercentage =
    //                         vote.balance.aye /
    //                         (vote.balance.aye + vote.balance.nay + vote.balance.abstain);
    //                     const nayPercentage =
    //                         vote.balance.nay /
    //                         (vote.balance.aye + vote.balance.nay + vote.balance.abstain);
    //                     const abstainPercentage =
    //                         vote.balance.abstain /
    //                         (vote.balance.aye + vote.balance.nay + vote.balance.abstain);
    //                     balance = {
    //                         aye: Number(delegation.balance) * ayePercentage,
    //                         nay: Number(delegation.balance) * nayPercentage,
    //                         abstain: Number(delegation.balance) * abstainPercentage,
    //                     };
    //                     break;
    //             }

    //             const delegatedVote: ConvictionVote = {
    //                 // The particular governance track
    //                 track: vote.track,
    //                 // The account that is voting
    //                 address: delegation.address,
    //                 // The index of the referendum
    //                 referendumIndex: vote.referendumIndex,
    //                 // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
    //                 conviction: delegation.conviction,
    //                 // The balance they are voting with themselves, sans delegated balance
    //                 balance: balance,
    //                 // The total amount of tokens that were delegated to them (including conviction)
    //                 delegatedConvictionBalance: delegation.delegatedConvictionBalance,
    //                 // the total amount of tokens that were delegated to them (without conviction)
    //                 delegatedBalance: delegation.delegatedBalance,
    //                 // The vote type, either 'aye', or 'nay'
    //                 voteDirection: vote.voteDirection,
    //                 // Whether the person is voting themselves or delegating
    //                 voteType: "Delegating",
    //                 voteDirectionType: voteDirectionType,
    //                 // Who the person is delegating to
    //                 delegatedTo: vote.address,
    //             };
    //             ongoingVotes.push(delegatedVote);
    //         }
    //     } else if (v.length == 0) {
    //         // There are no direct votes from the person the delegator is delegating to,
    //         // but that person may also be delegating, so search for nested delegations

    //         let found = false;
    //         // The end vote of the chain of delegations
    //         let delegatedVote;

    //         delegatedVote = delegation;
    //         while (!found) {
    //             // Find the delegation of the person who is delegating to
    //             const d = allDelegations.filter((del) => {
    //                 return (
    //                     del.address == delegatedVote.target &&
    //                     del.track == delegatedVote.track
    //                 );
    //             });

    //             if (d.length == 0) {
    //                 // There are no additional delegations, try to find if there are any votes

    //                 found = true;
    //                 const v = ongoingVotes.filter((vote) => {
    //                     return (
    //                         vote.address == delegatedVote.target &&
    //                         vote.track == delegatedVote.track
    //                     );
    //                 });
    //                 if (v.length > 0) {
    //                     // There are votes, ascribe them to the delegator
    //                     for (const vote of v) {
    //                         const voteDirectionType = vote.voteDirectionType;
    //                         const voteDirection = vote.voteDirection;
    //                         let balance;
    //                         switch (voteDirectionType) {
    //                             case "Standard":
    //                                 balance = {
    //                                     aye:
    //                                         voteDirection == "Aye"
    //                                             ? Number(delegation.balance)
    //                                             : Number(0),
    //                                     nay:
    //                                         voteDirection == "Nay"
    //                                             ? Number(delegation.balance)
    //                                             : Number(0),
    //                                     abstain: Number(0),
    //                                 };
    //                                 break;
    //                             case "Split":
    //                                 balance = {
    //                                     aye:
    //                                         Number(delegation.balance) *
    //                                         (vote.balance.aye /
    //                                             (vote.balance.aye + vote.balance.nay)),
    //                                     nay:
    //                                         Number(delegation.balance) *
    //                                         (vote.balance.nay /
    //                                             (vote.balance.aye + vote.balance.nay)),
    //                                     abstain: Number(0),
    //                                 };
    //                                 break;
    //                             case "SplitAbstain":
    //                                 const ayePercentage =
    //                                     vote.balance.aye /
    //                                     (vote.balance.aye +
    //                                         vote.balance.nay +
    //                                         vote.balance.abstain);
    //                                 const nayPercentage =
    //                                     vote.balance.nay /
    //                                     (vote.balance.aye +
    //                                         vote.balance.nay +
    //                                         vote.balance.abstain);
    //                                 const abstainPercentage =
    //                                     vote.balance.nay /
    //                                     (vote.balance.aye +
    //                                         vote.balance.nay +
    //                                         vote.balance.abstain);
    //                                 balance = {
    //                                     aye: Number(delegation.balance) * ayePercentage,
    //                                     nay: Number(delegation.balance) * nayPercentage,
    //                                     abstain: Number(delegation.balance) * abstainPercentage,
    //                                 };
    //                                 break;
    //                         }

    //                         const delegatedVote: ConvictionVote = {
    //                             // The particular governance track
    //                             track: vote.track,
    //                             // The account that is voting
    //                             address: delegation.address,
    //                             // The index of the referendum
    //                             referendumIndex: vote.referendumIndex,
    //                             // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
    //                             conviction: delegation.conviction,
    //                             // The balance they are voting with themselves, sans delegated balance
    //                             balance: balance,
    //                             // The total amount of tokens that were delegated to them (including conviction)
    //                             delegatedConvictionBalance:
    //                                 delegation.delegatedConvictionBalance,
    //                             // the total amount of tokens that were delegated to them (without conviction)
    //                             delegatedBalance: delegation.delegatedBalance,
    //                             // The vote type, either 'aye', or 'nay'
    //                             voteDirection: vote.voteDirection,
    //                             // Whether the person is voting themselves or delegating
    //                             voteType: "Delegating",
    //                             voteDirectionType: voteDirectionType,
    //                             // Who the person is delegating to
    //                             delegatedTo: vote.address,
    //                         };
    //                         ongoingVotes.push(delegatedVote);
    //                     }
    //                 } else {
    //                     // The person they are delegating to does not have any votes.
    //                 }
    //             } else if (d.length == 1) {
    //                 // There is a delegated delegation
    //                 delegatedVote = d[0];
    //             }
    //         }
    //     }
    // }

    // FINISHED REFERENDA
    // Query the delegations for finished referenda at previous block heights
    // for (const [finishedRefIndex, referendum] of finishedReferenda.entries()) {
    const apiAt = await getApiAt("kusama", referendum.confirmationBlockNumber - 1);

    const votingForAtEnd = await apiAt.query.convictionVoting.votingFor.entries();

    const totalIssuance = (await apiAt.query.balances.totalIssuance()).toString();

    const delegationsAt = [];
    const nestedDelegations = [];
    const refVotes = [];

    // Make a list of the delegations there were at this previous block height
    for (const [key, entry] of votingForAtEnd) {
        // Each of these is the votingForAtEnd for an account for a given governance track
        // @ts-ignore
        const [address, track] = key.toHuman();
        if (entry.isCasting) {
            // For each given track, these are the invididual votes for that track,
            //     as well as the total delegation amounts for that particular track
            // @ts-ignore
            const { votes, delegations } = entry.asCasting;

            // The total delegation amounts.
            //     delegationVotes - the _total_ amount of tokens applied in voting. This takes the conviction into account
            //     delegationCapital - the base level of tokens delegated to this address
            const { votes: delegationVotes, capital: delegationCapital } =
                delegations;

            // push the given referendum votes to refVotes
            for (const referendumVote of votes) {
                // The vote for each referendum - this is the referendum index,the conviction, the vote type (aye,nay), and the balance
                const [referendumIndex, voteType] = referendumVote;
                if (referendumIndex == referendum.index) {
                    let v: ConvictionVote;
                    if (voteType.isStandard) {
                        const { vote: refVote, balance } = voteType.asStandard;
                        const { conviction, vote: voteDirection } = refVote.toHuman();

                        // The formatted vote
                        v = {
                            // The particular governance track
                            track: Number(track.toString()),
                            // The account that is voting
                            address: address.toString(),
                            // The index of the referendum
                            referendumIndex: Number(referendumIndex.toString()),
                            // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
                            conviction: conviction.toString(),
                            // The balance they are voting with themselves, sans delegated balance
                            balance: {
                                aye:
                                    voteDirection.toString() == "Aye"
                                        ? Number(balance.toJSON()) / denom
                                        : 0,
                                nay:
                                    voteDirection.toString() == "Nay"
                                        ? Number(balance.toJSON()) / denom
                                        : 0,
                                abstain: 0,
                            },
                            // The total amount of tokens that were delegated to them (including conviction)
                            delegatedConvictionBalance:
                                Number(delegationVotes.toString()) / denom,
                            // the total amount of tokens that were delegated to them (without conviction)
                            delegatedBalance:
                                Number(delegationCapital.toString()) / denom,
                            // The vote type, either 'aye', or 'nay'
                            voteDirection: voteDirection.toString(),
                            // The vote direction type, either "Standard", "Split", or "SplitAbstain"
                            voteDirectionType: "Standard",
                            // Whether the person is voting themselves or delegating
                            voteType: "Casting",
                            // Who the person is delegating to
                            delegatedTo: null,
                        };
                    } else if (voteType.isSplit) {
                        const { aye, nay } = voteType.asSplit;

                        // The formatted vote
                        v = {
                            // The particular governance track
                            track: Number(track.toString()),
                            // The account that is voting
                            address: address.toString(),
                            // The index of the referendum
                            referendumIndex: Number(referendumIndex.toString()),
                            // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
                            conviction: "Locked1x",
                            // The balance they are voting with themselves, sans delegated balance
                            balance: {
                                aye: Number(aye) / denom,
                                nay: Number(nay) / denom,
                                abstain: 0,
                            },
                            // The total amount of tokens that were delegated to them (including conviction)
                            delegatedConvictionBalance:
                                Number(delegationVotes.toString()) / denom,
                            // the total amount of tokens that were delegated to them (without conviction)
                            delegatedBalance:
                                Number(delegationCapital.toString()) / denom,
                            // The vote type, either 'aye', or 'nay'
                            voteDirection: aye >= nay ? "Aye" : "Nay",
                            // The vote direction type, either "Standard", "Split", or "SplitAbstain"
                            voteDirectionType: "Split",
                            // Whether the person is voting themselves or delegating
                            voteType: "Casting",
                            // Who the person is delegating to
                            delegatedTo: null,
                        };
                    } else {
                        const voteJSON = voteType.toJSON();

                        if (voteJSON["splitAbstain"]) {
                            const { aye, nay, abstain } = voteJSON["splitAbstain"];
                            // The formatted vote
                            v = {
                                // The particular governance track
                                track: Number(track.toString()),
                                // The account that is voting
                                address: address.toString(),
                                // The index of the referendum
                                referendumIndex: Number(referendumIndex.toString()),
                                // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
                                conviction: "Locked1x",
                                // The balance they are voting with themselves, sans delegated balance
                                balance: {
                                    aye: Number(aye) / denom,
                                    nay: Number(nay) / denom,
                                    abstain: Number(abstain) / denom,
                                },
                                // The total amount of tokens that were delegated to them (including conviction)
                                delegatedConvictionBalance:
                                    Number(delegationVotes.toString()) / denom,
                                // the total amount of tokens that were delegated to them (without conviction)
                                delegatedBalance:
                                    Number(delegationCapital.toString()) / denom,
                                // The vote type, either 'aye', or 'nay'
                                voteDirection:
                                    abstain >= aye && abstain >= nay
                                        ? "Abstain"
                                        : aye >= nay
                                            ? "Aye"
                                            : "Nay",
                                // The vote direction type, either "Standard", "Split", or "SplitAbstain"
                                voteDirectionType: "SplitAbstain",
                                // Whether the person is voting themselves or delegating
                                voteType: "Casting",
                                // Who the person is delegating to
                                delegatedTo: null,
                            };
                        }
                    }
                    referendaVotes.push(v);
                    refVotes.push(v);
                }
            }
        }
    }

    // Make a list of the delegations there were at this previous block height
    for (const [key, entry] of votingForAtEnd) {
        // Each of these is the votingForAtEnd for an account for a given governance track
        // @ts-ignore
        const [address, track] = key.toHuman();
        // @ts-ignore
        if (entry.isDelegating) {
            // The address is delegating to another address for this particular track
            const {
                balance,
                target,
                conviction,
                delegations: { votes: delegationVotes, capital: delegationCapital },
                prior,
                // @ts-ignore
            } = entry.asDelegating;
            let effectiveBalance = 0;
            switch (conviction) {
                case "None":
                    {
                        effectiveBalance = (balance / denom) * 0.1;
                    }
                    break;
                case "Locked1x":
                    {
                        effectiveBalance = balance / denom;
                    }
                    break;
                case "Locked2x":
                    {
                        effectiveBalance = (balance / denom) * 2;
                    }
                    break;
                case "Locked3x":
                    {
                        effectiveBalance = (balance / denom) * 3;
                    }
                    break;
                case "Locked4x":
                    {
                        effectiveBalance = (balance / denom) * 4;
                    }
                    break;
                case "Locked5x":
                    {
                        effectiveBalance = (balance / denom) * 5;
                    }
                    break;
                case "Locked6x":
                    {
                        effectiveBalance = (balance / denom) * 6;
                    }
                    break;
            }
            const delegation: ConvictionDelegation = {
                track: track,
                address: address.toString(),
                target: target.toString(),
                balance: balance.toString() / denom,
                effectiveBalance: effectiveBalance,
                conviction: conviction.toString(),
                // The total amount of tokens that were delegated to them (including conviction)
                delegatedConvictionBalance: delegationVotes.toString() / denom,
                // the total amount of tokens that were delegated to them (without conviction)
                delegatedBalance: delegationCapital.toString() / denom,
                prior: prior,
            };
            delegationsAt.push(delegation);
        }
    }

    // Go through the list of delegations and try to find any corresponding direct votes
    for (const delegation of delegationsAt) {
        // Try and find the delegated vote from the existing votes
        const v = refVotes.filter((vote) => {
            return (
                vote.referendumIndex == referendum.index &&
                vote.address == delegation.target &&
                vote.track == delegation.track
            );
        });
        if (v.length > 0) {
            // There are votes for a given track that a person delegating will have votes for.
            for (const vote of v) {
                const voteDirectionType = vote.voteDirectionType;
                const voteDirection = vote.voteDirection;
                let balance;
                switch (voteDirectionType) {
                    case "Standard":
                        balance = {
                            aye:
                                voteDirection == "Aye"
                                    ? Number(delegation.balance)
                                    : Number(0),
                            nay:
                                voteDirection == "Nay"
                                    ? Number(delegation.balance)
                                    : Number(0),
                            abstain: Number(0),
                        };
                        break;
                    case "Split":
                        balance = {
                            aye:
                                Number(delegation.balance) *
                                (vote.balance.aye / (vote.balance.aye + vote.balance.nay)),
                            nay:
                                Number(delegation.balance) *
                                (vote.balance.nay / (vote.balance.aye + vote.balance.nay)),
                            abstain: Number(0),
                        };
                        break;
                    case "SplitAbstain":
                        const ayePercentage =
                            vote.balance.aye /
                            (vote.balance.aye + vote.balance.nay + vote.balance.abstain);
                        const nayPercentage =
                            vote.balance.nay /
                            (vote.balance.aye + vote.balance.nay + vote.balance.abstain);
                        const abstainPercentage =
                            vote.balance.nay /
                            (vote.balance.aye + vote.balance.nay + vote.balance.abstain);
                        balance = {
                            aye: Number(delegation.balance) * ayePercentage,
                            nay: Number(delegation.balance) * nayPercentage,
                            abstain: Number(delegation.balance) * abstainPercentage,
                        };
                        break;
                }

                const delegatedVote: ConvictionVote = {
                    // The particular governance track
                    track: vote.track,
                    // The account that is voting
                    address: delegation.address,
                    // The index of the referendum
                    referendumIndex: vote.referendumIndex,
                    // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
                    conviction: delegation.conviction,
                    // The balance they are voting with themselves, sans delegated balance
                    balance: balance,
                    // The total amount of tokens that were delegated to them (including conviction)
                    delegatedConvictionBalance: delegation.delegatedConvictionBalance,
                    // the total amount of tokens that were delegated to them (without conviction)
                    delegatedBalance: delegation.delegatedBalance,
                    // The vote type, either 'aye', or 'nay'
                    voteDirection: vote.voteDirection,
                    // Whether the person is voting themselves or delegating
                    voteType: "Delegating",
                    voteDirectionType: voteDirectionType,
                    // Who the person is delegating to
                    delegatedTo: vote.address,
                };
                referendaVotes.push(delegatedVote);
            }
        } else {
            // There are no direct delegations, though there may be a nested delegation
            nestedDelegations.push(delegation);
        }
    }

    // Go through the list of nested delegations and try to resolve any votes
    for (const delegation of nestedDelegations) {
        // Try and find the delegated vote from the existing votes
        const v = refVotes.filter((vote) => {
            return (
                vote.referendumIndex == referendum.index &&
                vote.address == delegation.target &&
                vote.track == delegation.track
            );
        });
        if (v.length == 0) {
            // There are no direct votes from the person the delegator is delegating to,
            // but that person may also be delegating, so search for nested delegations

            let found = false;
            // The end vote of the chain of delegations
            let delegatedVote;

            delegatedVote = delegation;
            while (!found) {
                // Find the delegation of the person who is delegating to
                const d = delegationsAt.filter((del) => {
                    return (
                        del.address == delegatedVote.target &&
                        del.track == delegatedVote.track
                    );
                });

                if (d.length == 0) {
                    // There are no additional delegations, try to find if there are any votes

                    found = true;
                    const v = refVotes.filter((vote) => {
                        return (
                            vote.referendumIndex == referendum.index &&
                            vote.address == delegatedVote.target &&
                            vote.track == delegatedVote.track
                        );
                    });
                    if (v.length > 0) {
                        // There are votes, ascribe them to the delegator
                        for (const vote of v) {
                            const voteDirectionType = vote.voteDirectionType;
                            const voteDirection = vote.voteDirection;
                            let balance;
                            switch (voteDirectionType) {
                                case "Standard":
                                    balance = {
                                        aye:
                                            voteDirection == "Aye"
                                                ? Number(delegation.balance)
                                                : Number(0),
                                        nay:
                                            voteDirection == "Nay"
                                                ? Number(delegation.balance)
                                                : Number(0),
                                        abstain: Number(0),
                                    };
                                    break;
                                case "Split":
                                    balance = {
                                        aye:
                                            Number(delegation.balance) *
                                            (vote.balance.aye /
                                                (vote.balance.aye + vote.balance.nay)),
                                        nay:
                                            Number(delegation.balance) *
                                            (vote.balance.nay /
                                                (vote.balance.aye + vote.balance.nay)),
                                        abstain: Number(0),
                                    };
                                    break;
                                case "SplitAbstain":
                                    const ayePercentage =
                                        vote.balance.aye /
                                        (vote.balance.aye +
                                            vote.balance.nay +
                                            vote.balance.abstain);
                                    const nayPercentage =
                                        vote.balance.nay /
                                        (vote.balance.aye +
                                            vote.balance.nay +
                                            vote.balance.abstain);
                                    const abstainPercentage =
                                        vote.balance.nay /
                                        (vote.balance.aye +
                                            vote.balance.nay +
                                            vote.balance.abstain);
                                    balance = {
                                        aye: Number(delegation.balance) * ayePercentage,
                                        nay: Number(delegation.balance) * nayPercentage,
                                        abstain: Number(delegation.balance) * abstainPercentage,
                                    };
                                    break;
                            }

                            const delegatedVote: ConvictionVote = {
                                // The particular governance track
                                track: vote.track,
                                // The account that is voting
                                address: delegation.address,
                                // The index of the referendum
                                referendumIndex: vote.referendumIndex,
                                // The conviction being voted with, ie `None`, `Locked1x`, `Locked5x`, etc
                                conviction: delegation.conviction,
                                // The balance they are voting with themselves, sans delegated balance
                                balance: balance,
                                // The total amount of tokens that were delegated to them (including conviction)
                                delegatedConvictionBalance:
                                    delegation.delegatedConvictionBalance,
                                // the total amount of tokens that were delegated to them (without conviction)
                                delegatedBalance: delegation.delegatedBalance,
                                // The vote type, either 'aye', or 'nay'
                                voteDirection: vote.voteDirection,
                                // Whether the person is voting themselves or delegating
                                voteType: "Delegating",
                                voteDirectionType: voteDirectionType,
                                // Who the person is delegating to
                                delegatedTo: vote.address,
                            };
                            referendaVotes.push(delegatedVote);
                        }
                    } else {
                        // The person they are delegating to does not have any votes.
                    }
                } else if (d.length == 1) {
                    // There is a delegated delegation
                    delegatedVote = d[0];
                }
            }
        }
    }
    // }

    const convictionVoting = {
        referendum,
        totalIssuance,
        votes: referendaVotes
    };
    return convictionVoting;
};
