import { AudioGraph } from "../core/audio-graph.js";
import { ChromeTabStreamOpener } from "../capture/chrome-tab-stream-opener.js";
import { OffscreenSession } from "./offscreen-session.js";

export function createOffscreenApp(mediaDevices = globalThis.navigator?.mediaDevices) {
  return new OffscreenSession({
    opener: new ChromeTabStreamOpener(mediaDevices),
    graphFactory: () => new AudioGraph(new AudioContext()),
  });
}
