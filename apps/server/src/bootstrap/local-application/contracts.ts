import type { AiProvider } from '../../ai-providers/provider.js';
import type { GenerationFrameLog } from '../../modules/generation-runtime/interface.js';
import type { RequestAccessAdapter } from '../../environment/request-access.js';
import { createGenerationRuntime } from '../../modules/generation-runtime/implementation/generation-runtime.js';
import { createLocalFileCourseCreationRepositories } from '../../persistence/course-creation-repositories.js';
import { DataRoot } from '../../persistence/data-root.js';
import {
  createProviderConfigService,
  type ProviderConfigRepository,
} from '../../runtime/provider-config-service.js';
import type { SecretStore } from '../../runtime/secret-store.js';
import type { StructuredLogInput } from '../../runtime/logger.js';
import type { ServerDependencies } from '../app.js';

export type LocalApplicationOptions = Readonly<{
  dataRoot: string;
  csrfToken: string;
  requestAccess?: RequestAccessAdapter;
  allowedOrigin?: string;
  mockFailOnce?: boolean;
  now?: () => Date;
  runtimeIdentity?: Readonly<{
    instanceId: string;
    generation: number;
    startedAt: string;
    identityFingerprint: string;
    buildId: string;
    protocolVersion: string;
  }>;
  providers?: readonly AiProvider[];
  additionalProviders?: readonly AiProvider[];
  initialProviderId?: string;
  defaultFallbackProviderIds?: readonly string[];
  defaultMaxAttempts?: number;
  lessonClosureReconcileIntervalMs?: number;
  secretStore?: SecretStore;
  providerConfigRepository?: ProviderConfigRepository;
  createDiagnostics?: () => Promise<Readonly<{ artifactRef: string }>>;
  logProjectionEvent?: (input: StructuredLogInput) => Promise<void>;
}>;

export type LocalApplication = Readonly<{
  close(): Promise<void>;
  serverDependencies: ServerDependencies;
  courseRepositories: ReturnType<typeof createLocalFileCourseCreationRepositories>;
  frameLog: GenerationFrameLog;
  dataRoot: DataRoot;
  generationRuntime: ReturnType<typeof createGenerationRuntime>;
  providerConfigService: ReturnType<typeof createProviderConfigService>;
}>;
