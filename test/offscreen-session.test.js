import assert from "node:assert/strict";
import { test } from "node:test";
import { handleOffscreenMessage } from "../src/app/offscreen-messages.js";
import { OffscreenSession } from "../src/app/offscreen-session.js";
import { ChromeTabCapturePort } from "../src/capture/chrome-tab-capture-port.js";
import { ChromeTabStreamOpener } from "../src/capture/chrome-tab-stream-opener.js";
import { GainLevel } from "../src/model/gain-level.js";
import { ChromeAudioStage } from "../src/offscreen/chrome-audio-stage.js";

function fakeStream() {
  let ended;
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener(type, fn) {
      if (type === "ended") ended = fn;
    },
    end() {
      ended?.();
    },
  };
  return {
    track,
    getAudioTracks() {
      return [track];
    },
    getTracks() {
      return [track];
    },
  };
}

function fakeGraph() {
  const graph = {
    started: null,
    level: null,
    stopped: false,
    async start(stream, level) {
      graph.started = stream;
      graph.level = level;
    },
    setGain(level) {
      graph.level = level;
    },
    async stop() {
      graph.stopped = true;
    },
  };
  return graph;
}

test("playback stops the previous stream and notifies when the tab ends", async () => {
  const streams = [fakeStream(), fakeStream()];
  const graphs = [];
  let opened = 0;
  const session = new OffscreenSession({
    opener: {
      async open() {
        return streams[opened++];
      },
    },
    graphFactory() {
      const graph = fakeGraph();
      graphs.push(graph);
      return graph;
    },
  });
  let ended = 0;
  session.onEnded = () => {
    ended += 1;
  };

  await session.play("one", new GainLevel(2));
  await session.play("two", new GainLevel(1));
  assert.equal(streams[0].track.stopped, true);
  assert.equal(graphs[0].stopped, true);
  assert.equal(graphs[1].started, streams[1]);

  streams[1].track.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended, 1);
  assert.equal(streams[1].track.stopped, true);

  streams[1].track.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended, 1);
});

test("a failed open does not leave a live graph", async () => {
  const graph = fakeGraph();
  const session = new OffscreenSession({
    opener: {
      async open() {
        throw new Error("open tab audio: denied");
      },
    },
    graphFactory: () => graph,
  });
  await assert.rejects(session.play("x", new GainLevel(1)), /open tab audio: denied/);
  assert.equal(graph.stopped, true);
  await assert.rejects(
    handleOffscreenMessage(session, { type: "applyLevel", sliderValue: 1 }),
    /not running/,
  );
});

test("the chrome stage asks an offscreen document to play the stream id", async () => {
  const docs = [];
  const sent = [];
  const chrome = {
    offscreen: {
      async createDocument(options) {
        docs.push(options);
      },
      async closeDocument() {
        docs.pop();
      },
    },
    runtime: {
      async getContexts() {
        return docs.length ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [];
      },
      async sendMessage(message) {
        sent.push(message);
        return { ok: true, result: null };
      },
    },
  };
  const stage = new ChromeAudioStage(chrome);
  await stage.play("stream-7", new GainLevel(2.5));
  assert.equal(docs[0].url, "src/presentation/offscreen.html");
  assert.deepEqual(docs[0].reasons, ["USER_MEDIA", "AUDIO_PLAYBACK"]);
  assert.deepEqual(sent[0], {
    type: "play",
    target: "offscreen",
    streamId: "stream-7",
    sliderValue: 2.5,
  });
  await stage.setGain(new GainLevel(0));
  assert.deepEqual(sent.at(-1), {
    type: "applyLevel",
    target: "offscreen",
    sliderValue: 0,
  });
  await stage.halt();
  assert.equal(docs.length, 0);
  assert.equal(sent.at(-1).type, "halt");
});

test("tab capture passes the target tab, and the opener uses audio only", async () => {
  const port = new ChromeTabCapturePort({
    async getMediaStreamId(options) {
      return `id-${options.targetTabId}`;
    },
  });
  assert.equal(await port.getStreamId(4), "id-4");

  let constraints;
  const opener = new ChromeTabStreamOpener({
    async getUserMedia(requested) {
      constraints = requested;
      return { ok: true };
    },
  });
  await opener.open("stream-4");
  assert.equal(constraints.video, false);
  assert.equal(constraints.audio.mandatory.chromeMediaSource, "tab");
  assert.equal(constraints.audio.mandatory.chromeMediaSourceId, "stream-4");
});
