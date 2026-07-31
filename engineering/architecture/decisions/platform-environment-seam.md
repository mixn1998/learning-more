# Platform environment seam

## Intent

Prepare Learning MORE to become an application module inside a future authenticated website without beginning the public-cloud migration. The current product remains a local, single-user, loopback-only application.

## Decision

Introduce one deep `ApplicationEnvironment` module at the server bootstrap seam. Its small interface supplies:

- the deployment mode;
- the current environment principal and stable data-scope identity;
- the request-access adapter used by HTTP bootstrap;
- the data root and secret-store strategy used when assembling the application.

The initial `LocalApplicationEnvironment` adapter preserves current behavior:

- deployment mode is `local`;
- the principal is a stable local subject;
- the existing data root is used without moving or nesting user data;
- loopback host, allowed-origin, and CSRF checks remain authoritative;
- Windows DPAPI or the existing environment secret store remains authoritative.

The domain modules do not receive OIDC tokens, cookies, HTTP headers, deployment-mode branches, or platform configuration. They continue to depend on repositories and existing domain interfaces.

`platform` is a reserved deployment mode only. Selecting it before a platform adapter exists fails before the HTTP server starts with a specific unsupported-mode error.

## Future adapter

A later `PlatformApplicationEnvironment` adapter may:

- resolve an OIDC-authenticated principal supplied by the unified website;
- map the stable OIDC `sub` claim to a Learning MORE data scope;
- use platform-managed secrets and scoped persistence;
- authorize requests from the trusted website gateway.

Token validation, refresh, browser sessions, TLS, public listening, cloud persistence, and data migration are explicitly outside this change.

## Interface and data flow

1. Runtime configuration resolves `deploymentMode`, defaulting to `local`.
2. Server bootstrap asks the environment factory for an `ApplicationEnvironment`.
3. The environment provides bootstrap inputs for request access, persistence, and secrets.
4. HTTP bootstrap applies the supplied request-access adapter.
5. The local adapter returns the fixed local principal after the existing security checks.
6. Application assembly and all teaching behavior continue unchanged.

## Compatibility

- Existing runtime configuration files remain valid because `deploymentMode` has a local default.
- Existing `.learning-more-data` contents retain their paths and identifiers.
- The launcher and server continue to bind only to `127.0.0.1`.
- No OIDC package or cloud runtime dependency is added.

## Verification

- Runtime configuration resolves and fingerprints the deployment mode.
- Local environment resolution preserves the configured data root and fixed principal.
- Local request access still rejects non-loopback hosts, invalid origins, and invalid CSRF tokens.
- `platform` mode fails fast without starting a listener.
- Existing local bootstrap and application tests remain green.
