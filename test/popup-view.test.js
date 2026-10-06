import assert from "node:assert/strict";
import { test } from "node:test";
import { PopupView } from "../src/presentation/popup-view.js";

function withDocument(run) {
  class Element {
    constructor() {
      this.attributes = {};
      this.listeners = {};
      this.children = [];
      this.dataset = {};
      this.value = "";
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  globalThis.Node = Element;
  globalThis.document = {
    activeElement: null,
    createElement: () => new Element(),
    createElementNS: () => new Element(),
    createTextNode: (text) => text,
  };
  try { run(new PopupView(new Element())); }
  finally {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
  }
}

const idle = { live: false, sliderValue: 1, currentTabId: 7, currentTitle: "Video" };

test("popup exposes the new range and labels every step in decibels or mute", () => {
  withDocument((view) => {
    view.render(idle);
    assert.equal(view.slider.attributes.min, "0");
    assert.equal(view.slider.attributes.max, "3");
    assert.equal(view.slider.attributes.step, "0.5");
    assert.equal(view.slider.value, "1");
    assert.equal(view.readout.textContent, "0 dB");
    for (const [sliderValue, label] of [[0, "Mute"], [0.5, "-5 dB"], [1, "0 dB"], [1.5, "+5 dB"], [2, "+10 dB"], [2.5, "+15 dB"], [3, "+20 dB"]]) {
      view.update({ ...idle, sliderValue });
      assert.equal(view.readout.textContent, label);
      assert.equal(view.slider.attributes["aria-valuetext"], label);
    }
  });
});

test("slider input sends numeric levels without routine descriptions", () => {
  withDocument((view) => {
    const changed = [];
    view.render(idle);
    view.bind({ onLevel: (value) => changed.push(value) });
    view.slider.value = "2.5";
    view.slider.listeners.input();
    assert.deepEqual(changed, [2.5]);
    assert.equal(view.readout.textContent, "+15 dB");
    view.update({ ...idle, live: true, tabId: 7, sliderValue: 2.5 });
    assert.equal(view.status.textContent, "");
    assert.equal(view.status.hidden, true);
    view.update({ ...idle, live: true, tabId: 7, sliderValue: 0 });
    assert.equal(view.status.textContent, "");
    assert.equal(view.readout.textContent, "Mute");
  });
});

test("speed controls expose presets, custom input, reset, and independent availability", () => {
  withDocument((view) => {
    const rates = [];
    let resets = 0;
    view.render({ ...idle, video: { rate: 3, available: true } });
    view.bind({ onSpeed: (rate) => rates.push(rate), onReset: () => { resets += 1; } });
    assert.equal(view.speedSlider.attributes.min, "0.25");
    assert.equal(view.speedSlider.attributes.max, "4");
    assert.equal(view.speedReadout.textContent, "3×");
    assert.equal(view.speedStatus.textContent, "");
    assert.equal(view.speedStatus.hidden, true);
    assert.equal(view.speedPresets[3].button.attributes["aria-pressed"], "true");
    assert.equal(view.button.textContent, "Amplify this tab");
    view.speedSlider.value = "3.5";
    view.speedSlider.listeners.input();
    view.speedPresets[1].button.listeners.click();
    view.speedNumber.value = "2.75";
    view.speedNumber.listeners.change();
    view.speedNumber.value = "";
    view.speedNumber.listeners.change();
    view.resetButton.listeners.click();
    assert.deepEqual(rates, [3.5, 1.5, 2.75]);
    assert.equal(resets, 1);
    view.update({ ...idle, video: { rate: 1, available: false, error: "Unavailable" } });
    assert.equal(view.speedSlider.disabled, true);
    assert.equal(view.speedPresets[0].button.disabled, true);
    assert.equal(view.speedStatus.textContent, "Unavailable");
    assert.equal(view.button.disabled, false);
  });
});

test("shortcut updates refresh focused controls while preserving an active drag or draft", () => {
  withDocument((view) => {
    const initial = { ...idle, video: { rate: 1, available: true } };
    view.render(initial);
    let refreshes = 0;
    view.bind({ onRefresh: () => { refreshes += 1; view.update(view.state); } });
    document.activeElement = view.speedSlider;
    view.update({ ...initial, video: { rate: 3, available: true } });
    assert.equal(view.speedSlider.value, "3");
    assert.equal(view.speedReadout.textContent, "3×");
    document.activeElement = view.slider;
    view.update({ ...initial, sliderValue: 2.5 });
    assert.equal(view.slider.value, "2.5");
    assert.equal(view.readout.textContent, "+15 dB");

    view.speedSlider.listeners.pointerdown();
    view.speedSlider.value = "2";
    view.update({ ...initial, video: { rate: 4, available: true } });
    assert.equal(view.speedSlider.value, "2");
    view.speedSlider.listeners.pointerup();
    assert.equal(view.speedSlider.value, "4");

    document.activeElement = view.speedNumber;
    view.speedNumber.value = "2.7";
    view.speedNumber.listeners.input();
    view.update({ ...initial, video: { rate: 3.5, available: true } });
    assert.equal(view.speedNumber.value, "2.7");
    view.speedNumber.listeners.blur();
    assert.equal(view.speedNumber.value, "3.5");
    assert.equal(refreshes, 2);
  });
});

test("warnings and errors remain visible when routine status text is hidden", () => {
  withDocument((view) => {
    view.render({ ...idle, video: { rate: 1, available: true } });
    assert.equal(view.status.hidden, true);
    view.setStatus({ message: "Cannot reach this tab", tone: "error" });
    assert.equal(view.status.hidden, false);
    view.setStatus(null);
    assert.equal(view.status.hidden, true);
    view.update({ ...idle, live: true, tabId: 8, title: "Another video" });
    assert.equal(view.status.hidden, false);
    assert.match(view.status.textContent, /Another video/);
  });
});
