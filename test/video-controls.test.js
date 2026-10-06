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
  return {
    isConnected: true, paused, ended: false, playbackRate: 1, defaultPlaybackRate: 1,
    preservesPitch: false,
    addEventListener(name, handler) { events.set(name, handler); },
    removeEventListener(name, handler) { if (events.get(name) === handler) events.delete(name); },
    getBoundingClientRect() { return { width, height: 360 }; },
    fire(name) { events.get(name)?.({ type: name, currentTarget: this }); },
    events,
  };
}

async function page(initial = {}, videos = [fakeVideo()]) {
  const stored = { ...initial };
  const listeners = [];
  let changed;
  let observe;
  let failSave = false;
  const context = vm.createContext({
    console,
    document: { documentElement: {}, querySelectorAll: () => videos },
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
      runtime: { onMessage: { addListener(callback) { listeners.push(callback); } } },
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
    videos, stored, context, listeners, send,
    scan: () => observe(),
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
  const video = { async setRate(id, rate) { calls.push(["rate", id, rate]); } };
  await handleVideoCommand({ audio, video }, "volume-up", tab);
  await handleVideoCommand({ audio, video }, "reset-controls", tab);
  assert.deepEqual(calls, [["start", 7], ["level", 3], ["rate", 7, 1], ["level", 1]]);
  await assert.rejects(handleVideoCommand({ audio, video }, "volume-up", { id: 1, url: "chrome://extensions" }), /cannot/);
  await assert.rejects(handleVideoCommand({ audio, video }, "speed-up", {}), /Open a web page/);
});
