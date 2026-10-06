import { createAmplifierApp } from "../app/amplifier-app.js";
import { handleAmplifierMessage } from "../app/amplifier-messages.js";
import { isAmplifierMessage } from "../model/message-kinds.js";
import { ChromeVideoStage } from "../video/chrome-video-stage.js";
import { handleVideoCommand } from "../app/video-commands.js";

const app = createAmplifierApp(globalThis.chrome);
const video = new ChromeVideoStage(globalThis.chrome);

function report(error) {
  console.error(error);
}

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isAmplifierMessage(message)) return;
  handleAmplifierMessage(app, message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => {
      report(error);
      sendResponse({ ok: false, error: error.message });
    },
  );
  return true;
});

globalThis.chrome.tabs.onRemoved.addListener((tabId) => {
  app.tabClosed(tabId).catch(report);
});

// Serialize key presses so rapid volume adjustments do not lose increments.
let commandChain = Promise.resolve();
globalThis.chrome.commands.onCommand.addListener((command, tab) => {
  commandChain = commandChain.then(async () => {
    const current = tab ?? (await globalThis.chrome.tabs.query({ active: true, currentWindow: true }))[0];
    await handleVideoCommand({ audio: app, video }, command, current);
    // Storage may not emit a change when the saved value is already equal to
    // the shortcut result. Notify any open extension UI after the command too.
    await globalThis.chrome.runtime.sendMessage({ type: "controlsChanged" }).catch(() => {});
    await globalThis.chrome.action.setBadgeText({ text: "" });
    await globalThis.chrome.action.setTitle({ title: "Video Controls" });
  }).catch(async (error) => {
    report(error);
    await globalThis.chrome.action.setBadgeText({ text: "!" });
    await globalThis.chrome.action.setTitle({ title: `Video Controls: ${error.message}` });
  });
});
