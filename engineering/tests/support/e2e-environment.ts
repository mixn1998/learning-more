function port(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`invalid_e2e_port:${value ?? ''}`);
  }
  return parsed;
}

export function resolveE2eEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const serverPort = port(env.LEARNING_MORE_E2E_SERVER_PORT, 43_129);
  const webPort = port(env.LEARNING_MORE_E2E_WEB_PORT, 5_179);
  const buildId = env.LEARNING_MORE_E2E_BUILD_ID ?? 'e2e-development';
  return {
    serverPort,
    webPort,
    buildId,
    serverBaseUrl: `http://127.0.0.1:${serverPort}`,
    webBaseUrl: `http://127.0.0.1:${webPort}`,
  } as const;
}
