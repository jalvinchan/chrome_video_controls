import { AmplifierClient } from "../app/amplifier-client.js";
import { captureRefusal } from "../model/capture-target.js";
import { PopupView } from "../presentation/popup-view.js";
import { ChromeVideoStage } from "../video/chrome-video-stage.js";
import { PopupSync } from "../app/popup-sync.js";
import { BookmarkClient } from "../app/bookmark-client.js";

const client = new AmplifierClient(globalThis.chrome.runtime);
const video = new ChromeVideoStage(globalThis.chrome);
const bookmarks = new BookmarkClient(globalThis.chrome.runtime);
const view = new PopupView(document.querySelector("#app"));

async function currentTab() {
  const [tab] = await globalThis.chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? {};
}

async function present() {
  const tab = await currentTab();
  const blocked = tab.url ? captureRefusal(tab.url) : null;
  const [state, videoState] = await Promise.all([
    client.snapshot(),
    (async () => {
      try {
        if (blocked) throw new Error("Video controls aren't available on this page.");
        return await video.snapshot(tab.id);
      } catch (error) {
        const stored = await globalThis.chrome.storage.local.get("playbackRate");
        return { available: false, rate: stored.playbackRate ?? 1, error: error.message };
      }
    })(),
  ]);
  const key = videoState.bookmarkKey;
  let bookmarkState = { key: key ?? null, items: [] };
  if (key) {
    try { bookmarkState.items = await bookmarks.list(key); }
    catch (error) { bookmarkState.error = error.message; }
  }
  return {
    ...state,
    currentTabId: typeof tab.id === "number" ? tab.id : null,
    currentTitle: tab.title || "This tab",
    currentUrl: tab.url || "",
    blocked,
    video: videoState,
    bookmarks: bookmarkState,
    tab,
  };
}

async function boot() {
  const state = await present();
  view.render(state);
  let sync;
  async function bookmarkAction(key, work) {
    view.setBookmarkStatus(null);
    view.setBookmarkBusy(true);
    try {
      await work();
      await sync.refresh();
    } catch (error) {
      if (view.state.bookmarks?.key === key) view.setBookmarkStatus({ message: error.message, tone: "error" });
    } finally {
      view.setBookmarkBusy(false);
    }
  }
  view.bind({
    onRefresh: () => sync?.refresh(),
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
    onLevel: (sliderValue) => {
      client.setLevel(sliderValue).then((next) => {
        view.update({ ...view.state, ...next });
        view.setStatus(null);
      }).catch((error) => {
        view.setStatus({ message: error.message, tone: "error" });
      });
    },
    onSpeed: (() => {
      let revision = 0;
      return async (rate) => {
        const currentRevision = ++revision;
        try {
          const next = await video.setRate(view.state.currentTabId, rate);
          if (currentRevision !== revision) return;
          view.update({ ...view.state, video: next });
          view.setStatus(null);
        } catch (error) {
          if (currentRevision !== revision) return;
          view.update(view.state);
          view.setStatus({ message: error.message, tone: "error" });
        }
      };
    })(),
    onLoop: async (action) => {
      view.setLoopStatus(null);
      view.setBusy(true);
      try {
        const tabId = view.state.currentTabId;
        await video[action](tabId);
        await sync.refresh();
        view.setStatus(null);
      } catch (error) {
        view.setLoopStatus({ message: error.message, tone: "error" });
      } finally {
        view.setBusy(false);
      }
    },
    onBookmarkSave: (note) => {
      const { currentTabId, bookmarks: state } = view.state;
      return bookmarkAction(state.key, async () => {
        const point = await video.captureBookmark(currentTabId, state.key);
        await bookmarks.save(point.key, point.time, note);
        if (view.state.bookmarks?.key === point.key && view.bookmarkNote.value === note) view.bookmarkNote.value = "";
      });
    },
    onBookmarkSeek: ({ key, time }) => {
      const tabId = view.state.currentTabId;
      return bookmarkAction(key, () => video.seekBookmark(tabId, key, time));
    },
    onBookmarkRemove: ({ key, id }) => bookmarkAction(key, () => bookmarks.remove(key, id)),
    onReset: async () => {
      view.setBusy(true);
      try {
        const operations = [client.setLevel(1)];
        if (!view.state.video?.error) operations.push(video.resetControls(view.state.currentTabId));
        else operations.push(globalThis.chrome.storage.local.set({ playbackRate: 1 }));
        const results = await Promise.allSettled(operations);
        view.update(await present());
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
        view.setLoopStatus(null);
        view.setStatus({ message: "Controls reset to 1× speed and 0 dB gain; loop cleared.", tone: "ok" });
      } catch (error) {
        view.setStatus({ message: error.message, tone: "error" });
      } finally {
        view.setBusy(false);
      }
    },
    onShortcuts: () => {
      globalThis.chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch((error) => {
        view.setStatus({ message: error.message, tone: "error" });
      });
    },
  });
  sync = new PopupSync({
    chrome: globalThis.chrome,
    window: globalThis.window,
    read: present,
    apply: (next) => view.update(next),
    report: (error) => view.setStatus({ message: error.message, tone: "error" }),
    currentTabId: () => view.state.currentTabId,
    currentBookmarkKey: () => view.state.bookmarks?.key,
  });
  await sync.start();
}

boot().catch((error) => {
  document.querySelector("#app").textContent = error.message;
});
