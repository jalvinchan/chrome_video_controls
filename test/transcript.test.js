import assert from "node:assert/strict";
import { test } from "node:test";
import { captionText, normalizeCues, parseSubtitleFile, formatTranscriptTime, MAX_TRANSCRIPT_BYTES } from "../src/transcript/transcript.js";
import { ChromeTranscriptRepository, TRANSCRIPT_PREFIX } from "../src/transcript/chrome-transcript-repository.js";
import { ChromeTranscriptSource } from "../src/transcript/chrome-transcript-source.js";

const srt = "1\n00:00:01,250 --> 00:00:03,500\n<b>First &amp; second</b>\nAnother line\n\n2\n00:01:05,000 --> 00:01:07,000\nFuture line";
const cues = [{ start: 1.25, end: 3.5, text: "First & second\nAnother line" }, { start: 65, end: 67, text: "Future line" }];

test("SRT import includes future and multiline cues with CRLF/BOM and formatting removed", () => {
  assert.deepEqual(parseSubtitleFile("\uFEFF" + srt.replaceAll("\n", "\r\n")), cues);
  assert.equal(captionText('<v Alice><i>A</i> &lt;img src=x&gt; &#128512;'), "A <img src=x> 😀");
  assert.throws(() => captionText(undefined), /unreadable text cue/);
});

test("VTT imports cue IDs/settings and skips headers, comments, styles and regions", () => {
  const file = "WEBVTT Test\nLanguage: en\n\nNOTE comment\nIgnore me\n\nSTYLE\n::cue { color:red; }\n\nREGION\nid:bottom\n\nsecond\n01:05.000 --> 01:07.000 line:20%\nFuture line\n\nfirst\n00:01.250 --> 00:03.500 align:start\n<b>First &amp; second</b>\nAnother line";
  assert.deepEqual(parseSubtitleFile(file), cues);
});

test("malformed files fail rather than silently dropping invalid cues", () => {
  for (const file of ["", "not subtitles", "WEBVTT", "1\n00:99:01,000 --> 00:99:02,000\nBad", "1\n00:00:03,000 --> 00:00:01,000\nBad", srt + "\n\n3\nBad cue"] ) {
    assert.throws(() => parseSubtitleFile(file));
  }
  assert.throws(() => parseSubtitleFile("a".repeat(MAX_TRANSCRIPT_BYTES + 1)), /2 MB/);
  assert.throws(() => normalizeCues(Array(20001).fill(cues[0])), /20,000/);
  assert.throws(() => normalizeCues([{ start: 1, end: Infinity, text: "Bad" }]), /invalid/);
});

test("imports persist per video and reject invalid replacement without discarding a saved transcript", async () => {
  const data = {};
  let failed = false;
  const storage = { async get(key) { return structuredClone({ [key]: data[key] }); }, async set(value) {
    if (failed) throw new Error("Storage quota");
    Object.assign(data, structuredClone(value));
  }, async remove(key) { delete data[key]; } };
  const repository = new ChromeTranscriptRepository(storage);
  await repository.save("media:first", "first.srt", cues);
  await repository.save("media:other", "other.vtt", [cues[1]]);
  assert.deepEqual(await new ChromeTranscriptRepository(storage).load("media:first"), { name: "first.srt", cues });
  failed = true;
  await assert.rejects(repository.save("media:first", "replacement.srt", [cues[1]]), /quota/);
  failed = false;
  await assert.rejects(repository.save("media:first", "invalid.srt", [{ start: -1, end: 2, text: "Bad" }]), /invalid/);
  assert.deepEqual((await repository.load("media:first")).cues, cues);
  await repository.remove("media:first");
  assert.equal(await repository.load("media:first"), null);
  assert.equal((await repository.load("media:other")).name, "other.vtt");
  data[TRANSCRIPT_PREFIX + "media:corrupt"] = { version: 7 };
  await assert.rejects(repository.load("media:corrupt"), /could not be read/);
  await assert.rejects(repository.load(null), /loaded video/);
});

test("caption source verifies video identity again after a delayed read", async () => {
  let key = "media:first";
  const source = new ChromeTranscriptSource({ async readTranscriptTrack() {
    key = "media:other";
    return [{ start: 1, end: 2, text: "<i>Future</i>" }];
  }, async snapshot() { return { bookmarkKey: key }; } });
  await assert.rejects(source.read(5, "media:first", "native:0"), /video changed/);
});
