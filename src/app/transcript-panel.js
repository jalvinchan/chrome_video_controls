import { MAX_TRANSCRIPT_BYTES, parseSubtitleFile } from "../transcript/transcript.js";
import { TRANSCRIPT_PREFIX } from "../transcript/chrome-transcript-repository.js";

export class TranscriptPanel {
  constructor({ chrome, window, document, video, source, repository, view }) {
    Object.assign(this, { chrome, window, document, video, source, repository, view });
    this.context = null;
    this.revision = 0;
    this.request = 0;
    this.active = false;
    this.poll = null;
    this.tracks = [];
    this.saved = null;
    this.onTab = (info) => {
      if (info?.windowId !== undefined && info.windowId !== this.windowId) return;
      this.revision += 1;
      this.request += 1;
      this.context = null;
      this.view.setContext("Loading video…", false);
      this.view.setTranscript([], "");
      this.unavailableTabId = null;
      this.refresh();
    };
    this.onUpdated = (id, change) => {
      if (id === this.context?.tabId && (change.url || change.status === "complete")) this.onTab();
    };
    this.onStorage = (changes, area) => {
      if (area === "local" && this.context?.key && changes[TRANSCRIPT_PREFIX + this.context.key]) this.load();
    };
    this.onMessage = (message, sender) => {
      if (message?.type === "videoControlsChanged" && sender?.tab?.id === this.context?.tabId) {
        this.unavailableTabId = null;
        this.revision += 1;
        this.refresh();
      }
    };
    this.onVisibility = () => {
      clearTimeout(this.poll);
      if (!this.document.hidden) this.refresh();
    };
    this.onUnload = () => this.stop();
  }

  async start() {
    this.windowId = (await this.chrome.windows.getCurrent()).id;
    this.active = true;
    this.view.bind({ onRefresh: () => this.load(this.selectedId), onSelect: (id) => this.select(id),
      onImport: (file) => this.import(file), onRemove: () => this.remove(), onSeek: (time) => this.seek(time) });
    this.chrome.tabs.onActivated.addListener(this.onTab);
    this.chrome.tabs.onUpdated.addListener(this.onUpdated);
    this.chrome.storage.onChanged.addListener(this.onStorage);
    this.chrome.runtime.onMessage.addListener(this.onMessage);
    this.document.addEventListener("visibilitychange", this.onVisibility);
    this.window.addEventListener("unload", this.onUnload);
    await this.refresh();
  }

  refresh() {
    if (!this.active || this.document.hidden) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    clearTimeout(this.poll);
    const revision = this.revision;
    this.refreshing = (async () => {
      const [tab] = await this.chrome.tabs.query({ active: true, windowId: this.windowId });
      let snapshot = {};
      let error;
      try {
        if (!tab?.id) throw new Error("Open a video, then open Video Controls on that tab.");
        if (tab.id === this.unavailableTabId) throw new Error("The panel needs access to this tab.");
        snapshot = await this.video.snapshot(tab.id);
      } catch {
        this.unavailableTabId = tab?.id;
        error = "Open a video and click the Video Controls toolbar icon to give this panel access.";
      }
      if (!this.active || revision !== this.revision) return;
      const key = snapshot.bookmarkKey ?? null;
      if (!this.context || this.context.tabId !== tab?.id || this.context.key !== key) {
        this.context = { tabId: tab?.id, key };
        this.request += 1;
        this.saved = null;
        this.tracks = [];
        this.selectedId = "";
        this.view.setContext(tab?.title || "Transcript", Boolean(key));
        this.view.setTracks([], "");
        this.view.setTranscript([], "");
        this.view.setBusy(false);
        this.view.setStatus(error || (key ? "" : "Choose a loaded on-demand video. Transcripts are unavailable during live streams."));
        if (key) this.load();
      }
      this.view.setTitle(tab?.title || "Transcript");
      this.view.setTime(snapshot.currentTime);
    })().catch((error) => {
      if (this.active && revision === this.revision) this.view.setStatus(error.message, "error");
    }).finally(() => {
      this.refreshing = null;
      if (this.active && !this.document.hidden) {
        // Poll only the lightweight timeline while the panel is visible. Full
        // tracks load on video changes or explicit refresh, never every tick.
        this.poll = setTimeout(() => this.refresh(), revision === this.revision ? 500 : 0);
      }
    });
    return this.refreshing;
  }

  current(context, request) {
    return this.active && this.context === context && this.request === request;
  }

