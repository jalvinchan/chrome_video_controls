import assert from "node:assert/strict";
import { test } from "node:test";
import { AmplifierController } from "../src/app/amplifier-controller.js";
import { handleAmplifierMessage } from "../src/app/amplifier-messages.js";
import { AmplifierClient } from "../src/app/amplifier-client.js";
import { ChromeSitePreferences, sitePreferenceKey } from "../src/storage/chrome-site-preferences.js";
import { ChromeLevelRepository } from "../src/storage/chrome-level-repository.js";

function memoryStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(keys) {
      const result = {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
      }
      return result;
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    snapshot() {
      return data;
    },
  };
}

class FakeCapture {
  constructor() {
    this.calls = [];
    this.error = null;
  }

  async getStreamId(tabId) {
    this.calls.push(tabId);
    if (this.error) throw new Error(this.error);
    return `stream-${tabId}`;
  }
}

class FakeStage {
  constructor({ open = false } = {}) {
    this.opened = open;
    this.playing = null;
    this.sliderValue = null;
    this.halted = 0;
    this.failPlay = null;
  }

  async open() {
    this.opened = true;
  }

  async isOpen() {
    return this.opened;
  }

  async play(streamId, level) {
    if (this.failPlay) throw new Error(this.failPlay);
    this.playing = streamId;
    this.sliderValue = level.sliderValue;
  }

  async setGain(level) {
    if (!this.playing) throw new Error("not running");
    this.sliderValue = level.sliderValue;
  }

  async halt() {
    this.halted += 1;
    this.playing = null;
    this.opened = false;
  }
}

function setup(stored = {}, stage = new FakeStage()) {
  const storage = memoryStorage(stored);
  const capture = new FakeCapture();
  const controller = new AmplifierController({
    repository: new ChromeLevelRepository(storage),
    preferences: new ChromeSitePreferences(storage),
    capture,
    stage,
  });
  return { storage, capture, stage, controller };
}

const videoTab = { id: 7, url: "https://www.example.com/watch?v=1", title: "Lo-fi" };

test("gain defaults belong to the selected site and never change another captured tab", async () => {
  const { controller, capture, stage, storage } = setup({ sliderValue: 1.5 });
  const other = { id: 8, url: "https://example.com/video", title: "Talk" };
  await controller.setLevel(0, videoTab);
  assert.deepEqual(capture.calls, [], "Saving gain must not start capture");
  await controller.start(videoTab);
  const selected = await controller.setLevel(3, other);
  assert.equal(selected.sliderValue, 3);
  assert.equal(selected.capturedSliderValue, 0);
  assert.equal(stage.sliderValue, 0);
  assert.equal((await controller.snapshot(videoTab)).sliderValue, 0);
  await controller.start(other);
  assert.equal(stage.sliderValue, 3);
  assert.equal(storage.snapshot().sliderValue, 1.5, "Keep the legacy fallback unchanged");
  await controller.stop();
  const restarted = setup(storage.snapshot());
  assert.equal((await restarted.controller.snapshot(videoTab)).sliderValue, 0);
  await restarted.controller.start(videoTab);
  assert.equal(restarted.stage.sliderValue, 0);
});

test("captured navigation selects the destination site's gain and survives worker restart", async () => {
  const { controller, storage } = setup({ sliderValue: 1.5 });
  const other = { ...videoTab, url: "https://example.com/video", title: "Talk" };
  await controller.setLevel(0.5, other);
  await controller.setLevel(3, videoTab);
  await controller.start(videoTab);
  const stage = new FakeStage({ open: true });
  stage.playing = "stream-7";
  const restarted = setup(storage.snapshot(), stage);
  await restarted.controller.tabNavigated(other);
  assert.equal(stage.sliderValue, 0.5);
  await restarted.controller.setLevel(2, other);
  await restarted.controller.tabNavigated({ ...other, url: "https://example.com/next" });
  assert.equal(stage.sliderValue, 2);
  await restarted.controller.tabNavigated(videoTab);
  assert.equal(stage.sliderValue, 3);
  await restarted.controller.tabNavigated({ ...videoTab, url: "chrome://settings" });
  assert.equal((await restarted.controller.snapshot()).live, false);
});

