export const MIN_LEVEL = 0;
export const MAX_LEVEL = 3;
export const LEVEL_STEP = 0.5;
export const DEFAULT_LEVEL = 1;

export class GainLevel {
  constructor(sliderValue) {
    if (typeof sliderValue !== "number" || !Number.isFinite(sliderValue)) {
      throw new Error("set gain: slider value must be a finite number");
    }
    const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, sliderValue));
    this.sliderValue = Math.round(clamped / LEVEL_STEP) * LEVEL_STEP;
  }

  static default() {
    return new GainLevel(DEFAULT_LEVEL);
  }

  get decibels() {
    return this.sliderValue === 0 ? -Infinity : 10 * (this.sliderValue - 1);
  }

  get linear() {
    return this.sliderValue === 0 ? 0 : 10 ** (this.decibels / 20);
  }
}
