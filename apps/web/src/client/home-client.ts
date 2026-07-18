import { HomeDashboardResponseSchema, type HomeDashboardView } from '@learning-more/contracts';

import { apiRequest, apiRequestConditional, type ConditionalApiResult } from './api-client.js';

export interface HomeClient {
  getDashboard(signal?: AbortSignal): Promise<HomeDashboardView>;
  getDashboardIfChanged(
    etag: string | undefined,
    signal?: AbortSignal,
  ): Promise<ConditionalApiResult<HomeDashboardView>>;
}

export const homeClient: HomeClient = {
  async getDashboard(signal) {
    return (
      await apiRequest('/api/v1/home', {
        schema: HomeDashboardResponseSchema,
        ...(signal === undefined ? {} : { signal }),
      })
    ).data;
  },
  getDashboardIfChanged(etag, signal) {
    return apiRequestConditional('/api/v1/home', {
      schema: HomeDashboardResponseSchema,
      ...(etag === undefined ? {} : { etag }),
      ...(signal === undefined ? {} : { signal }),
    });
  },
};
