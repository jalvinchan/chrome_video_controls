import { BOOKMARK_PREFIX } from "../storage/chrome-bookmark-repository.js";
import { SITE_PREFERENCE_PREFIX } from "../storage/chrome-site-preferences.js";

const SETTINGS = new Set(["playbackRate", "sliderValue", "liveSliderValue", "tabId", "title", "tabUrl"]);

// Refresh on events, not a timer. Read actual video state because a saved speed
// is a preference for new videos, not necessarily the speed of this tab.
export class PopupSync {
  constructor({ chrome, window, read, apply, report, currentTabId, currentBookmarkKey = () => null }) {
    Object.assign(this, { chrome, window, read, apply, report, currentTabId, currentBookmarkKey });
    this.active = false;
    this.dirty = false;
    this.running = null;
    this.onStorage = (changes, area) => {
      if (area === "local" && Object.keys(changes).some((key) => SETTINGS.has(key) || key.startsWith(SITE_PREFERENCE_PREFIX)
        || key === BOOKMARK_PREFIX + this.currentBookmarkKey())) this.refresh();
    };
    this.onMessage = (message, sender) => {
      if (message?.type === "controlsChanged") this.refresh();
      if (message?.type === "videoControlsChanged" && sender?.tab?.id === this.currentTabId()) this.refresh();
    };
    this.onActivated = () => this.refresh();
    this.onUpdated = (tabId, change) => {
      if (tabId === this.currentTabId() && (change.url || change.title || change.status === "complete")) this.refresh();
    };
    this.onFocus = () => this.refresh();
    this.onUnload = () => this.stop();
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.chrome.storage.onChanged.addListener(this.onStorage);
    this.chrome.runtime.onMessage.addListener(this.onMessage);
    this.chrome.tabs.onActivated.addListener(this.onActivated);
    this.chrome.tabs.onUpdated.addListener(this.onUpdated);
    this.window.addEventListener("focus", this.onFocus);
    this.window.addEventListener("unload", this.onUnload);
    return this.refresh();
  }

  refresh() {
    if (!this.active) return Promise.resolve();
    this.dirty = true;
    if (this.running) return this.running;
    this.running = Promise.resolve().then(async () => {
      while (this.active && this.dirty) {
        this.dirty = false;
        const state = await this.read();
        // Discard a snapshot if more changes arrived while it was loading.
        if (this.active && !this.dirty) this.apply(state);
      }
    }).catch((error) => {
      if (this.active) this.report(error);
    }).finally(() => {
      this.running = null;
      if (this.active && this.dirty) this.refresh();
    });
    return this.running;
  }

  stop() {
    this.active = false;
    this.chrome.storage.onChanged.removeListener(this.onStorage);
    this.chrome.runtime.onMessage.removeListener(this.onMessage);
    this.chrome.tabs.onActivated.removeListener(this.onActivated);
    this.chrome.tabs.onUpdated.removeListener(this.onUpdated);
    this.window.removeEventListener("focus", this.onFocus);
    this.window.removeEventListener("unload", this.onUnload);
  }
}
