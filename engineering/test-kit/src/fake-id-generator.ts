export interface IdGenerator {
  next(prefix: string): string;
}

export class SequentialIdGenerator implements IdGenerator {
  #sequence = 0;

  next(prefix: string): string {
    const normalizedPrefix = prefix.trim();
    if (!/^[a-z][a-z0-9-]*$/.test(normalizedPrefix)) {
      throw new Error('ID prefix must use lowercase kebab-case');
    }
    this.#sequence += 1;
    return `${normalizedPrefix}-${String(this.#sequence).padStart(4, '0')}`;
  }
}
