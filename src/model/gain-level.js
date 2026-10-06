export const MIN_PERCENT = 0;
export const MAX_PERCENT = 500;
export const DEFAULT_PERCENT = 200;

export class GainLevel {
  constructor(percent) {
    if (typeof percent !== "number" || !Number.isFinite(percent)) {
      throw new Error("set gain: percent must be a finite number");
    }
    this.percent = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(percent)));
  }

  static default() {
    return new GainLevel(DEFAULT_PERCENT);
  }

  get linear() {
    return this.percent / 100;
  }
}
