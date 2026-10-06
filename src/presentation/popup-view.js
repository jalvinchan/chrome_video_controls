import { GainLevel, LEVEL_STEP, MAX_LEVEL, MIN_LEVEL } from "../model/gain-level.js";
import { DEFAULT_RATE, MAX_RATE, MIN_RATE, RATE_STEP, playbackRate } from "../model/playback-rate.js";

export class PopupView {
  constructor(root) {
    this.root = root;
    this.onToggle = () => {};
    this.onLevel = () => {};
    this.onSpeed = () => {};
    this.onReset = () => {};
    this.onShortcuts = () => {};
    this.onRefresh = () => {};
    this.onLoop = () => {};
    this.busy = false;
    this.state = null;
    this.statusMessage = null;
    this.loopStatusMessage = null;
    this.bookmarkStatusMessage = null;
    this.bookmarkBusy = false;
    this.bookmarkButtons = [];
    this.bookmarkSignature = null;
    this.slider = null;
    this.readout = null;
    this.tab = null;
    this.status = null;
    this.button = null;
    this.speedSlider = null;
    this.speedNumber = null;
    this.speedReadout = null;
    this.speedStatus = null;
    this.speedPresets = [];
    this.resetButton = null;
    this.dragging = new Set();
    this.editingSpeed = false;
  }

  bind(handlers) {
    this.onToggle = handlers.onToggle ?? (() => {});
    this.onLevel = handlers.onLevel ?? (() => {});
    this.onSpeed = handlers.onSpeed ?? (() => {});
    this.onReset = handlers.onReset ?? (() => {});
    this.onShortcuts = handlers.onShortcuts ?? (() => {});
    this.onRefresh = handlers.onRefresh ?? (() => {});
    this.onLoop = handlers.onLoop ?? (() => {});
    this.onBookmarkSave = handlers.onBookmarkSave ?? (() => {});
    this.onBookmarkSeek = handlers.onBookmarkSeek ?? (() => {});
    this.onBookmarkRemove = handlers.onBookmarkRemove ?? (() => {});
  }

