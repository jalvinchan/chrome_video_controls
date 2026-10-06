import { playbackRate } from "../model/playback-rate.js";

export class ChromeVideoStage {
  constructor(chrome) {
    this.chrome = chrome;
    this.chain = Promise.resolve();
  }

  snapshot(tabId) {
    return this.#send(tabId, { type: "snapshot" });
  }

  setRate(tabId, rate) {
    return this.#send(tabId, { type: "setRate", rate: playbackRate(rate) });
  }

  adjustRate(tabId, delta) {
    return this.#send(tabId, { type: "adjustRate", delta });
  }

  #send(tabId, message) {
    const operation = this.chain.then(() => this.#deliver(tabId, message));
    this.chain = operation.catch(() => {});
    return operation;
  }

  async #deliver(tabId, message) {
    if (!Number.isInteger(tabId)) throw new Error("Open a web page, then try again.");
    const request = { target: "video", ...message };
    const send = () => this.chrome.tabs.sendMessage(tabId, request, { frameId: 0 });
    let response;
    try {
      response = await send();
    } catch {
      // A page without the script (or a reloaded page) needs injection.
    }
    if (!response) {
      // activeTab permits this where the user opened the popup or invoked a
      // shortcut. No website is granted automatic script access.
      await this.chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/entrypoint/video.js"],
      });
      response = await send();
    }
    if (!response?.ok) throw new Error(response?.error || "Video controls did not respond.");
    return response.result;
  }
}
