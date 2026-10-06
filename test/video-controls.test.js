import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import { playbackRate } from "../src/model/playback-rate.js";
import { ChromeVideoStage } from "../src/video/chrome-video-stage.js";
import { handleVideoCommand } from "../src/app/video-commands.js";
import { isAmplifierMessage } from "../src/model/message-kinds.js";

const source = await readFile(new URL("../src/entrypoint/video.js", import.meta.url), "utf8");

function fakeVideo({ width = 640, paused = false } = {}) {
  const events = new Map();
  const frames = new Map();
  let nextFrame = 0;
  let time = 0;
  return {
    isConnected: true, paused, ended: false, playbackRate: 1, defaultPlaybackRate: 1,
    preservesPitch: false, duration: 120, readyState: 4, seeking: false, currentSrc: "https://example.com/video.mp4",
    seekable: { length: 1, start: () => 0, end: () => 120 }, seeks: 0, plays: 0,
    get currentTime() { return time; },
    set currentTime(value) { time = value; this.seeks += 1; this.seeking = true; this.ended = false; },
    advance(value) { time = value; },
    async play() { this.plays += 1; this.paused = false; this.fire("play"); },
    requestVideoFrameCallback(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelVideoFrameCallback(id) { frames.delete(id); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); },
    addEventListener(name, handler) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      events.get(name)?.delete(handler);
      if (!events.get(name)?.size) events.delete(name);
    },
    getBoundingClientRect() { return { width, height: 360 }; },
    fire(name) {
      if (name === "seeked") this.seeking = false;
      for (const handler of events.get(name) ?? []) handler({ type: name, currentTarget: this });
    },
    events, frames,
  };
}

