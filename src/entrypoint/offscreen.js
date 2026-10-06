import { createOffscreenApp } from "../app/offscreen-app.js";
import { handleOffscreenMessage } from "../app/offscreen-messages.js";
import { isOffscreenMessage } from "../model/message-kinds.js";

const app = createOffscreenApp();

app.onEnded = () => {
  globalThis.chrome.runtime.sendMessage({ type: "captureEnded" }).catch((error) => {
    console.error(error);
  });
};

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return;
  handleOffscreenMessage(app, message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message });
    },
  );
  return true;
});
