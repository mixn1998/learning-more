export type SnapshotLoadResult<T> =
  | Readonly<{ status: 'unchanged'; etag?: string }>
  | Readonly<{ status: 'updated'; data: T; etag?: string }>;

type StoredSnapshot<T> = Readonly<{
  contractVersion: number;
  etag?: string;
  data: T;
}>;

export class QuerySnapshotCache<T> {
  readonly #storageKey: string;
  readonly #contractVersion: number;
  readonly #load: (
    etag: string | undefined,
    signal?: AbortSignal,
  ) => Promise<SnapshotLoadResult<T>>;
  readonly #listeners = new Set<() => void>();
  #snapshot: StoredSnapshot<T> | undefined;
  #inFlight: Promise<'unchanged' | 'updated'> | undefined;

  public constructor(
    input: Readonly<{
      key: string;
      contractVersion: number;
      load(etag: string | undefined, signal?: AbortSignal): Promise<SnapshotLoadResult<T>>;
    }>,
  ) {
    this.#storageKey = `learning-more:snapshot:${input.key}`;
    this.#contractVersion = input.contractVersion;
    this.#load = input.load;
    this.#snapshot = this.#readStored();
  }

  public read(): T | undefined {
    return this.#snapshot?.data;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public revalidate(signal?: AbortSignal): Promise<'unchanged' | 'updated'> {
    if (this.#inFlight !== undefined) return this.#inFlight;
    const current = this.#snapshot;
    this.#inFlight = this.#load(current?.etag, signal)
      .then((result) => {
        if (result.status === 'unchanged') {
          if (current !== undefined && result.etag !== undefined && result.etag !== current.etag) {
            this.#write({ ...current, etag: result.etag });
          }
          return 'unchanged' as const;
        }
        this.#write({
          contractVersion: this.#contractVersion,
          data: result.data,
          ...(result.etag === undefined ? {} : { etag: result.etag }),
        });
        return 'updated' as const;
      })
      .finally(() => {
        this.#inFlight = undefined;
      });
    return this.#inFlight;
  }

  public invalidate(): void {
    this.#snapshot = undefined;
    try {
      sessionStorage.removeItem(this.#storageKey);
    } catch {
      // Storage can be disabled; the in-memory cache remains authoritative for this page.
    }
    this.#emit();
  }

  #readStored(): StoredSnapshot<T> | undefined {
    try {
      const raw = sessionStorage.getItem(this.#storageKey);
      if (raw === null) return undefined;
      const parsed = JSON.parse(raw) as Partial<StoredSnapshot<T>>;
      if (parsed.contractVersion !== this.#contractVersion || parsed.data === undefined) {
        sessionStorage.removeItem(this.#storageKey);
        return undefined;
      }
      return parsed as StoredSnapshot<T>;
    } catch {
      return undefined;
    }
  }

  #write(snapshot: StoredSnapshot<T>): void {
    this.#snapshot = snapshot;
    try {
      sessionStorage.setItem(this.#storageKey, JSON.stringify(snapshot));
    } catch {
      // Large or disabled session storage must not prevent the latest in-memory view.
    }
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
