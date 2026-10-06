import assert from "node:assert/strict";
import { test } from "node:test";
import { ChromeBookmarkRepository, BOOKMARK_PREFIX, MAX_BOOKMARKS } from "../src/storage/chrome-bookmark-repository.js";
import { BookmarkClient } from "../src/app/bookmark-client.js";
import { handleBookmarkMessage } from "../src/app/bookmark-messages.js";

function storage(initial = {}) {
  const data = structuredClone(initial);
  let failure = false;
  return {
    data,
    fail(value = true) { failure = value; },
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(values) {
      if (failure) throw new Error("Storage unavailable");
      Object.assign(data, structuredClone(values));
    },
  };
}

function repository(store) {
  let serial = 0;
  return new ChromeBookmarkRepository(store, () => `bookmark-${++serial}`);
}

test("bookmarks persist by video, sort by time, and remove only the selected bookmark", async () => {
  const store = storage({ playbackRate: 3, sliderValue: 2 });
  const bookmarks = repository(store);
  const later = await bookmarks.save("media:first", 65.25, "  Chapter two  ");
  await bookmarks.save("media:first", 10.5);
  await bookmarks.save("media:second", 20, "Other video");
  assert.equal(later.item.note, "Chapter two");
  const reopened = repository(store);
  assert.deepEqual((await reopened.list("media:first")).map(({ time }) => time), [10.5, 65.25]);
  await reopened.remove("media:first", later.item.id);
  assert.deepEqual((await reopened.list("media:first")).map(({ time }) => time), [10.5]);
  assert.equal((await reopened.list("media:second"))[0].note, "Other video");
  assert.equal(store.data.playbackRate, 3);
  assert.equal(store.data.sliderValue, 2);
});

test("simultaneous saves and deletes preserve other writes, including writes after an error", async () => {
  const store = storage();
  const bookmarks = repository(store);
  const first = await bookmarks.save("media:one", 1, "First");
  await Promise.all([
    bookmarks.save("media:one", 3, "Third"),
    bookmarks.remove("media:one", first.item.id),
    bookmarks.save("media:one", 2, "Second"),
  ]);
  assert.deepEqual((await bookmarks.list("media:one")).map(({ time }) => time), [2, 3]);
  store.fail();
  await assert.rejects(bookmarks.save("media:one", 4, "Keep draft"), /Storage unavailable/);
  store.fail(false);
  await bookmarks.save("media:one", 5);
  assert.deepEqual((await bookmarks.list("media:one")).map(({ time }) => time), [2, 3, 5]);
});

test("bad input and unreadable records do not overwrite existing data", async () => {
  const store = storage();
  const bookmarks = repository(store);
  for (const time of [NaN, Infinity, -1, "2", null]) {
    await assert.rejects(bookmarks.save("media:one", time), /valid video time/);
  }
  for (const key of [null, "", "x".repeat(4097)]) await assert.rejects(bookmarks.list(key), /identity/);
  await assert.rejects(bookmarks.save("media:one", 1, "x".repeat(251)), /250 characters/);
  await assert.rejects(bookmarks.remove("media:one", null), /Choose a bookmark/);
  const bad = { broken: "data" };
  store.data[BOOKMARK_PREFIX + "media:one"] = bad;
  await assert.rejects(bookmarks.save("media:one", 1), /Couldn't read/);
  assert.deepEqual(store.data[BOOKMARK_PREFIX + "media:one"], bad);
});

test("per-video limits reject extra bookmarks without discarding existing ones", async () => {
  const store = storage({ [BOOKMARK_PREFIX + "media:one"]: Array.from({ length: MAX_BOOKMARKS }, (_, time) => ({ id: String(time), time, note: "" })) });
  const bookmarks = repository(store);
  await assert.rejects(bookmarks.save("media:one", 110), /100 bookmarks/);
  await bookmarks.remove("media:one", "0");
  await bookmarks.save("media:one", 110);
  assert.equal((await bookmarks.list("media:one")).length, MAX_BOOKMARKS);
});

test("bookmark clients reach the shared repository and surface errors", async () => {
  const bookmarks = repository(storage());
  const client = new BookmarkClient({ async sendMessage(message) {
    assert.equal(message.target, "bookmarks");
    try { return { ok: true, result: await handleBookmarkMessage(bookmarks, message) }; }
    catch (error) { return { ok: false, error: error.message }; }
  } });
  const saved = await client.save("media:one", 10, "Note");
  assert.equal((await client.list("media:one"))[0].id, saved.item.id);
  await client.remove("media:one", saved.item.id);
  assert.deepEqual(await client.list("media:one"), []);
  await assert.rejects(client.save("media:one", NaN), /valid video time/);
  await assert.rejects(handleBookmarkMessage(bookmarks, { type: "unknown" }), /Unknown/);
});