  render(state) {
    this.slider = h("input", {
      type: "range",
      min: String(MIN_LEVEL),
      max: String(MAX_LEVEL),
      step: String(LEVEL_STEP),
      "aria-label": "Gain",
    });
    this.readout = h("p", { class: "readout" });
    this.tab = h("p", { class: "tab" });
    this.status = h("p", { class: "status", role: "status", "aria-live": "polite" });
    this.button = h("button", { class: "primary", type: "button" });
    this.speedSlider = h("input", {
      type: "range", min: String(MIN_RATE), max: String(MAX_RATE), step: String(RATE_STEP),
      "aria-label": "Playback speed",
    });
    for (const slider of [this.slider, this.speedSlider]) {
      slider.addEventListener("pointerdown", () => this.dragging.add(slider));
      for (const event of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) {
        slider.addEventListener(event, () => {
          if (this.dragging.delete(slider)) this.onRefresh();
        });
      }
    }
    this.speedNumber = h("input", {
      type: "number", min: String(MIN_RATE), max: String(MAX_RATE), step: String(RATE_STEP),
      "aria-label": "Custom playback speed", class: "speed-number",
    });
    this.speedReadout = h("p", { class: "readout" });
    this.speedStatus = h("p", { class: "note", role: "status", "aria-live": "polite" });
    this.speedPresets = [1, 1.5, 2, 3].map((rate) => {
      const button = h("button", { type: "button", "aria-label": `Set speed to ${rate}×` }, `${rate}×`);
      button.addEventListener("click", () => this.onSpeed(rate));
      return { rate, button };
    });
    this.speedSlider.addEventListener("input", () => {
      this.speedNumber.value = this.speedSlider.value;
      this.#paintSpeed();
      this.onSpeed(Number(this.speedSlider.value));
    });
    this.speedNumber.addEventListener("change", () => {
      this.editingSpeed = false;
      const rate = Number(this.speedNumber.value);
      if (!this.speedNumber.value || !Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
        this.speedNumber.value = this.speedSlider.value;
        this.speedStatus.textContent = "Enter a speed between 0.25× and 4×.";
        this.speedStatus.hidden = false;
        return;
      }
      const normalized = playbackRate(rate);
      this.speedNumber.value = String(normalized);
      this.speedSlider.value = String(normalized);
      this.#paintSpeed();
      this.onSpeed(normalized);
    });
    this.speedNumber.addEventListener("input", () => { this.editingSpeed = true; });
    this.speedNumber.addEventListener("blur", () => {
      this.editingSpeed = false;
      this.onRefresh();
    });
    this.loopReadout = h("p", { class: "loop-readout", role: "status", "aria-live": "polite" });
    this.loopStatus = h("p", { class: "note", role: "status", "aria-live": "polite" });
    this.loopButtons = [
      ["setLoopA", "Set A"], ["setLoopB", "Set B"], ["clearLoop", "Clear loop"],
    ].map(([action, label]) => {
      const button = h("button", { type: "button" }, label);
      button.addEventListener("click", () => this.onLoop(action));
      return { action, button };
    });
    this.bookmarkNote = h("input", {
      type: "text", maxlength: "250", class: "bookmark-note",
      "aria-label": "Bookmark note (optional)", placeholder: "Note (optional)",
    });
    this.bookmarkSave = h("button", { type: "button" }, "Save time");
    this.bookmarkSave.addEventListener("click", () => this.onBookmarkSave(this.bookmarkNote.value));
    this.bookmarkNote.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing && !this.bookmarkSave.disabled) {
        event.preventDefault();
        this.onBookmarkSave(this.bookmarkNote.value);
      }
    });
    this.bookmarkList = h("ul", { class: "bookmark-list", "aria-label": "Saved timestamps" });
    this.bookmarkStatus = h("p", { class: "note", role: "status", "aria-live": "polite" });
    this.resetButton = h("button", { type: "button", title: "Reset speed to 1×, gain to 0 dB, and clear the loop" }, "Reset controls");
    this.resetButton.addEventListener("click", () => this.onReset());
    const shortcutsButton = h("button", { type: "button" }, "Shortcuts");
    shortcutsButton.addEventListener("click", () => this.onShortcuts());
    this.slider.addEventListener("input", () => {
      this.#paintLevel();
      this.onLevel(Number(this.slider.value));
    });
    this.button.addEventListener("click", () => this.onToggle());

    this.root.replaceChildren(h("div", { class: "popup" },
      h("div", { class: "popup-brand" }, mark(), h("h1", {}, "Video Controls")),
      this.tab,
      h("section", { class: "control-section", "aria-label": "Video speed" },
        h("h2", { title: "Hold R on the video page for temporary 3× speed; release to restore." }, "Speed"),
        h("div", { class: "speed-heading" }, this.speedReadout, this.speedNumber),
        this.speedSlider,
        h("div", { class: "presets" }, this.speedPresets.map(({ button }) => button)),
        this.speedStatus,
      ),
      h("h2", {}, "Volume boost"),
      h("div", { class: "level" }, this.readout, this.slider),
      this.button,
      this.status,
      h("section", { class: "control-section", "aria-label": "A–B repeat" },
        h("h2", {}, "A–B repeat"),
        this.loopReadout,
        h("div", { class: "loop-actions" }, this.loopButtons.map(({ button }) => button)),
        this.loopStatus,
      ),
      h("section", { class: "control-section", "aria-label": "Timestamp bookmarks" },
        h("h2", {}, "Bookmarks"),
        h("div", { class: "bookmark-entry" }, this.bookmarkNote, this.bookmarkSave),
        this.bookmarkList,
        this.bookmarkStatus,
      ),
      h("div", { class: "footer-actions" }, this.resetButton, shortcutsButton),
      h("p", { class: "note" }, "Speed: Alt + Shift + ← / →. Volume: Alt + Shift + ↓ / ↑. On Mac, Alt is Option."),
      h("p", { class: "note" }, "Chrome shows a sharing indicator while a tab is amplified. Audio is not recorded."),
    ));
    this.update(state);
  }

  update(state) {
    if (this.state?.bookmarks?.key !== state.bookmarks?.key) {
      this.bookmarkStatusMessage = null;
      if (this.bookmarkNote) this.bookmarkNote.value = "";
    }
    if (this.state?.currentTabId !== state.currentTabId
      || this.state?.video?.loop?.a !== state.video?.loop?.a
      || this.state?.video?.loop?.b !== state.video?.loop?.b) this.loopStatusMessage = null;
    this.state = state;
    if (!this.slider) return;
    this.tab.textContent = state.currentTitle || "This tab";
    if (!this.dragging.has(this.slider)) this.slider.value = String(state.sliderValue);
    this.#paintLevel();
    const video = state.video ?? { rate: DEFAULT_RATE, available: false };
    if (!this.dragging.has(this.speedSlider)) this.speedSlider.value = String(video.rate);
    if (!this.editingSpeed) this.speedNumber.value = String(video.rate);
    this.#paintSpeed();
    this.speedSlider.disabled = Boolean(video.error);
    this.speedNumber.disabled = Boolean(video.error);
    for (const { button } of this.speedPresets) button.disabled = Boolean(video.error);
    this.speedStatus.textContent = video.error || (video.available ? "" : "No video found.");
    this.speedStatus.hidden = !this.speedStatus.textContent;
    this.#paintLoop();
    this.#paintBookmarks();
    this.resetButton.disabled = this.busy;
    const onThisTab = state.live && state.tabId === state.currentTabId;
    if (onThisTab || (state.blocked && state.live)) this.button.textContent = "Stop";
    else this.button.textContent = "Amplify this tab";
    this.button.disabled = this.busy || (Boolean(state.blocked) && !state.live);
    if (!this.statusMessage) this.#paintStatus(state);
  }

  setBusy(busy) {
    this.busy = busy;
    this.#paintLoop();
    if (this.resetButton) this.resetButton.disabled = busy;
    if (!this.button || !this.state) return;
    this.button.disabled = busy || (Boolean(this.state.blocked) && !this.state.live);
  }

  setStatus(status) {
    this.statusMessage = status;
    if (!this.status) return;
    if (!status) {
      this.#paintStatus(this.state);
      return;
    }
    this.status.textContent = status.message;
    this.status.hidden = false;
    this.status.dataset.tone = status.tone || "ok";
  }

  setLoopStatus(status) {
    this.loopStatusMessage = status;
    this.#paintLoop();
  }

  setBookmarkStatus(status) {
    this.bookmarkStatusMessage = status;
    this.#paintBookmarks();
  }

  setBookmarkBusy(busy) {
    this.bookmarkBusy = busy;
    this.#paintBookmarks();
  }

  #paintLevel() {
    const label = levelLabel(Number(this.slider.value));
    this.readout.textContent = label;
    this.slider.setAttribute("aria-valuetext", label);
  }

  #paintSpeed() {
    const rate = Number(this.speedSlider.value);
    const label = `${rate}×`;
    this.speedReadout.textContent = label;
    this.speedSlider.setAttribute("aria-valuetext", label);
    for (const preset of this.speedPresets) {
      preset.button.setAttribute("aria-pressed", String(preset.rate === rate));
    }
  }

  #paintLoop() {
    if (!this.loopReadout || !this.state) return;
    const video = this.state.video;
    const loop = video?.loop ?? {};
    this.loopReadout.textContent = `A ${timestamp(loop.a)} · B ${timestamp(loop.b)}${loop.active ? " · Looping" : ""}`;
    this.loopReadout.dataset.active = String(Boolean(loop.active));
    for (const { action, button } of this.loopButtons) {
      button.disabled = this.busy || Boolean(video?.error) || !video?.available
        || (action === "setLoopB" && loop.a == null)
        || (action === "clearLoop" && loop.a == null && !loop.error);
    }
    this.loopStatus.textContent = this.loopStatusMessage?.message || loop.error || "";
    this.loopStatus.hidden = !this.loopStatus.textContent;
    this.loopStatus.dataset.tone = this.loopStatusMessage?.tone || (loop.error ? "error" : "");
  }

  #paintBookmarks() {
    if (!this.bookmarkList || !this.state) return;
    const { key, items = [], error } = this.state.bookmarks ?? {};
    const signature = JSON.stringify([key, items]);
    // Keep focused timestamp/remove buttons in place during unrelated refreshes.
    if (signature !== this.bookmarkSignature) {
      this.bookmarkSignature = signature;
      this.bookmarkButtons = [];
      this.bookmarkList.replaceChildren(...items.map((item) => {
        const jump = h("button", { type: "button", class: "bookmark-jump",
          "aria-label": `Jump to ${timestamp(item.time)}${item.note ? `: ${item.note}` : ""}` },
          h("span", { class: "bookmark-time" }, timestamp(item.time)),
          item.note ? h("span", { class: "bookmark-label" }, item.note) : null,
        );
        const remove = h("button", { type: "button", class: "bookmark-remove",
          "aria-label": `Remove bookmark at ${timestamp(item.time)}${item.note ? `: ${item.note}` : ""}` }, "Remove");
        jump.addEventListener("click", () => this.onBookmarkSeek({ ...item, key }));
        remove.addEventListener("click", () => this.onBookmarkRemove({ ...item, key }));
        this.bookmarkButtons.push(jump, remove);
        return h("li", {}, jump, remove);
      }));
    }
    this.bookmarkList.hidden = !items.length;
    this.bookmarkSave.disabled = this.bookmarkBusy || !key || Boolean(error);
    this.bookmarkNote.disabled = !key;
    for (const button of this.bookmarkButtons) button.disabled = this.bookmarkBusy;
    const message = this.bookmarkStatusMessage?.message || error;
    this.bookmarkStatus.textContent = message || (!key
      ? (this.state.video?.available ? "Bookmarks need a loaded video with a stable address." : "No video found.")
      : items.length ? "" : "No bookmarks yet.");
    this.bookmarkStatus.dataset.tone = message ? "error" : "";
    this.bookmarkStatus.hidden = !this.bookmarkStatus.textContent;
  }

  #paintStatus(state) {
    if (!state || !this.status) return;
    this.status.hidden = false;
    if (state.blocked && !state.live) {
      this.status.textContent = state.blocked;
      this.status.dataset.tone = "warn";
      return;
    }
    if (state.live && state.tabId === state.currentTabId) {
      this.status.textContent = "";
      this.status.hidden = true;
      this.status.dataset.tone = "ok";
      return;
    }
    if (state.live) {
      const where = state.title ? `${state.title} is` : "Another tab is";
      const tail = state.blocked ? "" : " Amplifying here switches to this tab.";
      this.status.textContent = state.sliderValue === 0
        ? `${where} muted.${tail}`
        : `${where} playing with ${levelLabel(state.sliderValue)} gain.${tail}`;
      this.status.dataset.tone = "warn";
      return;
    }
    this.status.textContent = "";
    this.status.hidden = true;
    this.status.dataset.tone = "";
  }
}

function timestamp(time) {
  if (time == null || !Number.isFinite(time)) return "—";
  const centiseconds = Math.floor(time * 100);
  const seconds = Math.floor(centiseconds / 100) % 60;
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const hours = Math.floor(centiseconds / 360000);
  const fraction = String(centiseconds % 100).padStart(2, "0");
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(seconds).padStart(2, "0")}.${fraction}`;
}

function levelLabel(sliderValue) {
  const level = new GainLevel(sliderValue);
  if (level.sliderValue === 0) return "Mute";
  return `${level.decibels > 0 ? "+" : ""}${level.decibels} dB`;
}

function mark() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("class", "mark");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<rect x="4" y="18" width="6" height="8" rx="1" fill="currentColor"/><rect x="13" y="12" width="6" height="14" rx="1" fill="currentColor"/><rect x="22" y="6" width="6" height="20" rx="1" fill="currentColor"/>';
  return svg;
}

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
