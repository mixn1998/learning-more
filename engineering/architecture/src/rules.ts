export const DATA_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export const IMPORT_RULES = {
  modulePublicInterfaceOnly: 'MODULE_PUBLIC_INTERFACE_ONLY',
  webAllowedDependenciesOnly: 'WEB_ALLOWED_DEPENDENCIES_ONLY',
  contractsPlatformIndependent: 'CONTRACTS_PLATFORM_INDEPENDENT',
} as const;

export type ImportRule = (typeof IMPORT_RULES)[keyof typeof IMPORT_RULES];
