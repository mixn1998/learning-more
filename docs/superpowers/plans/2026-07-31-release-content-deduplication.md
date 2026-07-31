# Release Content Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate immutable code, visual assets, and native dependencies across the active and previous local releases while preserving existing release paths and rollback behavior.

**Architecture:** Stage the portable candidate normally, then place eligible files in category-specific SHA-256 stores and replace the candidate copies with same-volume hard links. Store per-build reference manifests outside the checksum-protected release tree and prune shared objects only when both protected releases have readable manifests.

**Tech Stack:** TypeScript, Node.js `fs/promises`, SHA-256, NTFS hard links, Vitest.

## Global Constraints

- Keep active and previous release directories independently launchable through their existing paths.
- Do not change or inspect user data.
- Fail candidate staging without affecting the active release when sharing fails.
- Treat missing protected reference manifests conservatively and skip shared-content pruning.
- Do not commit Node.js runtime binaries or native `.node` binaries.

---

### Task 1: Shared immutable content store

**Files:**
- Create: `apps/host/src/shared-content-store.ts`
- Create: `apps/host/src/shared-content-store.test.ts`

**Interfaces:**
- Produces: `shareCandidateContent(candidateRoot, releasesRoot): Promise<SharedContentManifest>`
- Produces: `pruneSharedContentStore(releasesRoot, protectedBuildIds): Promise<readonly string[]>`

- [ ] **Step 1: Write failing tests**

Create candidates containing identical `.js`, `.svg`, `.woff2`, `.node`, and `.wasm` files. Assert that sharing produces category manifests, identical files have a shared inode/link count, noneligible metadata remains independent, and pruning retains only protected hashes.

- [ ] **Step 2: Run the focused tests**

Run: `corepack pnpm vitest run --root . apps/host/src/shared-content-store.test.ts`

Expected: FAIL because `shared-content-store.ts` does not exist.

- [ ] **Step 3: Implement content sharing**

Walk regular files beneath the candidate, classify extensions into `code`, `visual`, or `native`, hash each file, atomically materialize `.shared-content/<category>/<sha256>`, replace the candidate file with a hard link, and write `.shared-content/manifests/<buildId>.json`.

- [ ] **Step 4: Implement conservative pruning**

Read manifests for every protected build. If any protected manifest is absent or invalid, remove nothing. Otherwise delete unreferenced category objects and manifests for unprotected builds.

- [ ] **Step 5: Run the focused tests**

Run: `corepack pnpm vitest run --root . apps/host/src/shared-content-store.test.ts`

Expected: PASS.

### Task 2: Activation and lifecycle integration

**Files:**
- Modify: `apps/host/src/workspace-activation.ts`
- Modify: `apps/host/src/release-retention.ts`
- Modify: `apps/host/src/workspace-activation.test.ts`
- Modify: `apps/host/src/release-retention.test.ts`

**Interfaces:**
- Consumes: `shareCandidateContent`
- Consumes: `pruneSharedContentStore`

- [ ] **Step 1: Write integration expectations**

Assert staging shares candidate content before atomic rename and release retention invokes both runtime and content-store pruning while protecting active and previous build IDs.

- [ ] **Step 2: Run host tests**

Run: `corepack pnpm vitest run --root . apps/host/src/workspace-activation.test.ts apps/host/src/release-retention.test.ts`

Expected: FAIL until integration is implemented.

- [ ] **Step 3: Integrate staging**

After candidate copy and runtime sharing, call `shareCandidateContent(temporary, releasesRoot)` before renaming the temporary directory. The store reads and validates `buildId` from the candidate release manifest.

- [ ] **Step 4: Integrate retention**

Call `pruneSharedContentStore` with the same protected build set used by runtime pruning.

- [ ] **Step 5: Run host tests**

Run: `corepack pnpm --filter @learning-more/host test`

Expected: PASS.

### Task 3: Git boundaries and release verification

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Produces: source-control exclusion for `node.exe`, `*.node`, and local shared release stores.

- [ ] **Step 1: Add ignore rules**

Add `node.exe`, `*.node`, `.shared-runtime/`, and `.shared-content/` while preserving the existing source `runtime` allowlists.

- [ ] **Step 2: Verify source control**

Run: `git ls-files | rg "(^|/)(node\\.exe|.*\\.node)$"`

Expected: no output.

- [ ] **Step 3: Verify build and tests**

Run: `corepack pnpm --filter @learning-more/host typecheck`

Expected: PASS.

Run: `corepack pnpm --filter @learning-more/host test`

Expected: PASS.

- [ ] **Step 4: Activate and measure**

Build and activate the workspace candidate through the existing local activation flow. Confirm the service is healthy, active and previous releases share eligible files, and report logical versus physical storage.