test("resetting one site's gain preserves another site's preference and captured audio", async () => {
  const { controller, stage, storage } = setup();
  const other = { id: 8, url: "https://example.com" };
  await controller.setLevel(3, videoTab);
  await controller.setLevel(0, other);
  await controller.start(videoTab);
  await controller.setLevel(1, other);
  assert.equal(stage.sliderValue, 3);
  assert.equal((await controller.snapshot(other)).sliderValue, 1);
  assert.equal(storage.snapshot()[sitePreferenceKey(videoTab.url, "sliderValue")], 3);
});

test("opening controls on a newly granted site reconciles capture without a URL event", async () => {
  const { controller, capture, stage } = setup();
  const destination = { ...videoTab, url: "https://example.com/video" };
  await controller.setLevel(0.5, destination);
  await controller.setLevel(3, videoTab);
  await controller.start(videoTab);
  assert.equal((await controller.snapshot(destination)).sliderValue, 0.5);
  assert.equal(stage.sliderValue, 0.5);
  await controller.start(videoTab);
  assert.equal(stage.sliderValue, 3);
  assert.deepEqual(capture.calls, [7], "Reconcile the existing capture without recapturing");
});

test("a failed gain preference save restores captured gain and later changes still work", async () => {
  const { controller, stage } = setup();
  await controller.start(videoTab);
  const save = controller.preferences.saveLevel.bind(controller.preferences);
  controller.preferences.saveLevel = async () => { throw new Error("Storage unavailable"); };
  await assert.rejects(controller.setLevel(3, videoTab), /Storage unavailable/);
  assert.equal(stage.sliderValue, 1);
  assert.equal((await controller.snapshot(videoTab)).sliderValue, 1);
  controller.preferences.saveLevel = save;
  await controller.setLevel(2, videoTab);
  assert.equal(stage.sliderValue, 2);
});

test("starting a tab plays it at the remembered level and does not recapture it", async () => {
  const { controller, capture, stage, storage } = setup({ sliderValue: 1.5 });
  const started = await controller.start(videoTab);
  assert.equal(started.live, true);
  assert.equal(started.sliderValue, 1.5);
  assert.equal(started.title, "Lo-fi");
  assert.equal(stage.playing, "stream-7");
  assert.equal(storage.snapshot().tabId, 7);

  const again = await controller.start(videoTab);
  assert.equal(again.live, true);
  assert.deepEqual(capture.calls, [7]);
});

test("a second tab replaces the first, and stop returns audio to Chrome", async () => {
  const { controller, capture, stage, storage } = setup();
  await controller.start(videoTab);
  const other = { id: 8, url: "https://example.com", title: "Talk" };
  const switched = await controller.start(other);
  assert.equal(switched.tabId, 8);
  assert.equal(stage.playing, "stream-8");
  assert.deepEqual(capture.calls, [7, 8]);
  assert.equal(stage.halted, 1);

  const stopped = await controller.stop();
  assert.equal(stopped.live, false);
  assert.equal(stopped.sliderValue, 1);
  assert.equal(stage.playing, null);
  assert.equal(storage.snapshot().tabId, null);
  assert.equal(storage.snapshot().liveSliderValue, 1);
});

test("stop returns audio to Chrome without forgetting the site gain", async () => {
  for (const sliderValue of [3, 0]) {
    const { controller, stage, storage } = setup();
    await controller.start(videoTab);
    await controller.setLevel(sliderValue);

    const stopped = await controller.stop();
    assert.equal(stopped.live, false);
    assert.equal(stopped.sliderValue, 1);
    assert.equal(stage.playing, null);
    assert.equal(storage.snapshot().liveSliderValue, 1);

    const restarted = setup(storage.snapshot());
    assert.equal((await restarted.controller.snapshot()).sliderValue, 1);
    await restarted.controller.start(videoTab);
    assert.equal(restarted.stage.sliderValue, sliderValue);
  }
});

