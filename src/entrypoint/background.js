import { createAmplifierApp } from "../app/amplifier-app.js";
import { handleAmplifierMessage } from "../app/amplifier-messages.js";
import { isAmplifierMessage } from "../model/message-kinds.js";

const app = createAmplifierApp(globalThis.chrome);

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
