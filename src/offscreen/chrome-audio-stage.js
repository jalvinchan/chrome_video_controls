import { OffscreenMessage } from "../model/message-kinds.js";
import { AudioStage } from "./audio-stage.js";

const DOCUMENT_URL = "src/presentation/offscreen.html";

export class ChromeAudioStage extends AudioStage {
  constructor(chrome) {
    super();
    this.offscreen = chrome.offscreen;
    this.runtime = chrome.runtime;
  }

  async open() {
    if (await this.isOpen()) return;
    try {
      // A service worker cannot hold a MediaStream, so playback lives here.
      await this.offscreen.createDocument({
        url: DOCUMENT_URL,
        reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
        justification: "Play the current tab louder through a gain control",
      });
    } catch (error) {
      if (await this.isOpen()) return;
      throw new Error(`open amplifier audio: ${error.message}`);
    }
  }

  async isOpen() {
    try {
      const contexts = await this.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      return contexts.length > 0;
    } catch (error) {
      throw new Error(`check amplifier audio: ${error.message}`);
    }
  }

  async play(streamId, level) {
    await this.open();
    await this.#send({
      type: OffscreenMessage.play,
      target: "offscreen",
      streamId,
      percent: level.percent,
    });
  }

  async setGain(level) {
    await this.#send({
      type: OffscreenMessage.applyLevel,
      target: "offscreen",
      percent: level.percent,
    });
  }

  async halt() {
    if (!(await this.isOpen())) return;
    try {
      await this.#send({ type: OffscreenMessage.halt, target: "offscreen" });
    } catch {
      // Closing the document still releases the tab if the page is already gone.
    }
    try {
      await this.offscreen.closeDocument();
    } catch {
      // The document can already be gone if the browser closed it.
    }
  }

  async #send(message) {
    let response;
    try {
      response = await this.runtime.sendMessage(message);
    } catch (error) {
      throw new Error(`reach amplifier audio: ${error.message}`);
    }
    if (!response?.ok) {
      throw new Error(response?.error || "Amplifier audio did not respond.");
    }
  }
}