async function page(initial = {}, videos = [fakeVideo()]) {
  const stored = { ...initial };
  const listeners = [];
  let changed;
  let observe;
  let failSave = false;
  const notifications = [];
  const navigation = new Map();
  const timers = new Map();
  const animations = new Map();
  let nextCallback = 0;
  const context = vm.createContext({
    console,
    URL,
    document: { documentElement: {}, URL: "https://www.example.com/watch?v=1", querySelectorAll: () => videos },
    addEventListener: (name, handler) => navigation.set(name, handler),
    setTimeout(callback) { timers.set(++nextCallback, callback); return nextCallback; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(callback) { animations.set(++nextCallback, callback); return nextCallback; },
    cancelAnimationFrame: (id) => animations.delete(id),
    MutationObserver: class {
      constructor(callback) { observe = callback; }
      observe() {}
    },
    chrome: {
      storage: {
        local: {
          async get() { return { ...stored }; },
          async set(values) {
            if (failSave) throw new Error("Storage unavailable");
            const changes = {};
            for (const [key, value] of Object.entries(values)) {
              changes[key] = { oldValue: stored[key], newValue: value };
              stored[key] = value;
            }
            changed(changes, "local");
          },
        },
        onChanged: { addListener(callback) { changed = callback; } },
      },
      runtime: {
        onMessage: { addListener(callback) { listeners.push(callback); } },
        async sendMessage(message) { notifications.push(message); },
      },
    },
  });
  vm.runInContext(source, context);
  async function send(message) {
    const response = await new Promise((resolve) => {
      assert.equal(listeners[0]({ target: "video", ...message }, {}, resolve), true);
    });
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }
  await send({ type: "snapshot" });
  return {
    videos, stored, context, listeners, send, notifications, timers, animations,
    navigate: (event = "popstate") => navigation.get(event)(),
    tick() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
    scan: () => observe([{ type: "childList" }]),
    changePreference: (rate) => changed({ playbackRate: { newValue: rate } }, "local"),
    failSaving: () => { failSave = true; },
  };
}

test("speed normalizes fine steps and rejects invalid input", () => {
  assert.equal(playbackRate(3), 3);
  assert.equal(playbackRate(3.12), 3.1);
  assert.equal(playbackRate(0), 0.25);
  assert.equal(playbackRate(100), 4);
  for (const value of [NaN, Infinity, "3", null]) assert.throws(() => playbackRate(value), /finite/);
});

test("remembered speed and pitch survive new sources, replacement players, and reinjection", async () => {
  const current = await page({ playbackRate: 3 });
  const first = current.videos[0];
  assert.equal(first.playbackRate, 3);
  assert.equal(first.defaultPlaybackRate, 3);
  assert.equal(first.preservesPitch, true);
  first.playbackRate = 1;
  first.fire("loadedmetadata");
  assert.equal(first.playbackRate, 3);
  first.playbackRate = 2;
  first.fire("play");
  assert.equal(first.playbackRate, 3);

  first.isConnected = false;
  const replacement = fakeVideo();
  current.videos.splice(0, 1, replacement);
  current.scan();
  assert.equal(replacement.playbackRate, 3);
  assert.equal(first.events.size, 0);
  vm.runInContext(source, current.context);
  assert.equal(current.listeners.length, 1);
});

test("no-video pages can save speed and rapid shortcuts accumulate at the bounds", async () => {
  const current = await page({}, []);
  const saved = await current.send({ type: "setRate", rate: 3.5 });
  assert.equal(saved.available, false);
  assert.equal(saved.rate, 3.5);
  assert.equal(current.stored.playbackRate, 3.5);
  current.videos.push(fakeVideo());
  current.scan();
  assert.equal(current.videos[0].playbackRate, 3.5);
  await Promise.all([
    current.send({ type: "adjustRate", delta: 0.25 }),
    current.send({ type: "adjustRate", delta: 0.25 }),
    current.send({ type: "adjustRate", delta: 0.25 }),
  ]);
  assert.equal(current.videos[0].playbackRate, 4);
  await current.send({ type: "setRate", rate: 1 });
  assert.equal(current.videos[0].playbackRate, 1);
  assert.equal(current.stored.playbackRate, 1);
});

test("a preference from another tab affects the next video, not current playback", async () => {
  const current = await page({ playbackRate: 2 });
  current.changePreference(3);
  assert.equal(current.videos[0].playbackRate, 2);
  current.videos[0].fire("play");
  assert.equal(current.videos[0].playbackRate, 2);
  const next = fakeVideo();
  current.videos.push(next);
  current.scan();
  assert.equal(next.playbackRate, 3);
});

test("failed saves restore speed and malformed messages do not poison later controls", async () => {
  const current = await page({ playbackRate: 2 });
  await assert.rejects(current.send({ type: "setRate", rate: NaN }), /finite/);
  await assert.rejects(current.send({ type: "adjustRate", delta: "1" }), /finite/);
  await assert.rejects(current.send({ type: "other" }), /Unknown/);
  assert.equal((await current.send({ type: "setRate", rate: 3 })).rate, 3);
  current.failSaving();
  await assert.rejects(current.send({ type: "setRate", rate: 4 }), /Storage unavailable/);
  assert.equal(current.videos[0].playbackRate, 3);
  assert.equal(current.stored.playbackRate, 3);
});

test("primary video prefers visible playing content over a larger paused player", async () => {
  const playing = fakeVideo({ width: 640 });
  const paused = fakeVideo({ width: 1920, paused: true });
  const current = await page({}, [paused, playing]);
  paused.playbackRate = 2;
  playing.playbackRate = 3;
  assert.equal((await current.send({ type: "snapshot" })).rate, 3);
});

test("speed commands reach the content script without touching audio capture", async () => {
  const calls = [];
  let installed = false;
  const video = new ChromeVideoStage({
    scripting: { async executeScript(options) { calls.push(options); installed = true; } },
    tabs: {
      async sendMessage(tabId, message, options) {
        assert.equal(tabId, 7);
        assert.equal(options.frameId, 0);
        if (!installed) throw new Error("Receiving end does not exist");
        calls.push(message);
        return { ok: true, result: { available: true, rate: 3 } };
      },
    },
  });
  const audio = { start() { assert.fail("Speed must not capture audio"); } };
  await handleVideoCommand({ audio, video }, "speed-up", { id: 7 });
  assert.equal(calls[1].delta, 0.25);
  assert.equal(calls[1].target, "video");
  await video.setRate(7, 3.12);
  assert.equal(calls[2].rate, 3.1);
  assert.equal(calls.length, 3, "Already-installed controls are not reinjected");
  assert.equal(isAmplifierMessage({ target: "video", type: "snapshot" }), false);
  assert.equal(isAmplifierMessage({ type: "snapshot" }), true);
});

test("rapid popup changes reach the page in order and recover after an error", async () => {
  const rates = [];
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const video = new ChromeVideoStage({
    tabs: {
      async sendMessage(_id, message) {
        if (message.rate === 2) await first;
        rates.push(message.rate);
        if (message.rate === 3) return { ok: false, error: "Player unavailable" };
        return { ok: true, result: { rate: message.rate } };
      },
    },
  });
  const firstChange = video.setRate(7, 2);
  const secondChange = video.setRate(7, 4);
  await Promise.resolve();
  assert.deepEqual(rates, []);
  release();
  await Promise.all([firstChange, secondChange]);
  assert.deepEqual(rates, [2, 4]);
  await assert.rejects(video.setRate(7, 3), /Player unavailable/);
  assert.equal((await video.setRate(7, 1)).rate, 1);
});

test("volume shortcuts switch capture to the active tab and reset preserves capture", async () => {
  const calls = [];
  const tab = { id: 7, url: "https://www.example.com/watch?v=1", title: "Video" };
  const audio = {
    async start(target) { calls.push(["start", target.id]); return { sliderValue: 2.5 }; },
    async setLevel(value) { calls.push(["level", value]); },
  };
  const video = { async resetControls(id) { calls.push(["reset", id]); } };
  await handleVideoCommand({ audio, video }, "volume-up", tab);
  await handleVideoCommand({ audio, video }, "reset-controls", tab);
  assert.deepEqual(calls, [["start", 7], ["level", 3], ["reset", 7], ["level", 1]]);
  await assert.rejects(handleVideoCommand({ audio, video }, "volume-up", { id: 1, url: "chrome://extensions" }), /cannot/);
  await assert.rejects(handleVideoCommand({ audio, video }, "speed-up", {}), /Open a web page/);
});

async function selectLoop(current, a = 10, b = 12) {
  const video = current.videos[0];
  video.advance(a);
  await current.send({ type: "setLoopA" });
  video.advance(b);
  return current.send({ type: "setLoopB" });
}

test("A–B repeat loops at 1× and 3× without changing speed, pitch, or saved settings", async () => {
  for (const rate of [1, 3]) {
    const current = await page({ playbackRate: rate, sliderValue: 2.5 });
    const state = await selectLoop(current);
    assert.equal(state.loop.active, true);
    assert.equal(state.loop.a, 10);
    assert.equal(state.loop.b, 12);
    const video = current.videos[0];
    video.frame();
    assert.equal(video.currentTime, 10);
    assert.equal(video.playbackRate, rate);
    assert.equal(video.preservesPitch, true);
    assert.equal(video.plays, 0);
    assert.deepEqual(current.stored, { playbackRate: rate, sliderValue: 2.5 });
    assert.equal(current.timers.size, 1);
    assert.equal(video.frames.size, 1);
    const notificationCount = current.notifications.length;
    video.advance(12.1);
    video.frame();
    current.tick();
    video.fire("timeupdate");
    assert.equal(video.seeks, 1, "Do not seek again while the previous seek is pending");
    video.advance(10);
    video.fire("seeked");
    video.advance(12.2);
    video.fire("timeupdate");
    assert.equal(video.seeks, 2);
    assert.equal(current.notifications.length, notificationCount, "Playback frames must not refresh the popup");
  }
});

test("marking and clearing endpoints preserve an explicit pause and reopening retains the loop", async () => {
  const video = fakeVideo({ paused: true });
  const current = await page({}, [video]);
  await selectLoop(current);
  video.fire("timeupdate");
  current.tick();
  assert.equal(video.seeks, 0);
  assert.equal(video.plays, 0);
  assert.equal(video.frames.size, 0);
  assert.equal((await current.send({ type: "snapshot" })).loop.active, true);
  vm.runInContext(source, current.context);
  assert.equal((await current.send({ type: "snapshot" })).loop.a, 10);
  await current.send({ type: "clearLoop" });
  assert.equal(video.paused, true);
  assert.equal(video.plays, 0);
  assert.equal((await current.send({ type: "snapshot" })).loop.active, false);
});

test("invalid endpoints and unavailable media produce actionable errors without replacing the selection", async () => {
  const current = await page({}, [fakeVideo({ paused: true })]);
  const video = current.videos[0];
  await assert.rejects(current.send({ type: "setLoopB" }), /Set A/);
  await selectLoop(current);
  for (const time of [10, 9]) {
    video.advance(time);
    await assert.rejects(current.send({ type: "setLoopB" }), /B must be after A/);
  }
  assert.equal((await current.send({ type: "snapshot" })).loop.b, 12);
  for (const time of [NaN, -1, 121]) {
    video.advance(time);
    await assert.rejects(current.send({ type: "setLoopA" }), /duration/);
  }
  video.advance(20);
  video.duration = Infinity;
  await assert.rejects(current.send({ type: "setLoopA" }), /on-demand/);
  video.duration = NaN;
  await assert.rejects(current.send({ type: "setLoopA" }), /on-demand/);
  video.duration = 120;
  video.seekable.length = 0;
  await assert.rejects(current.send({ type: "setLoopA" }), /seekable/);
  video.seekable.length = 1;
  video.seeking = true;
  await assert.rejects(current.send({ type: "setLoopA" }), /seek to finish/);
  const empty = await page({}, []);
  await assert.rejects(empty.send({ type: "setLoopA" }), /No video/);
  assert.equal((await empty.send({ type: "clearLoop" })).loop.active, false);
});

test("A and B must share a seekable range and a lost range deactivates the loop", async () => {
  const current = await page({}, [fakeVideo({ paused: true })]);
  const video = current.videos[0];
  video.seekable = { length: 2, start: (i) => i ? 20 : 0, end: (i) => i ? 120 : 15 };
  video.advance(10);
  await current.send({ type: "setLoopA" });
  video.advance(25);
  await assert.rejects(current.send({ type: "setLoopB" }), /seekable/);
  video.advance(12);
  await current.send({ type: "setLoopB" });
  video.seekable.length = 0;
  video.fire("progress");
  const state = await current.send({ type: "snapshot" });
  assert.equal(state.loop.active, false);
  assert.match(state.loop.error, /seekable/);
  await current.send({ type: "clearLoop" });
  assert.equal((await current.send({ type: "snapshot" })).loop.error, null);
});

test("clearing cancels callbacks and prevents queued callbacks or rapid actions from reviving a loop", async () => {
  const current = await page();
  await selectLoop(current);
  const video = current.videos[0];
  const lateFrame = [...video.frames.values()][0];
  const lateTimer = [...current.timers.values()][0];
  await current.send({ type: "clearLoop" });
  video.advance(30);
  lateFrame();
  lateTimer();
  video.fire("timeupdate");
  assert.equal(video.seeks, 0);
  assert.equal(video.frames.size, 0);
  assert.equal(current.timers.size, 0);
  video.advance(40);
  await Promise.all([current.send({ type: "setLoopA" }), current.send({ type: "clearLoop" }),
    current.send({ type: "setLoopA" })]);
  const state = await current.send({ type: "snapshot" });
  assert.equal(state.loop.a, 40);
  assert.equal(state.loop.b, null);
});

test("source replacement, navigation and removed videos clear the old loop", async () => {
  const transitions = [
    (current, video) => video.fire("loadedmetadata"),
    (current, video) => video.fire("emptied"),
    (current, video) => video.fire("loadstart"),
    (current, video) => { video.currentSrc = "https://example.com/next.mp4"; video.frame(); },
    (current) => current.navigate(),
    (current) => current.navigate("popstate"),
    (current) => { current.context.document.URL = "https://www.example.com/watch?v=2"; current.tick(); },
    (current, video) => { video.isConnected = false; current.videos.splice(0, 1, fakeVideo()); current.scan(); },
  ];
  for (const transition of transitions) {
    const current = await page();
    await selectLoop(current);
    const video = current.videos[0];
    transition(current, video);
    assert.equal((await current.send({ type: "snapshot" })).loop.a, null);
    assert.equal(video.frames.size, 0);
    assert.equal(current.timers.size, 0);
    assert.equal(current.notifications.at(-1).type, "videoControlsChanged");
  }
});

test("loop ownership stays with the selected video and never changes other tabs", async () => {
  const first = fakeVideo({ paused: true });
  const larger = fakeVideo({ paused: true, width: 1920 });
  const current = await page({}, [first, larger]);
  const otherTab = await page();
  larger.advance(5);
  await current.send({ type: "setLoopA" });
  larger.advance(8);
  await current.send({ type: "setLoopB" });
  assert.equal((await otherTab.send({ type: "snapshot" })).loop.a, null);
  first.paused = false;
  assert.equal((await current.send({ type: "snapshot" })).loop.a, null);
  await assert.rejects(current.send({ type: "setLoopB" }), /Set A/);
  first.advance(20);
  await current.send({ type: "setLoopA" });
  assert.equal((await current.send({ type: "snapshot" })).loop.a, 20);
  assert.equal(larger.seeks, 0);
});

test("watchdog and animation fallback check boundaries when video frame callbacks are unavailable", async () => {
  const video = fakeVideo();
  video.requestVideoFrameCallback = undefined;
  const current = await page({}, [video]);
  await selectLoop(current);
  assert.equal(current.animations.size, 1);
  current.tick();
  assert.equal(video.currentTime, 10);
  video.fire("seeked");
  video.paused = true;
  video.fire("pause");
  assert.equal(current.animations.size, 0);
  assert.equal(current.timers.size, 0);
  video.advance(12);
  video.fire("timeupdate");
  assert.equal(video.seeks, 1);
  await video.play();
  assert.equal(video.seeks, 2);
});

test("a loop ending at duration restarts natural end but never resumes an explicit pause", async () => {
  const current = await page();
  const video = current.videos[0];
  await selectLoop(current, 118, 120);
  video.paused = true;
  video.ended = true;
  video.fire("pause");
  video.fire("ended");
  assert.equal(video.currentTime, 118);
  assert.equal(video.plays, 1);
  video.fire("seeked");
  video.paused = true;
  video.fire("pause");
  video.advance(120);
  video.ended = true;
  video.fire("ended");
  assert.equal(video.plays, 1);
});

test("reset clears loop and restores normal speed without starting paused playback", async () => {
  const current = await page({ playbackRate: 3 }, [fakeVideo({ paused: true })]);
  await selectLoop(current);
  const state = await current.send({ type: "resetControls" });
  assert.equal(state.rate, 1);
  assert.equal(state.loop.a, null);
  assert.equal(current.videos[0].plays, 0);
});

test("speed changes retain the active loop and seeking failures deactivate it", async () => {
  const current = await page();
  await selectLoop(current);
  const state = await current.send({ type: "setRate", rate: 3 });
  assert.equal(state.loop.active, true);
  assert.equal(state.rate, 3);
  const video = current.videos[0];
  video.advance(12);
  Object.defineProperty(video, "currentTime", { get: () => 12, set() { throw new Error("Seek failed"); } });
  video.frame();
  const failed = await current.send({ type: "snapshot" });
  assert.equal(failed.loop.active, false);
  assert.match(failed.loop.error, /Couldn't seek to A/);
  assert.equal(current.timers.size, 0);
  assert.equal(video.frames.size, 0);
});

test("loop shortcuts use the existing main-frame message path without audio capture", async () => {
  const calls = [];
  const video = new ChromeVideoStage({ tabs: {
    async sendMessage(tabId, message, options) {
      calls.push({ tabId, message, options });
      return { ok: true, result: {} };
    },
  } });
  const audio = { start() { assert.fail("Loop controls must not capture audio"); } };
  for (const command of ["loop-set-a", "loop-set-b", "loop-clear"]) {
    await handleVideoCommand({ audio, video }, command, { id: 7 });
  }
  assert.deepEqual(calls.map(({ message }) => message.type), ["setLoopA", "setLoopB", "clearLoop"]);
  for (const call of calls) {
    assert.equal(call.tabId, 7);
    assert.equal(call.message.target, "video");
    assert.equal(call.options.frameId, 0);
  }
});

test("bookmark capture reads the latest time and keeps a paused video paused", async () => {
  const video = fakeVideo({ paused: true });
  const current = await page({ playbackRate: 3 }, [video]);
  const state = await current.send({ type: "snapshot" });
  assert.equal(state.bookmarkKey, "media:https://example.com/video.mp4");
  video.advance(15.125);
  const point = await current.send({ type: "captureBookmark", key: state.bookmarkKey });
  assert.equal(point.time, 15.125);
  assert.equal(point.key, "media:https://example.com/video.mp4");
  assert.equal(video.plays, 0);
  assert.equal(video.seeks, 0);
  assert.equal(video.playbackRate, 3);
  assert.deepEqual(current.stored, { playbackRate: 3 });
});

test("direct media identities follow stable source URLs and decline unsupported sources and unloaded media", async () => {
  const current = await page();
  const video = current.videos[0];
  current.context.document.URL = "https://example.com/player";
  video.fire("loadedmetadata");
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, "media:https://example.com/video.mp4");
  for (const source of ["", "data:video/mp4;base64,abc"]) {
    video.currentSrc = source;
    video.fire("loadedmetadata");
    assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, null);
    await assert.rejects(current.send({ type: "captureBookmark", key: "old" }), /stable video address/);
  }
  video.currentSrc = "https://example.com/video.mp4";
  video.readyState = 0;
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, null);
  video.readyState = 4;
  video.duration = Infinity;
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, null);
});

