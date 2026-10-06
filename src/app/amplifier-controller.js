import { captureRefusal } from "../model/capture-target.js";
import { CaptureSession } from "../model/capture-session.js";
import { GainLevel } from "../model/gain-level.js";
import { sitePreferenceKey } from "../storage/chrome-site-preferences.js";

export class AmplifierController {
  constructor({ repository, preferences, capture, stage }) {
    this.repository = repository;
    this.preferences = preferences;
    this.capture = capture;
    this.stage = stage;
    this.session = null;
    this.loaded = null;
    this.chain = Promise.resolve();
  }

  snapshot(tab) {
    return this.#enqueue(() => this.#snapshot(tab));
  }

  start(tab) {
    return this.#enqueue(async () => {
      if (typeof tab?.id !== "number") throw new Error("start amplifier: missing tab");
      const refusal = captureRefusal(tab.url);
      if (refusal) throw new Error(refusal);
      if (this.session.live && this.session.tabId === tab.id) {
        await this.#syncTab(tab);
        return this.session.toJSON();
      }
      const level = await this.preferences.loadLevel(tab.url);
      if (this.session.live) await this.#release();

      await this.stage.open();
      try {
        const streamId = await this.capture.getStreamId(tab.id);
        await this.stage.play(streamId, level);
        this.session = new CaptureSession({
          tabId: tab.id,
          title: typeof tab.title === "string" ? tab.title : "",
          url: tab.url,
          level,
        });
        await this.repository.saveLevel(level);
        await this.repository.saveTab(this.session);
      } catch (error) {
        try {
          await this.#release();
        } catch {
          // The tab was not kept. Surface the original failure.
        }
        throw new Error(`Could not amplify this tab. ${error.message}`);
      }
      return this.session.toJSON();
    });
  }

  stop() {
    return this.#enqueue(async () => {
      if (this.session.live) await this.#release();
      const level = GainLevel.default();
      this.session = this.session.withLevel(level);
      await this.repository.saveLevel(level);
      return this.session.toJSON();
    });
  }

  setLevel(sliderValue, tab) {
    return this.#enqueue(async () => {
      const level = new GainLevel(sliderValue);
      if (tab) await this.#syncTab(tab);
      const target = tab ?? (this.session.url ? { id: this.session.tabId, url: this.session.url } : null);
      // Editing this site's default must not alter another tab's captured audio.
      const apply = !target || !this.session.live || this.session.tabId === target.id;
      if (apply && this.session.live) await this.stage.setGain(level);
      try {
        if (target) await this.preferences.saveLevel(target.url, level);
        if (apply) await this.repository.saveLevel(level);
      } catch (error) {
        if (apply && this.session.live) await this.stage.setGain(this.session.level);
        throw error;
      }
      if (apply) this.session = this.session.withLevel(level);
      return this.#snapshot(tab);
    });
  }

  tabClosed(tabId) {
    return this.#enqueue(() => this.#dropTab(tabId));
  }

  tabNavigated(tab) {
    return this.#enqueue(() => this.#syncTab(tab));
  }

  async #syncTab(tab) {
    if (!tab?.url || !this.session.live || this.session.tabId !== tab.id) return;
    if (captureRefusal(tab.url)) { await this.#release(); return; }
    if (this.session.url && sitePreferenceKey(this.session.url, "sliderValue")
      === sitePreferenceKey(tab.url, "sliderValue")) return;
    const level = await this.preferences.loadLevel(tab.url);
    await this.stage.setGain(level);
    this.session = new CaptureSession({ tabId: tab.id, title: tab.title, url: tab.url, level });
    await this.repository.saveLevel(level);
    await this.repository.saveTab(this.session);
  }

  async #snapshot(tab) {
    await this.#syncTab(tab);
    const state = this.session.toJSON();
    if (!tab?.url || captureRefusal(tab.url)) return state;
    if (this.session.live && this.session.tabId === tab.id) return state;
    return { ...state, capturedSliderValue: state.sliderValue,
      sliderValue: (await this.preferences.loadLevel(tab.url)).sliderValue };
  }

  captureEnded() {
    return this.#enqueue(async () => {
      if (!this.session.live) return this.session.toJSON();
      await this.#release();
      return this.session.toJSON();
    });
  }

  #enqueue(task) {
    const run = this.chain.then(async () => {
      await this.#ensureLoaded();
      return task();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #ensureLoaded() {
    if (!this.loaded) this.loaded = this.#load();
    await this.loaded;
  }

  async #load() {
    const stored = await this.repository.load();
    const live = stored.tabId != null && (await this.stage.isOpen());
    if (stored.tabId != null && !live) await this.repository.clearTab();
    this.session = live
      ? new CaptureSession({ tabId: stored.tabId, title: stored.title, url: stored.url, level: stored.level })
      : CaptureSession.idle(stored.level);
  }

  async #dropTab(tabId) {
    if (!this.session.live || this.session.tabId !== tabId) return this.session.toJSON();
    await this.#release();
    return this.session.toJSON();
  }

  async #release() {
    await this.stage.halt();
    this.session = CaptureSession.idle(this.session.level);
    await this.repository.clearTab();
  }
}
