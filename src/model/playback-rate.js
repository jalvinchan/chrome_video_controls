export const MIN_RATE = 0.25;
export const MAX_RATE = 4;
export const RATE_STEP = 0.05;
export const DEFAULT_RATE = 1;

export function playbackRate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Playback speed must be a finite number.");
  }
  return Number((Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, value)) / RATE_STEP) * RATE_STEP).toFixed(2));
}
