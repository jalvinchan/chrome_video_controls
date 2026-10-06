import assert from "node:assert/strict";
import { test } from "node:test";
import { captureRefusal } from "../src/model/capture-target.js";
import { DEFAULT_PERCENT, GainLevel, MAX_PERCENT, MIN_PERCENT } from "../src/model/gain-level.js";

test("gain percent clamps into the slider range and becomes a linear amp", () => {
  assert.equal(new GainLevel(200).linear, 2);
  assert.equal(new GainLevel(200.4).percent, 200);
  assert.equal(new GainLevel(900).percent, MAX_PERCENT);
  assert.equal(new GainLevel(-4).percent, MIN_PERCENT);
  assert.equal(GainLevel.default().percent, DEFAULT_PERCENT);
  assert.throws(() => new GainLevel("200"), /finite number/);
  assert.throws(() => new GainLevel(Number.NaN), /finite number/);
});

test("browser pages and the web store are refused before capture", () => {
  assert.equal(captureRefusal("chrome://extensions"), "This page cannot be amplified.");
  assert.equal(captureRefusal("chrome-extension://abc/popup.html"), "This page cannot be amplified.");
  assert.equal(captureRefusal("https://chromewebstore.google.com/detail/x"), "This page cannot be amplified.");
  assert.equal(captureRefusal("not a url"), "This page cannot be amplified.");
  assert.equal(captureRefusal(""), "Open a web page, then try again.");
  assert.equal(captureRefusal("https://www.example.com/watch?v=1"), null);
});
