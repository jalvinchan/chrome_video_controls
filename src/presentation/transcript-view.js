import { formatTranscriptTime } from "../transcript/transcript.js";

export class TranscriptView {
  constructor(document) {
    this.document = document;
    for (const id of ["title", "track", "refresh", "import", "file", "remove", "search", "follow", "status", "summary", "lines"]) {
      this[id] = document.getElementById(id);
    }
    this.ready = false;
    this.busy = false;
    this.rows = [];
    this.activeRows = [];
    this.time = null;
  }

  bind(handlers) {
    this.refresh.addEventListener("click", handlers.onRefresh);
    this.track.addEventListener("change", () => handlers.onSelect(this.track.value));
    this.import.addEventListener("click", () => this.file.click());
    this.file.addEventListener("change", () => {
      const file = this.file.files[0];
      this.file.value = "";
      handlers.onImport(file);
    });
    this.remove.addEventListener("click", handlers.onRemove);
    this.search.addEventListener("input", () => this.filter());
    this.follow.addEventListener("change", () => this.scrollToActive());
    this.lines.addEventListener("wheel", () => { this.follow.checked = false; }, { passive: true });
    this.lines.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-time]");
      if (button && this.ready && !this.busy) handlers.onSeek(Number(button.dataset.time));
    });
  }

  setTitle(title) { this.title.textContent = title; }

  setContext(title, ready) {
    this.ready = ready;
    this.setTitle(title);
    this.search.value = "";
    this.follow.checked = true;
    this.updateControls();
  }

  setTracks(tracks, selected) {
    const options = tracks.map((track) => {
      const option = this.document.createElement("option");
      option.value = track.id;
      option.textContent = track.label;
      return option;
    });
    if (!options.length) {
      const option = this.document.createElement("option");
      option.textContent = "No caption tracks";
      option.value = "";
      options.push(option);
    }
    this.track.replaceChildren(...options);
    this.track.value = selected;
    this.hasTracks = Boolean(tracks.length);
    this.hasImport = tracks.some((track) => track.id === "imported");
    this.remove.hidden = !this.hasImport;
    this.updateControls();
  }

  setTranscript(cues, label) {
    this.label = label;
    this.activeRows = [];
    this.rows = cues.map((cue) => {
      const row = this.document.createElement("li");
      const button = this.document.createElement("button");
      button.type = "button";
      button.dataset.time = String(cue.start);
      const time = this.document.createElement("span");
      time.className = "timestamp";
      time.textContent = formatTranscriptTime(cue.start);
      const text = this.document.createElement("span");
      text.className = "cue-text";
      text.textContent = cue.text;
      button.append(time, text);
      row.append(button);
      return { cue, row, button, search: cue.text.toLocaleLowerCase() };
    });
    this.lines.replaceChildren(...this.rows.map(({ row }) => row));
    this.filter();
    this.updateControls();
    this.setTime(this.time);
  }

  setStatus(message, tone = "") {
    this.status.textContent = message;
    this.status.dataset.tone = tone;
    this.status.hidden = !message;
  }

  setBusy(busy) { this.busy = busy; this.updateControls(); }

  updateControls() {
    this.track.disabled = !this.ready || this.busy || !this.hasTracks;
    this.refresh.disabled = !this.ready || this.busy;
    this.import.disabled = !this.ready || this.busy;
    this.remove.disabled = !this.ready || this.busy;
    this.search.disabled = !this.rows.length;
    for (const { button } of this.rows) button.disabled = !this.ready || this.busy;
  }

  filter() {
    const query = this.search.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const item of this.rows) {
      item.row.hidden = !item.search.includes(query);
      if (!item.row.hidden) count += 1;
    }
    this.summary.textContent = this.rows.length ? `${query ? `${count} of ` : ""}${this.rows.length} lines · ${this.label}` : "";
  }

  setTime(time) {
    this.time = time;
    const active = Number.isFinite(time) ? this.rows.filter(({ cue }) => cue.start <= time && time < cue.end) : [];
    if (active.length === this.activeRows.length && active.every((item, index) => item === this.activeRows[index])) return;
    for (const { button } of this.activeRows) {
      button.removeAttribute("aria-current");
      delete button.dataset.active;
    }
    for (const { button } of active) button.dataset.active = "true";
    active.at(-1)?.button.setAttribute("aria-current", "true");
    this.activeRows = active;
    this.scrollToActive();
  }

  scrollToActive() {
    if (!this.follow.checked || this.search.value.trim()) return;
    this.activeRows.at(-1)?.row.scrollIntoView({ block: "nearest" });
  }
}
