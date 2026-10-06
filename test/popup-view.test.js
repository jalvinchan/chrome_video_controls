import assert from "node:assert/strict";
import { test } from "node:test";
import { PopupView } from "../src/presentation/popup-view.js";

function withDocument(run) {
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName;
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
    createElement: (tagName) => new Element(tagName),
    createElementNS: (_, tagName) => new Element(tagName),
    createTextNode: (text) => text,
  };
  try { run(new PopupView(new Element())); }
  finally {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
  }
}

const idle = { live: false, sliderValue: 1, currentTabId: 7, currentTitle: "Video" };

test("secondary controls use native disclosures and preserve expansion and drafts across refreshes", () => {
  withDocument((view) => {
    const state = { ...idle, video: { available: true, rate: 1, loop: { a: 10, b: 20, active: true } },
      bookmarks: { key: "media:1", items: [{ id: "one", time: 15, note: "Study" }] } };
    view.render(state);
    const popup = view.root.children[0];
    const loopSection = popup.children.find((node) => node.attributes?.["aria-label"] === "A–B repeat");
    const bookmarkSection = popup.children.find((node) => node.attributes?.["aria-label"] === "Timestamp bookmarks");
    const loopDetails = loopSection.children[0];
    const bookmarkDetails = bookmarkSection.children[0];
    const help = popup.children.at(-1);
    for (const details of [loopDetails, bookmarkDetails, help]) {
      assert.equal(details.tagName, "details");
      assert.equal(details.attributes.open, undefined);
      assert.equal(details.children[0].tagName, "summary");
    }
    assert.ok(loopDetails.children[0].children.includes(view.loopSummary));
    assert.equal(view.loopSummary.textContent, "Looping");
    assert.ok(bookmarkDetails.children[0].children.includes(view.bookmarkCount));
    assert.equal(view.bookmarkCount.textContent, "1");
    const helpText = help.children[1].children.map((node) => node.children.join(" ")).join(" ");
    assert.match(helpText, /Hold R on the video page.*at least 3×.*Release R to restore/);
    assert.match(helpText, /Alt \+ Shift.*On Mac, Alt is Option/);
    assert.match(helpText, /Audio is not recorded/);

    bookmarkDetails.open = true;
    view.bookmarkNote.value = "Unfinished note";
    view.update({ ...state, sliderValue: 2, video: { ...state.video, loop: { a: 10, b: null } },
      bookmarks: { ...state.bookmarks, items: [] } });
    assert.equal(bookmarkDetails.open, true);
    assert.equal(view.bookmarkNote.value, "Unfinished note");
    assert.equal(view.loopSummary.textContent, "A set");
    assert.equal(view.bookmarkCount.textContent, "0");
    assert.equal(view.bookmarkEmpty.hidden, false);

    bookmarkDetails.open = false;
    view.setBookmarkStatus({ message: "Couldn't save bookmark", tone: "error" });
    view.setLoopStatus({ message: "B must be after A", tone: "error" });
    assert.ok(bookmarkSection.children.includes(view.bookmarkStatus));
    assert.ok(loopSection.children.includes(view.loopStatus));
    assert.equal(view.bookmarkStatus.hidden, false);
    assert.equal(view.loopStatus.hidden, false);
    assert.equal(bookmarkDetails.open, false);
  });
});

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

test("the selected site's gain and another captured tab's warning show their own levels", () => {
  withDocument((view) => {
    view.render({ ...idle, live: true, tabId: 8, title: "Another video",
      sliderValue: 1, capturedSliderValue: 3 });
    assert.equal(view.readout.textContent, "0 dB");
    assert.match(view.status.textContent, /Another video is playing with \+20 dB gain/);
    view.setBusy(true);
    assert.equal(view.slider.disabled, true);
    view.setBusy(false);
    assert.equal(view.slider.disabled, false);
    view.update({ ...idle, blocked: "This page cannot be amplified." });
    assert.equal(view.slider.disabled, true);
    assert.equal(view.resetButton.disabled, true);
    view.setBusy(false);
    assert.equal(view.resetButton.disabled, true);
  });
});

