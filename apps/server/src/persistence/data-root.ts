import path from 'node:path';

const windowsDeviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function assertSafePathSegment(segment: string): void {
  const hasControlCharacter = [...segment].some((character) => character.charCodeAt(0) <= 31);
  const unsafe =
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    path.isAbsolute(segment) ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    windowsDeviceName.test(segment) ||
    /[<>:"|?*]/.test(segment) ||
    hasControlCharacter;
  if (unsafe) throw new Error('PATH_OUTSIDE_DATA_ROOT');
}

export class DataRoot {
  readonly absolutePath: string;

  private constructor(absolutePath: string) {
    this.absolutePath = absolutePath;
  }

  static create(rootPath: string): DataRoot {
    if (!path.isAbsolute(rootPath)) throw new Error('DATA_ROOT_MUST_BE_ABSOLUTE');
    return new DataRoot(path.resolve(rootPath));
  }

  resolve(...segments: readonly string[]): string {
    for (const segment of segments) assertSafePathSegment(segment);
    const resolved = path.resolve(this.absolutePath, ...segments);
    const relative = path.relative(this.absolutePath, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('PATH_OUTSIDE_DATA_ROOT');
    }
    return resolved;
  }
}
