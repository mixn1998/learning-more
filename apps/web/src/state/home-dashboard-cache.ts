import type { HomeDashboardView } from '@learning-more/contracts';

import { homeClient } from '../client/home-client.js';
import { QuerySnapshotCache } from './query-snapshot-cache.js';

export const homeDashboardCache = new QuerySnapshotCache<HomeDashboardView>({
  key: 'home-dashboard',
  contractVersion: 1,
  async load(etag, signal) {
    const result = await homeClient.getDashboardIfChanged(etag, signal);
    return result.status === 'unchanged'
      ? { status: 'unchanged', ...(result.etag === undefined ? {} : { etag: result.etag }) }
      : {
          status: 'updated',
          data: result.data,
          ...(result.etag === undefined ? {} : { etag: result.etag }),
        };
  },
});
