import assert from "node:assert/strict";
import { test } from "node:test";
import { TranscriptView } from "../src/presentation/transcript-view.js";

function fixture() {
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.value = "";
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.events = {};
      this.files = [];
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, handler) { this.events[name] = handler; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    scrollIntoView() { this.scrolled = true; }
    click() { this.clicked = true; this.events.click?.({ target: this }); }
  }
  const elements = {};
  const document = { createElement: (tag) => new Element(tag), getElementById: (id) => elements[id] ??= new Element() };
  const view = new TranscriptView(document);
  view.setContext("Lesson", true);
  view.setTracks([{ id: "native:0", label: "English" }], "native:0");
  view.setTranscript([{ start: 0, end: 3, text: "First line" }, { start: 2, end: 5, text: '<img src=x> Future line' }], "English");
  return view;
}

test("the file chooser routes a native File to import and allows choosing the same file again", async () => {
  const view = fixture();
  let file;
  view.bind({ onRefresh() {}, onSelect() {}, onImport(value) { file = value; }, onRemove() {}, onSeek() {} });
  view.import.click();
  assert.equal(view.file.clicked, true);
  const selected = new File(["WEBVTT\n\n00:01.000 --> 00:02.000\nFuture line"], "lesson.vtt", { type: "text/vtt" });
  view.file.files = [selected];
  view.file.value = "lesson.vtt";
  view.file.events.change();
  assert.equal(file, selected);
  assert.equal(await file.text(), "WEBVTT\n\n00:01.000 --> 00:02.000\nFuture line");
  assert.equal(view.file.value, "");
});

test("overlapping cues highlight together but expose one current list item and end at exact cue boundaries", () => {
  const view = fixture();
  view.setTime(2.5);
  assert.equal(view.rows[0].button.dataset.active, "true");
  assert.equal(view.rows[1].button.dataset.active, "true");
  assert.equal(view.rows[0].button.attributes["aria-current"], undefined);
  assert.equal(view.rows[1].button.attributes["aria-current"], "true");
  view.setTime(3);
  assert.equal(view.rows[0].button.dataset.active, undefined);
  view.setTime(5);
  assert.equal(view.rows[1].button.dataset.active, undefined);
  assert.equal(view.rows[1].button.attributes["aria-current"], undefined);
});

test("search and current-line navigation render untrusted text plainly without taking scroll control during search", () => {
  const view = fixture();
  const times = [];
  view.bind({ onRefresh() {}, onSelect() {}, onImport() {}, onRemove() {}, onSeek: (time) => times.push(time) });
  assert.equal(view.rows[1].button.children[1].textContent, '<img src=x> Future line');
  view.follow.checked = true;
  view.search.value = "future";
  view.search.events.input();
  assert.equal(view.rows[0].row.hidden, true);
  assert.equal(view.rows[1].row.hidden, false);
  assert.equal(view.summary.textContent, "1 of 2 lines · English");
  view.setTime(2.5);
  assert.equal(view.rows[1].row.scrolled, undefined);
  view.lines.events.click({ target: { closest: () => view.rows[1].button } });
  assert.deepEqual(times, [2]);
  view.lines.events.wheel();
  assert.equal(view.follow.checked, false);
  view.setBusy(true);
  view.lines.events.click({ target: { closest: () => view.rows[1].button } });
  assert.deepEqual(times, [2]);
});
