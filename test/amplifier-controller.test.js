import assert from "node:assert/strict";
import { test } from "node:test";
import { AmplifierController } from "../src/app/amplifier-controller.js";
import { handleAmplifierMessage } from "../src/app/amplifier-messages.js";
import { AmplifierClient } from "../src/app/amplifier-client.js";
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
    this.percent = null;
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
    this.percent = level.percent;
  }

  async setGain(level) {
    if (!this.playing) throw new Error("not running");
    this.percent = level.percent;
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
    capture,
    stage,
  });
  return { storage, capture, stage, controller };
}

const videoTab = { id: 7, url: "https://www.example.com/watch?v=1", title: "Lo-fi" };

test("starting a tab plays it at the remembered level and does not recapture it", async () => {
  const { controller, capture, stage, storage } = setup({ percent: 150 });
  const started = await controller.start(videoTab);
  assert.equal(started.live, true);
  assert.equal(started.percent, 150);
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
  assert.equal(stopped.percent, 200);
  assert.equal(stage.playing, null);
  assert.equal(storage.snapshot().tabId, null);
  assert.equal(storage.snapshot().percent, undefined);
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
  const idle = await controller.setLevel(80);
  assert.equal(idle.live, false);
  assert.equal(idle.percent, 80);
  assert.equal(stage.percent, null);

  await controller.start(videoTab);
  const live = await controller.setLevel(320);
  assert.equal(live.percent, 320);
  assert.equal(stage.percent, 320);
  assert.equal(storage.snapshot().percent, 320);
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
    { percent: 180, tabId: 7, title: "Lo-fi" },
    new FakeStage({ open: true }),
  );
  const recovered = await stillOpen.controller.snapshot();
  assert.equal(recovered.live, true);
  assert.equal(recovered.percent, 180);
  assert.equal(recovered.title, "Lo-fi");
});

test("popup messages reach the controller and surface background errors", async () => {
  const { controller } = setup();
  const started = await handleAmplifierMessage(controller, { type: "start", tab: videoTab });
  assert.equal(started.live, true);
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
