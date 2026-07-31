export interface Clock {
  now(): Date;
}

export class FakeClock implements Clock {
  #currentMilliseconds: number;

  constructor(instant: string | Date) {
    const milliseconds = new Date(instant).getTime();
    if (!Number.isFinite(milliseconds)) {
      throw new Error('FakeClock requires a valid instant');
    }
    this.#currentMilliseconds = milliseconds;
  }

  now(): Date {
    return new Date(this.#currentMilliseconds);
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error('FakeClock can only advance by a non-negative duration');
    }
    this.#currentMilliseconds += milliseconds;
  }
}