  async load(preferredId = "") {
    const context = this.context;
    if (!context?.key || !this.active) return;
    const request = ++this.request;
    this.view.setBusy(true);
    this.view.setStatus("Loading subtitle tracks…");
    this.view.setTranscript([], "");
    const [saved, tracks] = await Promise.allSettled([
      this.repository.load(context.key), this.source.list(context.tabId, context.key),
    ]);
    if (!this.current(context, request)) return;
    this.saved = saved.status === "fulfilled" ? saved.value : null;
    this.tracks = tracks.status === "fulfilled" ? tracks.value : [];
    const options = this.options();
    const selected = options.some((track) => track.id === preferredId) ? preferredId
      : this.saved ? "imported" : this.tracks.find((track) => track.selected)?.id || this.tracks[0]?.id || "";
    this.view.setTracks(options, selected);
    const warnings = [saved, tracks].filter((result) => result.status === "rejected").map((result) => result.reason.message);
    if (!selected) {
      this.view.setBusy(false);
      this.view.setStatus(warnings.join(" ") || "No existing subtitle tracks were found. Import an SRT/VTT file to read ahead.", warnings.length ? "error" : "");
      return;
    }
    await this.select(selected, warnings.join(" "));
  }

  options() {
    return [...(this.saved ? [{ id: "imported", label: `Imported: ${this.saved.name}` }] : []), ...this.tracks];
  }

  async select(id, warning = "") {
    const context = this.context;
    const request = ++this.request;
    if (!context?.key) return;
    this.view.setBusy(true);
    this.view.setStatus("Loading full transcript…");
    this.view.setTranscript([], "");
    try {
      const track = this.options().find((option) => option.id === id);
      if (!track) throw new Error("Refresh the tracks and choose a transcript.");
      this.selectedId = id;
      if (track.complete === false) {
        warning = [warning, "This player exposes loaded subtitle cues. Import an SRT/VTT file if the full transcript is missing."].filter(Boolean).join(" ");
      }
      const cues = id === "imported" ? this.saved.cues : await this.source.read(context.tabId, context.key, id);
      if (!this.current(context, request)) return;
      this.view.setTranscript(cues, track.label);
      this.view.setStatus(warning, warning ? "warn" : "");
    } catch (error) {
      if (this.current(context, request)) this.view.setStatus(error.message, "error");
    } finally {
      if (this.current(context, request)) this.view.setBusy(false);
    }
  }

  async import(file) {
    const context = this.context;
    if (!context?.key || !file) return;
    const request = ++this.request;
    this.view.setBusy(true);
    this.view.setStatus("Importing subtitles…");
    try {
      if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error("Choose an SRT or VTT subtitle file.");
      if (file.size > MAX_TRANSCRIPT_BYTES) throw new Error("Choose a subtitle file smaller than 2 MB.");
      const cues = parseSubtitleFile(await file.text());
      if (!this.current(context, request)) return;
      if ((await this.video.snapshot(context.tabId)).bookmarkKey !== context.key) throw new Error("The video changed. Choose the file again for the current video.");
      if (!this.current(context, request)) return;
      await this.repository.save(context.key, file.name, cues);
      // Storage changes reload every panel for this video, including this one.
      if (this.current(context, request)) await this.load();
    } catch (error) {
      if (this.current(context, request)) this.view.setStatus(error.message, "error");
    } finally {
      if (this.current(context, request)) this.view.setBusy(false);
    }
  }

  async remove() {
    const context = this.context;
    if (!context?.key || !this.saved) return;
    const request = ++this.request;
    this.view.setBusy(true);
    try {
      await this.repository.remove(context.key);
      if (this.current(context, request)) await this.load();
    } catch (error) {
      if (this.current(context, request)) this.view.setStatus(error.message, "error");
    } finally {
      if (this.current(context, request)) this.view.setBusy(false);
    }
  }

  async seek(time) {
    const context = this.context;
    if (!context?.key) return;
    try {
      await this.video.seekTranscript(context.tabId, context.key, time);
      if (this.context === context) await this.refresh();
    } catch (error) {
      if (this.context === context) this.view.setStatus(error.message, "error");
    }
  }

  stop() {
    this.active = false;
    this.request += 1;
    clearTimeout(this.poll);
    this.chrome.tabs.onActivated.removeListener(this.onTab);
    this.chrome.tabs.onUpdated.removeListener(this.onUpdated);
    this.chrome.storage.onChanged.removeListener(this.onStorage);
    this.chrome.runtime.onMessage.removeListener(this.onMessage);
    this.document.removeEventListener("visibilitychange", this.onVisibility);
    this.window.removeEventListener("unload", this.onUnload);
  }
}
