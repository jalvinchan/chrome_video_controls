import { MAX_PERCENT, MIN_PERCENT } from "../model/gain-level.js";

export class PopupView {
  constructor(root) {
    this.root = root;
    this.onToggle = () => {};
    this.onLevel = () => {};
    this.busy = false;
    this.state = null;
    this.statusMessage = null;
    this.slider = null;
    this.readout = null;
    this.tab = null;
    this.status = null;
    this.button = null;
  }

  bind(handlers) {
    this.onToggle = handlers.onToggle ?? (() => {});
    this.onLevel = handlers.onLevel ?? (() => {});
  }

  render(state) {
    this.slider = h("input", {
      type: "range",
      min: String(MIN_PERCENT),
      max: String(MAX_PERCENT),
      step: "5",
      "aria-label": "Gain",
    });
    this.readout = h("p", { class: "readout" });
    this.tab = h("p", { class: "tab" });
    this.status = h("p", { class: "status", role: "status", "aria-live": "polite" });
    this.button = h("button", { class: "primary", type: "button" });
    this.slider.addEventListener("input", () => {
      this.readout.textContent = `${this.slider.value}%`;
      this.onLevel(Number(this.slider.value));
    });
    this.button.addEventListener("click", () => this.onToggle());

    this.root.replaceChildren(h("div", { class: "popup" },
      h("div", { class: "popup-brand" }, mark(), h("h1", {}, "Amplifier")),
      this.tab,
      h("div", { class: "level" }, this.readout, this.slider),
      this.button,
      this.status,
      h("p", { class: "note" }, "Chrome shows a sharing indicator while a tab is amplified. Audio is not recorded."),
    ));
    this.update(state);
  }

  update(state) {
    this.state = state;
    if (!this.slider) return;
    this.tab.textContent = state.currentTitle || "This tab";
    if (document.activeElement !== this.slider) this.slider.value = String(state.percent);
    this.readout.textContent = `${this.slider.value}%`;
    const onThisTab = state.live && state.tabId === state.currentTabId;
    if (onThisTab || (state.blocked && state.live)) this.button.textContent = "Stop";
    else this.button.textContent = "Amplify this tab";
    this.button.disabled = this.busy || (Boolean(state.blocked) && !state.live);
    if (!this.statusMessage) this.#paintStatus(state);
  }

  setBusy(busy) {
    this.busy = busy;
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
    this.status.dataset.tone = status.tone || "ok";
  }

  #paintStatus(state) {
    if (!state || !this.status) return;
    if (state.blocked && !state.live) {
      this.status.textContent = state.blocked;
      this.status.dataset.tone = "warn";
      return;
    }
    if (state.live && state.tabId === state.currentTabId) {
      this.status.textContent = `This tab is playing at ${state.percent}%.`;
      this.status.dataset.tone = "ok";
      return;
    }
    if (state.live) {
      const where = state.title ? `${state.title} is` : "Another tab is";
      const tail = state.blocked ? "" : " Amplifying here switches to this tab.";
      this.status.textContent = `${where} playing at ${state.percent}%.${tail}`;
      this.status.dataset.tone = "warn";
      return;
    }
    this.status.textContent = "100% is this tab's own volume. Stop hands it back to Chrome.";
    this.status.dataset.tone = "";
  }
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
