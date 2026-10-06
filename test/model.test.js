import assert from "node:assert/strict";
import { test } from "node:test";
import { captureRefusal } from "../src/model/capture-target.js";
import { DEFAULT_LEVEL, GainLevel, MAX_LEVEL, MIN_LEVEL } from "../src/model/gain-level.js";

test("slider levels map to mute and equal 5 dB steps with a unity default", () => {
  const expected = [
    [0, -Infinity, 0],
    [0.5, -5, 0.5623413251903491],
    [1, 0, 1],
    [1.5, 5, 1.7782794100389228],
    [2, 10, 3.1622776601683795],
    [2.5, 15, 5.623413251903491],
    [3, 20, 10],
  ];
  for (const [sliderValue, decibels, gain] of expected) {
    const level = new GainLevel(sliderValue);
    assert.equal(level.sliderValue, sliderValue);
    assert.equal(level.decibels, decibels);
    assert.ok(Math.abs(level.linear - gain) < 1e-12);
  }
  assert.equal(GainLevel.default().sliderValue, DEFAULT_LEVEL);
  assert.equal(GainLevel.default().linear, 1);
});

test("slider values clamp, snap to half steps, and reject non-finite inputs", () => {
  assert.equal(new GainLevel(1.24).sliderValue, 1);
  assert.equal(new GainLevel(1.26).sliderValue, 1.5);
  assert.equal(new GainLevel(900).sliderValue, MAX_LEVEL);
  assert.equal(new GainLevel(-4).sliderValue, MIN_LEVEL);
  assert.throws(() => new GainLevel("1"), /finite number/);
  assert.throws(() => new GainLevel(Number.NaN), /finite number/);
  assert.throws(() => new GainLevel(Infinity), /finite number/);
});

test("browser pages and the web store are refused before capture", () => {
  assert.equal(captureRefusal("chrome://extensions"), "This page cannot be amplified.");
  assert.equal(captureRefusal("chrome-extension://abc/popup.html"), "This page cannot be amplified.");
  assert.equal(captureRefusal("https://chromewebstore.google.com/detail/x"), "This page cannot be amplified.");
  assert.equal(captureRefusal("not a url"), "This page cannot be amplified.");
  assert.equal(captureRefusal(""), "Open a web page, then try again.");
  assert.equal(captureRefusal("https://www.example.com/watch?v=1"), null);
});