test("temporary video sources use a persistent page identity across source reloads", async () => {
  const current = await page({}, [fakeVideo({ paused: true })]);
  const video = current.videos[0];
  current.context.document.URL = "https://example.com/watch?id=10&episode=5#time";
  video.currentSrc = "blob:https://example.com/first-session";
  video.fire("loadedmetadata");
  const key = (await current.send({ type: "snapshot" })).bookmarkKey;
  assert.equal(key, "page:https://example.com/watch?episode=5&id=10");
  video.advance(51.5);
  assert.equal((await current.send({ type: "captureBookmark", key })).time, 51.5);
  video.fire("loadstart");
  video.currentSrc = "blob:https://example.com/next-session";
  await assert.rejects(current.send({ type: "seekBookmark", key, time: 51.5 }), /new video/);
  video.fire("loadedmetadata");
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, key);
  await current.send({ type: "seekBookmark", key, time: 51.5 });
  assert.equal(video.currentTime, 51.5);
  assert.equal(video.paused, true);
  assert.equal(video.plays, 0);
  const reloaded = fakeVideo({ paused: true });
  reloaded.currentSrc = "blob:https://example.com/another-session";
  const reopened = await page({}, [reloaded]);
  reopened.context.document.URL = "https://example.com/watch?episode=5&id=10";
  reloaded.fire("loadedmetadata");
  assert.equal((await reopened.send({ type: "snapshot" })).bookmarkKey, key);
});

