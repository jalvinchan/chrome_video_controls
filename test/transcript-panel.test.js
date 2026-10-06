import assert from "node:assert/strict";
import { test } from "node:test";
import { TranscriptPanel } from "../src/app/transcript-panel.js";

function event() {
  const listeners = new Set();
  return { listeners, addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn),
    fire: (...args) => { for (const fn of listeners) fn(...args); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const cue = { start: 20, end: 22, text: "Future caption" };

async function fixture(t, overrides = {}) {
  const state = { tab: { id: 1, title: "First", windowId: 5 }, key: "media:first", time: 0, saved: null, writes: [], seeks: [] };
  const chrome = { windows: { async getCurrent() { return { id: 5 }; } },
    tabs: { async query(query) { assert.equal(query.windowId, 5); return [state.tab]; }, onActivated: event(), onUpdated: event() },
    storage: { onChanged: event() }, runtime: { onMessage: event() } };
  const window = { addEventListener() {}, removeEventListener() {} };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const view = { bind(handlers) { this.handlers = handlers; }, setContext(title, ready) { this.title = title; this.ready = ready; },
    setTitle(title) { this.title = title; }, setStatus(message, tone) { this.status = { message, tone }; },
    setTracks(tracks, selected) { this.tracks = tracks; this.selected = selected; },
    setTranscript(cues, label) { this.cues = cues; this.label = label; }, setTime(time) { this.time = time; },
    setBusy(busy) { this.busy = busy; } };
  const video = { async snapshot() { return { bookmarkKey: state.key, currentTime: state.time }; },
    async seekTranscript(tabId, key, time) { state.seeks.push({ tabId, key, time }); } };
  const source = { async list() { return [{ id: "media:0", label: "English" }]; }, async read() { return [cue]; }, ...overrides.source };
  const repository = { async load() { return state.saved; }, async save(key, name, cues) {
    state.writes.push({ key, name, cues }); state.saved = { name, cues };
  }, async remove() { state.saved = null; }, ...overrides.repository };
  const panel = new TranscriptPanel({ chrome, window, document, view, video, source, repository });
  t.after(() => panel.stop());
  await panel.start();
  await flush();
  return { panel, chrome, document, view, state, video };
}

test("side panel loads future lines once, polls only the timeline and routes seeks to the displayed video", async (t) => {
  let reads = 0;
  const { panel, state, view } = await fixture(t, { source: { async read() { reads += 1; return [cue]; } } });
  assert.deepEqual(view.cues, [cue]);
  assert.equal(view.busy, false);
  state.time = 20.5;
  await panel.refresh();
  assert.equal(view.time, 20.5);
  assert.equal(reads, 1);
  await panel.seek(20);
  assert.deepEqual(state.seeks, [{ tabId: 1, key: "media:first", time: 20 }]);
});

test("tab changes discard delayed old captions and do not follow another window", async (t) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { panel, state, view, chrome } = await fixture(t, { source: { read: () => pending } });
  assert.equal(view.busy, true);
  chrome.tabs.onActivated.fire({ tabId: 9, windowId: 6 });
  assert.equal(panel.context.tabId, 1);
  state.tab = { id: 2, title: "Second", windowId: 5 };
  state.key = null;
  chrome.tabs.onActivated.fire({ tabId: 2, windowId: 5 });
  await panel.refresh();
  await flush();
  finish([cue]);
  await flush();
  assert.equal(view.title, "Second");
  assert.deepEqual(view.cues, []);
  assert.equal(view.ready, false);
  assert.equal(view.busy, false);
});

test("Refresh retries the chosen caption track and falls back if it disappears", async (t) => {
  let tracks = [{ id: "manual", label: "English", selected: true }, { id: "automatic", label: "Automatic" }];
  let denied = true;
  const { panel, view } = await fixture(t, { source: {
    async list() { return tracks; },
    async read(tabId, key, id) {
      if (id === "automatic" && denied) throw new Error("Enable captions, then Refresh");
      return [{ ...cue, text: id }];
    },
  } });
  await panel.select("automatic");
  assert.match(view.status.message, /Enable captions/);
  denied = false;
  await view.handlers.onRefresh();
  assert.equal(view.selected, "automatic");
  assert.equal(view.cues[0].text, "automatic");
  tracks = tracks.slice(0, 1);
  await view.handlers.onRefresh();
  assert.equal(view.selected, "manual");
  assert.equal(view.cues[0].text, "manual");
});

test("imports preserve existing transcripts on invalid files and persist successful files by video", async (t) => {
  const { panel, state, view } = await fixture(t);
  await panel.import({ name: "bad.srt", size: 4, text: async () => "Bad" });
  assert.match(view.status.message, /malformed/);
  assert.deepEqual(view.cues, [cue]);
  assert.equal(state.writes.length, 0);
  await panel.import({ name: "good.srt", size: 80, text: async () => "1\n00:00:40,000 --> 00:00:42,000\nImported future line" });
  assert.equal(state.writes[0].key, "media:first");
  assert.equal(view.selected, "imported");
  assert.equal(view.cues[0].start, 40);
  await panel.remove();
  assert.equal(view.selected, "media:0");
  assert.deepEqual(view.cues, [cue]);
});

test("an import interrupted by navigation cannot save under a different video's identity", async (t) => {
  let finish;
  const { panel, state, chrome } = await fixture(t);
  const pending = panel.import({ name: "good.vtt", size: 80, text: () => new Promise((resolve) => { finish = resolve; }) });
  state.tab = { id: 2, title: "Other", windowId: 5 };
  state.key = "media:other";
  chrome.tabs.onActivated.fire({ tabId: 2, windowId: 5 });
  await panel.refresh();
  finish("WEBVTT\n\n00:01.000 --> 00:02.000\nText");
  await pending;
  assert.equal(state.writes.length, 0);
});

test("saved imports remain usable when a site's full caption list is inaccessible", async (t) => {
  const { view } = await fixture(t, { source: { async list() { throw new Error("Player denied captions"); } },
    repository: { async load() { return { name: "lesson.vtt", cues: [cue] }; } } });
  assert.deepEqual(view.cues, [cue]);
  assert.equal(view.selected, "imported");
  assert.match(view.status.message, /denied/);
  assert.equal(view.status.tone, "warn");
  assert.equal(view.busy, false);
});

test("failed import saves leave the displayed transcript usable and report the storage error", async (t) => {
  const { panel, view } = await fixture(t, { repository: { async save() { throw new Error("Storage quota exceeded"); } } });
  await panel.import({ name: "lesson.srt", size: 70, text: async () => "1\n00:00:01,000 --> 00:00:02,000\nNew line" });
  assert.deepEqual(view.cues, [cue]);
  assert.match(view.status.message, /quota/);
  assert.equal(view.busy, false);
});

test("hidden and closed panels stop polling and release event listeners", async (t) => {
  const { panel, chrome, document, view } = await fixture(t);
  document.hidden = true;
  panel.onVisibility();
  view.time = 99;
  await panel.refresh();
  assert.equal(view.time, 99);
  panel.stop();
  assert.equal(chrome.tabs.onActivated.listeners.size, 0);
  assert.equal(chrome.tabs.onUpdated.listeners.size, 0);
  assert.equal(chrome.storage.onChanged.listeners.size, 0);
  assert.equal(chrome.runtime.onMessage.listeners.size, 0);
});
