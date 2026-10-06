import { AmplifierClient } from "../app/amplifier-client.js";
import { captureRefusal } from "../model/capture-target.js";
import { PopupView } from "../presentation/popup-view.js";

const client = new AmplifierClient(globalThis.chrome.runtime);
const view = new PopupView(document.querySelector("#app"));

async function currentTab() {
  const [tab] = await globalThis.chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? {};
}

async function present() {
  const tab = await currentTab();
  const state = await client.snapshot();
  return {
    ...state,
    currentTabId: typeof tab.id === "number" ? tab.id : null,
    currentTitle: tab.title || "This tab",
    currentUrl: tab.url || "",
    blocked: tab.url ? captureRefusal(tab.url) : null,
    tab,
  };
}

async function boot() {
  const state = await present();
  view.render(state);
  view.bind({
    onToggle: async () => {
      view.setBusy(true);
      try {
        const latest = await present();
        const amplifyingThisTab = latest.live && latest.tabId === latest.currentTabId;
        const next = amplifyingThisTab || (latest.blocked && latest.live)
          ? await client.stop()
          : await client.start({
              id: latest.tab.id,
              url: latest.tab.url,
              title: latest.tab.title,
            });
        view.update({ ...latest, ...next, blocked: latest.blocked });
        view.setStatus(null);
      } catch (error) {
        view.setStatus({ message: error.message, tone: "error" });
      } finally {
        view.setBusy(false);
      }
    },
    onLevel: (percent) => {
      client.setLevel(percent).catch((error) => {
        view.setStatus({ message: error.message, tone: "error" });
      });
    },
  });
}

boot().catch((error) => {
  document.querySelector("#app").textContent = error.message;
});
