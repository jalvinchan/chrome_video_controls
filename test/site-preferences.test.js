import assert from "node:assert/strict";
import { test } from "node:test";
import { ChromeSitePreferences, sitePreferenceKey } from "../src/storage/chrome-site-preferences.js";
import { GainLevel } from "../src/model/gain-level.js";
import { handleSitePreferenceMessage } from "../src/app/site-preference-messages.js";

function setup(initial = {}) {
  const data = { ...initial };
  const storage = {
    async get(keys) { return Object.fromEntries(keys.map((key) => [key, data[key]])); },
    async set(values) { Object.assign(data, values); },
  };
  return { data, storage, preferences: new ChromeSitePreferences(storage) };
}

test("site preferences share paths, protocols and ports but keep hostnames separate", async () => {
  const { data, preferences } = setup({ playbackRate: 1.5, sliderValue: 2 });
  await preferences.saveRate("https://example.com/watch?a=1", 3);
  await preferences.saveLevel("https://example.com/other#video", new GainLevel(0));
  const sameHost = "http://EXAMPLE.com:8080/new";
  assert.equal((await preferences.loadRate(sameHost)).rate, 3);
  assert.equal((await preferences.loadLevel(sameHost)).sliderValue, 0);
  for (const url of ["https://other.com", "https://www.example.com"]) {
    assert.equal((await preferences.loadRate(url)).rate, 1.5);
    assert.equal((await preferences.loadLevel(url)).sliderValue, 2);
  }
  assert.equal(data.playbackRate, 1.5);
  assert.equal(data.sliderValue, 2);
});

test("speed and gain writes from separate instances cannot lose one another", async () => {
  const { storage, preferences } = setup();
  const other = new ChromeSitePreferences(storage);
  await Promise.all([
    preferences.saveRate("https://a.com", 2.13),
    other.saveLevel("https://a.com", new GainLevel(2.4)),
    other.saveRate("https://b.com", 4),
  ]);
  const restarted = new ChromeSitePreferences(storage);
  assert.equal((await restarted.loadRate("https://a.com")).rate, 2.15);
  assert.equal((await restarted.loadLevel("https://a.com")).sliderValue, 2.5);
  assert.equal((await restarted.loadRate("https://b.com")).rate, 4);
});

test("missing and malformed preferences fall back safely and invalid writes preserve data", async () => {
  const url = "https://example.com";
  const { data, preferences } = setup({
    playbackRate: 2, sliderValue: 0.5,
    [sitePreferenceKey(url, "playbackRate")]: "3",
    [sitePreferenceKey(url, "sliderValue")]: Infinity,
  });
  assert.equal((await preferences.loadRate(url)).rate, 2);
  assert.equal((await preferences.loadLevel(url)).sliderValue, 0.5);
  const before = { ...data };
  await assert.rejects(preferences.saveRate(url, NaN), /finite/);
  await assert.rejects(preferences.saveLevel(url, { sliderValue: "2" }), /finite/);
  await assert.rejects(preferences.loadRate("bad URL"), /web page/);
  assert.deepEqual(data, before);
  const empty = setup({ percent: 200, playbackRate: NaN });
  assert.equal((await empty.preferences.loadRate(url)).rate, 1);
  assert.equal((await empty.preferences.loadLevel(url)).sliderValue, 1);
});

test("content-script requests use Chrome's main-frame URL rather than a supplied site", async () => {
  const { preferences } = setup();
  const sender = { frameId: 0, url: "https://a.com/watch" };
  await handleSitePreferenceMessage(preferences,
    { type: "saveRate", rate: 3, url: "https://b.com" }, sender);
  assert.equal((await preferences.loadRate(sender.url)).rate, 3);
  assert.equal((await preferences.loadRate("https://b.com")).rate, 1);
  await assert.rejects(handleSitePreferenceMessage(preferences,
    { type: "saveRate", rate: 2 }, { ...sender, frameId: 1 }), /main page/);
  await assert.rejects(handleSitePreferenceMessage(preferences, { type: "unknown" }, sender), /Unknown/);
});
