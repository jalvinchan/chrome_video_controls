import assert from "node:assert/strict";
import { test } from "node:test";
import { PopupSync } from "../src/app/popup-sync.js";

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => { for (const listener of listeners) listener(...args); },
    listeners,
  };
}

function setup(read) {
  const chrome = {
    storage: { onChanged: event() },
    runtime: { onMessage: event() },
    tabs: { onActivated: event(), onUpdated: event() },
  };
  const events = { focus: event(), unload: event() };
  const applied = [];
  const errors = [];
  let reads = 0;
  const sync = new PopupSync({
    chrome,
    window: {
      addEventListener: (name, listener) => events[name].addListener(listener),
      removeEventListener: (name, listener) => events[name].removeListener(listener),
    },
    read: () => { reads += 1; return read?.() ?? Promise.resolve({ rate: 1 }); },
    apply: (state) => applied.push(state),
    report: (error) => errors.push(error.message),
    currentTabId: () => 7,
    currentBookmarkKey: () => "media:1",
  });
  return { sync, chrome, events, applied, errors, reads: () => reads };
}

test("an open popup follows saved speed/gain and command completion without polling", async () => {
  let state = { rate: 1, sliderValue: 1 };
  const context = setup(async () => ({ ...state }));
  await context.sync.start();
  state = { rate: 3, sliderValue: 2 };
  context.chrome.storage.onChanged.emit({ playbackRate: { newValue: 3 }, sliderValue: { newValue: 2 } }, "local");
  await context.sync.running;
  assert.deepEqual(context.applied.at(-1), state);
  // A shortcut can change actual playback when the saved preference is already
  // equal to its result, so a notification also refreshes without a storage write.
  state.rate = 4;
  context.chrome.runtime.onMessage.emit({ type: "controlsChanged" });
  await context.sync.running;
  assert.equal(context.applied.at(-1).rate, 4);
  assert.equal(context.reads(), 3);
});

test("unrelated settings/messages and updates to other tabs do not cause reads", async () => {
  const context = setup();
  await context.sync.start();
  context.chrome.storage.onChanged.emit({ unrelated: {} }, "local");
  context.chrome.storage.onChanged.emit({ playbackRate: {} }, "sync");
  context.chrome.runtime.onMessage.emit({ type: "snapshot" });
  context.chrome.tabs.onUpdated.emit(8, { title: "Other" });
  context.chrome.tabs.onUpdated.emit(7, { audible: true });
  assert.equal(context.reads(), 1);
  context.chrome.tabs.onUpdated.emit(7, { status: "complete" });
  await context.sync.running;
  context.chrome.tabs.onActivated.emit({ tabId: 7 });
  await context.sync.running;
  context.events.focus.emit();
  await context.sync.running;
  assert.equal(context.reads(), 4);
});

test("loop notifications refresh only the active tab without a storage change", async () => {
  const context = setup();
  await context.sync.start();
  context.chrome.runtime.onMessage.emit({ type: "videoControlsChanged" }, { tab: { id: 8 } });
  context.chrome.runtime.onMessage.emit({ type: "videoControlsChanged" }, {});
  assert.equal(context.reads(), 1);
  context.chrome.runtime.onMessage.emit({ type: "videoControlsChanged" }, { tab: { id: 7 } });
  await context.sync.running;
  assert.equal(context.reads(), 2);
});

test("bookmark changes refresh this video's list without reacting to unrelated videos", async () => {
  const context = setup();
  await context.sync.start();
  context.chrome.storage.onChanged.emit({ "videoBookmarks:media:2": {} }, "local");
  assert.equal(context.reads(), 1);
  context.chrome.storage.onChanged.emit({ "videoBookmarks:media:1": {} }, "local");
  await context.sync.running;
  assert.equal(context.reads(), 2);
});

test("bursts discard stale snapshots and coalesce refreshes", async () => {
  let resolveRead;
  let rate = 1;
  const context = setup(() => new Promise((resolve) => { resolveRead = () => resolve({ rate }); }));
  const started = context.sync.start();
  await Promise.resolve();
  context.chrome.runtime.onMessage.emit({ type: "controlsChanged" });
  context.chrome.storage.onChanged.emit({ playbackRate: {} }, "local");
  resolveRead();
  rate = 3;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(context.applied.length, 0, "Stale state must not repaint the popup");
  resolveRead();
  await started;
  assert.deepEqual(context.applied, [{ rate: 3 }]);
  assert.equal(context.reads(), 2);
});

test("closing the popup removes listeners and ignores outstanding snapshots", async () => {
  let resolveRead;
  const context = setup(() => new Promise((resolve) => { resolveRead = resolve; }));
  const started = context.sync.start();
  await Promise.resolve();
  context.events.unload.emit();
  resolveRead({ rate: 3 });
  await started;
  assert.deepEqual(context.applied, []);
  for (const source of [context.chrome.storage.onChanged, context.chrome.runtime.onMessage,
    context.chrome.tabs.onActivated, context.chrome.tabs.onUpdated, ...Object.values(context.events)]) {
    assert.equal(source.listeners.size, 0);
  }
});

test("a failed read is reported and later changes can refresh successfully", async () => {
  let failed = true;
  const context = setup(async () => {
    if (failed) throw new Error("Tab unavailable");
    return { rate: 2 };
  });
  await context.sync.start();
  assert.deepEqual(context.errors, ["Tab unavailable"]);
  failed = false;
  context.chrome.runtime.onMessage.emit({ type: "controlsChanged" });
  await context.sync.running;
  assert.deepEqual(context.applied, [{ rate: 2 }]);
});
