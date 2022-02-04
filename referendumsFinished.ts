import { Observable } from 'rxjs';
import type { PalletDemocracyReferendumInfo } from '@polkadot/types/lookup';
import type { DeriveApi, DeriveReferendumExt, DeriveReferendum } from '@polkadot/api-derive/types';
import { BN } from '@polkadot/util';
import { map, switchMap, of } from 'rxjs';

import { memo } from '@polkadot/rpc-core';

//type ReferendumInfoFinished = PalletDemocracyReferendumInfo['asFinished'];

export function referendumsFinished(instanceId: string, api: DeriveApi): () => Observable<DeriveReferendum[]> {
    const referendums: Observable<BN[]> = new Observable(subscriber => {
        of([new BN(168), new BN(169), new BN(170)]) 
    });
    return memo(instanceId, (): Observable<DeriveReferendum[]> =>
        referendums.pipe(
            switchMap((ids): Observable<DeriveReferendum[]> =>
                ids.length
                    ? api.derive.democracy.referendumsInfo(ids)
                    : of([])
            )
        )
    );
}