test("stop resets an idle level, while switching tabs keeps the selected gain", async () => {
  const { controller, stage, storage } = setup({ sliderValue: 2.5 });
  await controller.start(videoTab);
  const switched = await controller.start({ id: 8, url: "https://example.com", title: "Talk" });
  assert.equal(switched.sliderValue, 2.5);
  assert.equal(stage.sliderValue, 2.5);

  await controller.stop();
  await controller.setLevel(0);
  const stopped = await controller.stop();
  assert.equal(stopped.sliderValue, 1);
  assert.equal(storage.snapshot().liveSliderValue, 1);
});

test("browser pages are refused before capture, and a failed capture is rolled back", async () => {
  const { controller, capture, stage, storage } = setup();
  await assert.rejects(
    controller.start({ id: 1, url: "chrome://newtab", title: "New Tab" }),
    /cannot be amplified/,
  );
  assert.deepEqual(capture.calls, []);

  capture.error = "Cannot capture this tab";
  await assert.rejects(controller.start(videoTab), /Could not amplify this tab/);
  const snapshot = await controller.snapshot();
  assert.equal(snapshot.live, false);
  assert.equal(stage.playing, null);
  assert.equal(storage.snapshot().tabId, null);
});

test("the slider changes a live tab and is remembered while idle", async () => {
  const { controller, stage, storage } = setup();
  const idle = await controller.setLevel(0.5, videoTab);
  assert.equal(idle.live, false);
  assert.equal(idle.sliderValue, 0.5);
  assert.equal(stage.sliderValue, null);

  await controller.start(videoTab);
  const live = await controller.setLevel(3);
  assert.equal(live.sliderValue, 3);
  assert.equal(stage.sliderValue, 3);
  assert.equal(storage.snapshot().liveSliderValue, 3);

  const muted = await controller.setLevel(0);
  assert.equal(muted.live, true);
  assert.equal(muted.sliderValue, 0);
  assert.equal(stage.sliderValue, 0);
  assert.equal(storage.snapshot().liveSliderValue, 0);
});

test("legacy percentages reset to unity and new slider settings persist", async () => {
  const { controller, storage } = setup({ percent: 200 });
  assert.equal((await controller.snapshot()).sliderValue, 1);
  await controller.setLevel(2.5, videoTab);
  assert.equal(storage.snapshot().liveSliderValue, 2.5);
  const restarted = setup(storage.snapshot()).controller;
  assert.equal((await restarted.snapshot()).sliderValue, 2.5);

  const muted = setup({ sliderValue: 0 }).controller;
  assert.equal((await muted.snapshot()).sliderValue, 0);
  const invalid = setup({ sliderValue: Number.NaN }).controller;
  assert.equal((await invalid.snapshot()).sliderValue, 1);
});

test("closing the amplified tab releases it, and a dead offscreen document is forgotten", async () => {
  const { controller, storage } = setup();
  await controller.start(videoTab);
  await controller.tabClosed(3);
  assert.equal((await controller.snapshot()).live, true);
  await controller.tabClosed(7);
  assert.equal((await controller.snapshot()).live, false);

  storage.snapshot().tabId = 7;
  storage.snapshot().title = "Lo-fi";
  const restarted = setup(storage.snapshot(), new FakeStage({ open: false })).controller;
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.live, false);

  const stillOpen = setup(
    { sliderValue: 2, tabId: 7, title: "Lo-fi" },
    new FakeStage({ open: true }),
  );
  const recovered = await stillOpen.controller.snapshot();
  assert.equal(recovered.live, true);
  assert.equal(recovered.sliderValue, 2);
  assert.equal(recovered.title, "Lo-fi");
});

test("popup messages reach the controller and surface background errors", async () => {
  const { controller } = setup();
  const started = await handleAmplifierMessage(controller, { type: "start", tab: videoTab });
  assert.equal(started.live, true);
  const level = await handleAmplifierMessage(controller, { type: "setLevel", sliderValue: 2.5 });
  assert.equal(level.sliderValue, 2.5);
  const ended = await handleAmplifierMessage(controller, { type: "captureEnded" });
  assert.equal(ended.live, false);

  const client = new AmplifierClient({
    async sendMessage(message) {
      assert.equal(message.type, "snapshot");
      return { ok: false, error: "Amplifier audio did not respond." };
    },
  });
  await assert.rejects(client.snapshot(), /did not respond/);
});
