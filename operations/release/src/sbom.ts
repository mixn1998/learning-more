import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export type PackageComponent = Readonly<{
  name: string;
  version: string;
  license?: string;
}>;

async function packageJsonFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (entry.name === '.bin') continue;
    const absolute = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      output.push(...(await packageJsonFiles(absolute)));
      continue;
    }
    const manifest = path.join(absolute, 'package.json');
    try {
      await readFile(manifest, 'utf8');
      output.push(manifest);
    } catch {
      // Nested dependency containers do not always represent packages themselves.
    }
    output.push(...(await packageJsonFiles(path.join(absolute, 'node_modules'))));
  }
  return output;
}

export async function scanInstalledPackages(nodeModulesPath: string): Promise<PackageComponent[]> {
  const components = new Map<string, PackageComponent>();
  for (const manifestPath of await packageJsonFiles(nodeModulesPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      name?: unknown;
      version?: unknown;
      license?: unknown;
    };
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue;
    const component: PackageComponent = {
      name: manifest.name,
      version: manifest.version,
      ...(typeof manifest.license === 'string' ? { license: manifest.license } : {}),
    };
    components.set(`${component.name}@${component.version}`, component);
  }
  return [...components.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

async function resolveDependency(packageDirectory: string, name: string, ownerName: string) {
  const ownerNodeModules = ownerName.startsWith('@')
    ? path.dirname(path.dirname(packageDirectory))
    : path.dirname(packageDirectory);
  const candidates = [
    path.join(packageDirectory, 'node_modules', ...name.split('/')),
    path.join(ownerNodeModules, ...name.split('/')),
  ];
  for (const candidate of candidates) {
    try {
      return await realpath(candidate);
    } catch {
      // Try the next Node-compatible resolution location.
    }
  }
  return undefined;
}

export async function scanProductionDependencyGraph(
  projectPackageDirectory: string,
): Promise<PackageComponent[]> {
  const components = new Map<string, PackageComponent>();
  const visited = new Set<string>();
  const projectManifest = JSON.parse(
    await readFile(path.join(projectPackageDirectory, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };

  const visit = async (packageDirectory: string) => {
    const resolved = await realpath(packageDirectory);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const manifest = JSON.parse(await readFile(path.join(resolved, 'package.json'), 'utf8')) as {
      name?: unknown;
      version?: unknown;
      license?: unknown;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return;
    const component: PackageComponent = {
      name: manifest.name,
      version: manifest.version,
      ...(typeof manifest.license === 'string' ? { license: manifest.license } : {}),
    };
    components.set(`${component.name}@${component.version}`, component);
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    };
    for (const name of Object.keys(dependencies).sort()) {
      const dependency = await resolveDependency(resolved, name, manifest.name);
      if (dependency !== undefined) await visit(dependency);
    }
  };

  for (const name of Object.keys(projectManifest.dependencies ?? {}).sort()) {
    const dependency = await realpath(
      path.join(projectPackageDirectory, 'node_modules', ...name.split('/')),
    );
    await visit(dependency);
  }
  return [...components.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

function purl(component: PackageComponent): string {
  const name = component.name.startsWith('@')
    ? component.name
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
    : encodeURIComponent(component.name);
  return `pkg:npm/${name}@${encodeURIComponent(component.version)}`;
}

export function createCycloneDxSbom(input: {
  applicationVersion: string;
  components: readonly PackageComponent[];
}): unknown {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'Learning MORE',
        version: input.applicationVersion,
      },
    },
    components: input.components.map((component) => ({
      type: 'library',
      name: component.name,
      version: component.version,
      'bom-ref': purl(component),
      purl: purl(component),
      ...(component.license === undefined
        ? {}
        : { licenses: [{ license: { id: component.license } }] }),
    })),
  };
}

export function createThirdPartyNotices(components: readonly PackageComponent[]): string {
  return [
    'Learning MORE — Third-Party Notices',
    '',
    'This distribution contains the following production dependencies:',
    '',
    ...components.map(
      (component) =>
        `${component.name}@${component.version} — ${component.license ?? 'LICENSE NOT DECLARED'}`,
    ),
    '',
    'Package license texts and notices remain available in their installed package directories.',
    '',
  ].join('\r\n');
}
