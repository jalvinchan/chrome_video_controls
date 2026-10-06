import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioGraph } from "../src/core/audio-graph.js";
import { GainLevel } from "../src/model/gain-level.js";

function audioParam(value) {
  return {
    value,
    events: [],
    setTargetAtTime(next, time, constant) {
      this.events.push({ next, time, constant });
      this.value = next;
    },
  };
}

function node(kind) {
  return {
    kind,
    gain: audioParam(1),
    threshold: audioParam(0),
    knee: audioParam(0),
    ratio: audioParam(1),
    attack: audioParam(0),
    release: audioParam(0),
    connections: [],
    connect(other) {
      this.connections.push(other);
      return other;
    },
    disconnect() {
      this.connections = [];
    },
  };
}

function fakeContext() {
  return {
    state: "running",
    currentTime: 4,
    destination: { kind: "destination" },
    closed: false,
    createMediaStreamSource(stream) {
      const created = node("source");
      created.stream = stream;
      return created;
    },
    createGain() {
      return node("gain");
    },
    createDynamicsCompressor() {
      return node("compressor");
    },
    resume() {
      this.state = "running";
      return Promise.resolve();
    },
    close() {
      this.state = "closed";
      this.closed = true;
      return Promise.resolve();
    },
  };
}

test("playback applies decibel gain before the retained compressor", async () => {
  const context = fakeContext();
  const graph = new AudioGraph(context);
  const stream = { id: "tab" };
  await graph.start(stream, new GainLevel(3));

  assert.equal(graph.source.stream, stream);
  assert.equal(graph.gain.gain.value, 10);
  assert.deepEqual(graph.source.connections, [graph.gain]);
  assert.deepEqual(graph.gain.connections, [graph.compressor]);
  assert.deepEqual(graph.compressor.connections, [context.destination]);
  assert.equal(graph.compressor.threshold.value, -1);
  assert.equal(graph.compressor.ratio.value, 20);

  graph.setGain(new GainLevel(1));
  assert.deepEqual(graph.gain.gain.events, [{ next: 1, time: 4, constant: 0.015 }]);
  graph.setGain(new GainLevel(0));
  assert.deepEqual(graph.gain.gain.events.at(-1), { next: 0, time: 4, constant: 0.015 });
});

test("a suspended context is resumed before the tab is connected", async () => {
  const context = fakeContext();
  context.state = "suspended";
  const graph = new AudioGraph(context);
  await graph.start({}, new GainLevel(1));
  assert.equal(context.state, "running");
});

test("gain cannot change before playback, and stop closes the context", async () => {
  const context = fakeContext();
  const graph = new AudioGraph(context);
  assert.throws(() => graph.setGain(new GainLevel(1)), /not running/);
  await graph.start({}, new GainLevel(1));
  const source = graph.source;
  await graph.stop();
  assert.equal(source.connections.length, 0);
  assert.equal(context.closed, true);
  assert.equal(graph.gain, null);
});