test("loop controls show endpoints, active state, and actionable errors", () => {
  withDocument((view) => {
    const actions = [];
    view.render({ ...idle, video: { available: true, rate: 3, loop: { a: null, b: null, active: false } } });
    view.bind({ onLoop: (action) => actions.push(action) });
    assert.equal(view.loopReadout.textContent, "A — · B —");
    assert.equal(view.loopButtons[0].button.disabled, false);
    assert.equal(view.loopButtons[1].button.disabled, true);
    assert.equal(view.loopButtons[2].button.disabled, true);
    view.loopButtons[0].button.listeners.click();
    view.update({ ...idle, video: { available: true, rate: 3, loop: { a: 10.25, b: null, active: false } } });
    assert.equal(view.loopReadout.textContent, "A 0:10.25 · B —");
    assert.equal(view.loopButtons[1].button.disabled, false);
    view.loopButtons[1].button.listeners.click();
    view.update({ ...idle, video: { available: true, rate: 3, loop: { a: 10.25, b: 65.5, active: true } } });
    assert.equal(view.loopReadout.textContent, "A 0:10.25 · B 1:05.50 · Looping");
    assert.equal(view.loopReadout.dataset.active, "true");
    view.loopButtons[2].button.listeners.click();
    assert.deepEqual(actions, ["setLoopA", "setLoopB", "clearLoop"]);
    view.setBusy(true);
    assert.ok(view.loopButtons.every(({ button }) => button.disabled));
    view.setBusy(false);
    view.update({ ...idle, video: { available: true, rate: 1, loop: { error: "Section isn't seekable" } } });
    assert.equal(view.loopStatus.hidden, false);
    assert.match(view.loopStatus.textContent, /seekable/);
    assert.equal(view.loopButtons[2].button.disabled, false);
    view.update({ ...idle, video: { available: false, rate: 1 } });
    assert.ok(view.loopButtons.every(({ button }) => button.disabled));
    assert.equal(view.loopStatus.hidden, true);
    assert.match(view.resetButton.attributes.title, /clear the loop/);
  });
});

test("invalid loop actions show errors in A–B repeat and preserve volume status", () => {
  withDocument((view) => {
    const state = { ...idle, live: true, tabId: 8, title: "Another video",
      video: { available: true, rate: 1, loop: { a: 10, b: null } } };
    view.render(state);
    const volumeStatus = view.status.textContent;
    const message = "B must be after A. Move forward in the video, then set B.";
    view.setLoopStatus({ message, tone: "error" });
    view.setBusy(false);
    view.update({ ...state, sliderValue: 2 });
    assert.equal(view.loopStatus.textContent, message);
    assert.equal(view.loopStatus.hidden, false);
    assert.equal(view.loopStatus.dataset.tone, "error");
    assert.match(view.status.textContent, /Another video/);
    assert.notEqual(view.status.textContent, message);
    const popup = view.root.children[0];
    const loopSection = popup.children.find((child) => child.attributes?.["aria-label"] === "A–B repeat");
    assert.ok(loopSection.children.includes(view.loopStatus));
    assert.ok(!loopSection.children.includes(view.status));
    assert.ok(volumeStatus);
    view.setLoopStatus(null);
    assert.equal(view.loopStatus.hidden, true);
    view.setLoopStatus({ message, tone: "error" });
    view.update({ ...state, video: { ...state.video, loop: { a: 10, b: 15, active: true } } });
    assert.equal(view.loopStatus.hidden, true);
    view.setLoopStatus({ message, tone: "error" });
    view.update({ ...state, currentTabId: 9 });
    assert.equal(view.loopStatus.hidden, true);
  });
});

test("bookmarks render notes safely, keep drafts across refreshes, and route jumps and removals by video", () => {
  withDocument((view) => {
    const state = { ...idle, video: { available: true, rate: 1 }, bookmarks: { key: "media:1", items: [] } };
    const saved = [];
    const jumped = [];
    const removed = [];
    view.render(state);
    view.bind({ onBookmarkSave: (note) => saved.push(note), onBookmarkSeek: (item) => jumped.push(item), onBookmarkRemove: (item) => removed.push(item) });
    assert.equal(view.bookmarkSave.disabled, false);
    view.bookmarkNote.value = "My draft";
    view.update({ ...state, sliderValue: 2 });
    assert.equal(view.bookmarkNote.value, "My draft");
    view.bookmarkSave.listeners.click();
    assert.deepEqual(saved, ["My draft"]);
    const item = { id: "one", time: 15.5, note: "<img src=x onerror=alert(1)>" };
    view.update({ ...state, bookmarks: { key: "media:1", items: [item] } });
    const jump = view.bookmarkList.children[0].children[0];
    assert.equal(jump.children[1].children[0], item.note);
    jump.listeners.click();
    view.bookmarkList.children[0].children[1].listeners.click();
    assert.equal(jumped[0].key, "media:1");
    assert.equal(jumped[0].time, 15.5);
    assert.equal(removed[0].id, "one");
    view.setBookmarkStatus({ message: "Couldn't save bookmark", tone: "error" });
    view.setBookmarkBusy(false);
    assert.equal(view.bookmarkStatus.hidden, false);
    assert.equal(view.bookmarkStatus.dataset.tone, "error");
    assert.equal(view.status.hidden, true);
    assert.equal(view.bookmarkNote.value, "My draft");
    view.update({ ...state, bookmarks: { key: "media:2", items: [] } });
    assert.equal(view.bookmarkNote.value, "");
    assert.equal(view.bookmarkEmpty.textContent, "No bookmarks yet.");
    assert.equal(view.bookmarkStatus.hidden, true);
    view.update({ ...state, bookmarks: { key: null, items: [] } });
    assert.equal(view.bookmarkSave.disabled, true);
    assert.equal(view.bookmarkNote.disabled, true);
  });
});
