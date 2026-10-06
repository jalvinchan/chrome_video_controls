import { GainLevel } from "../model/gain-level.js";
import { playbackRate } from "../model/playback-rate.js";

export const SITE_PREFERENCE_PREFIX = "sitePreference:";

export function sitePreferenceKey(url, setting) {
  let site;
  try { site = new URL(url); } catch { throw new Error("Open a web page to save site preferences."); }
  if (!["http:", "https:"].includes(site.protocol)) return null;
  return `${SITE_PREFERENCE_PREFIX}${site.hostname}:${setting}`;
}

// Separate keys avoid read/modify/write races between gain and speed, or tabs.
// Legacy global values remain the fallback; site adjustments never overwrite them.
export class ChromeSitePreferences {
  constructor(storage) { this.storage = storage; }

  async loadRate(url) {
    const key = sitePreferenceKey(url, "playbackRate") ?? "playbackRate";
    const stored = await this.storage.get([key, "playbackRate"]);
    return { key, rate: playbackRate(this.#value(stored[key], stored.playbackRate)) };
  }

  async saveRate(url, rate) {
    const key = sitePreferenceKey(url, "playbackRate") ?? "playbackRate";
    await this.storage.set({ [key]: playbackRate(rate) });
  }

  async loadLevel(url) {
    const key = sitePreferenceKey(url, "sliderValue") ?? "sliderValue";
    const stored = await this.storage.get([key, "sliderValue"]);
    return new GainLevel(this.#value(stored[key], stored.sliderValue));
  }

  async saveLevel(url, level) {
    const key = sitePreferenceKey(url, "sliderValue");
    if (key) await this.storage.set({ [key]: new GainLevel(level.sliderValue).sliderValue });
  }

  #value(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : 1;
  }
}
