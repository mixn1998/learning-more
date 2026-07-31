import type { SecretStore } from '../runtime/secret-store.js';
import type { DeploymentMode } from '../runtime/runtime-config.js';
import {
  createLocalRequestAccessAdapter,
  LOCAL_APPLICATION_PRINCIPAL,
  type ApplicationPrincipal,
  type RequestAccessAdapter,
} from './request-access.js';

export type ApplicationDataScope = Readonly<{
  id: string;
  dataRoot: string;
}>;

export interface ApplicationEnvironment {
  readonly mode: DeploymentMode;
  readonly principal: ApplicationPrincipal;
  readonly dataScope: ApplicationDataScope;
  readonly requestAccess: RequestAccessAdapter;
  readonly secretStore: SecretStore;
}

export function createApplicationEnvironment(input: {
  readonly mode: DeploymentMode;
  readonly dataRoot: string;
  readonly allowedOrigin: string;
  readonly csrfToken: string;
  readonly secretStore: SecretStore;
}): ApplicationEnvironment {
  if (input.mode !== 'local') {
    throw new Error(`deployment_mode_not_supported:${input.mode}`);
  }
  const principal: ApplicationPrincipal = LOCAL_APPLICATION_PRINCIPAL;
  return {
    mode: 'local',
    principal,
    dataScope: { id: 'local', dataRoot: input.dataRoot },
    requestAccess: createLocalRequestAccessAdapter({
      allowedOrigin: input.allowedOrigin,
      csrfToken: input.csrfToken,
      principal,
    }),
    secretStore: input.secretStore,
  };
}