test("page bookmark identities distinguish content parameters and hash routes", async () => {
  const current = await page();
  const video = current.videos[0];
  video.currentSrc = "blob:https://example.com/session";
  current.context.document.URL = "https://example.com/watch?episode=1";
  video.fire("loadedmetadata");
  const key = (await current.send({ type: "snapshot" })).bookmarkKey;
  current.context.document.URL = "https://example.com/watch?episode=2";
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, null);
  await assert.rejects(current.send({ type: "seekBookmark", key, time: 10 }), /new video/);
  video.fire("loadedmetadata");
  assert.notEqual((await current.send({ type: "snapshot" })).bookmarkKey, key);
  current.context.document.URL = "https://example.com/#/watch/1";
  video.fire("loadedmetadata");
  const route = (await current.send({ type: "snapshot" })).bookmarkKey;
  current.context.document.URL = "https://example.com/#/watch/2";
  video.fire("loadedmetadata");
  assert.notEqual((await current.send({ type: "snapshot" })).bookmarkKey, route);
});

test("page identity fallback declines ambiguous pages with several videos", async () => {
  const one = fakeVideo();
  const two = fakeVideo();
  one.currentSrc = "blob:https://example.com/first";
  two.currentSrc = "blob:https://example.com/second";
  const current = await page({}, [one, two]);
  current.context.document.URL = "https://example.com/watch";
  one.fire("loadedmetadata");
  two.fire("loadedmetadata");
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, null);
});

