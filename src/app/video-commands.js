import { DEFAULT_LEVEL, GainLevel, LEVEL_STEP } from "../model/gain-level.js";
import { captureRefusal } from "../model/capture-target.js";

export async function handleVideoCommand({ audio, video }, command, tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("Open a web page, then try again.");
  if (command === "speed-up" || command === "speed-down") {
    return video.adjustRate(tab.id, command === "speed-up" ? 0.25 : -0.25);
  }
  if (command === "reset-controls") {
    await video.setRate(tab.id, 1);
    return audio.setLevel(DEFAULT_LEVEL);
  }
  if (command === "volume-up" || command === "volume-down") {
    const refusal = captureRefusal(tab.url);
    if (refusal) throw new Error(refusal);
    const state = await audio.start(tab);
    const delta = command === "volume-up" ? LEVEL_STEP : -LEVEL_STEP;
    return audio.setLevel(new GainLevel(state.sliderValue + delta).sliderValue);
  }
  throw new Error("Unknown video shortcut.");
}
