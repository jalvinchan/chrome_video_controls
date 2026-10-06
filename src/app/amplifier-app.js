import { ChromeTabCapturePort } from "../capture/chrome-tab-capture-port.js";
import { ChromeAudioStage } from "../offscreen/chrome-audio-stage.js";
import { ChromeLevelRepository } from "../storage/chrome-level-repository.js";
import { AmplifierController } from "./amplifier-controller.js";

export function createAmplifierApp(chrome) {
  if (!chrome?.storage?.local || !chrome?.tabCapture || !chrome?.offscreen || !chrome?.runtime) {
    throw new Error("Amplifier needs the Chrome extension APIs.");
  }
  return new AmplifierController({
    repository: new ChromeLevelRepository(chrome.storage.local),
    capture: new ChromeTabCapturePort(chrome.tabCapture),
    stage: new ChromeAudioStage(chrome),
  });
}