test("bookmark seeks preserve pause, speed and pitch and clear a loop only when jumping outside it", async () => {
  const video = fakeVideo({ paused: true });
  const current = await page({ playbackRate: 3, sliderValue: 2 }, [video]);
  await selectLoop(current, 10, 20);
  const inside = await current.send({ type: "seekBookmark", key: "media:https://example.com/video.mp4", time: 15 });
  assert.equal(inside.loop.active, true);
  assert.equal(video.currentTime, 15);
  video.fire("seeked");
  const outside = await current.send({ type: "seekBookmark", key: "media:https://example.com/video.mp4", time: 30 });
  assert.equal(outside.loop.active, false);
  assert.equal(video.currentTime, 30);
  assert.equal(video.paused, true);
  assert.equal(video.plays, 0);
  assert.equal(video.playbackRate, 3);
  assert.equal(video.preservesPitch, true);
  assert.deepEqual(current.stored, { playbackRate: 3, sliderValue: 2 });
});

test("invalid, unavailable and stale bookmark seeks fail without moving playback", async () => {
  const current = await page();
  const video = current.videos[0];
  for (const time of [NaN, Infinity, -1, 121, "10"]) {
    await assert.rejects(current.send({ type: "seekBookmark", key: "media:https://example.com/video.mp4", time }), /duration/);
  }
  video.seekable.length = 0;
  await assert.rejects(current.send({ type: "seekBookmark", key: "media:https://example.com/video.mp4", time: 10 }), /seekable/);
  video.seekable.length = 1;
  video.seeking = true;
  await assert.rejects(current.send({ type: "seekBookmark", key: "media:https://example.com/video.mp4", time: 10 }), /seek to finish/);
  await assert.rejects(current.send({ type: "captureBookmark", key: "media:https://example.com/video.mp4" }), /seek to finish/);
  video.seeking = false;
  current.navigate();
  assert.equal((await current.send({ type: "snapshot" })).bookmarkKey, null);
  await assert.rejects(current.send({ type: "captureBookmark", key: "media:https://example.com/video.mp4" }), /new video/);
  video.fire("loadedmetadata");
  assert.equal((await current.send({ type: "captureBookmark", key: "media:https://example.com/video.mp4" })).time, 0);
  assert.equal(video.seeks, 0);
});
