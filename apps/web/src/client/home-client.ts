import { HomeDashboardResponseSchema, type HomeDashboardView } from '@learning-more/contracts';

import { apiRequest } from './api-client.js';

export interface HomeClient {
  getDashboard(signal?: AbortSignal): Promise<HomeDashboardView>;
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
};
