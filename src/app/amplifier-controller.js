import { captureRefusal } from "../model/capture-target.js";
import { CaptureSession } from "../model/capture-session.js";
import { GainLevel } from "../model/gain-level.js";

export class AmplifierController {
  constructor({ repository, capture, stage }) {
    this.repository = repository;
    this.capture = capture;
    this.stage = stage;
    this.session = null;
    this.loaded = null;
    this.chain = Promise.resolve();
  }

  snapshot() {
    return this.#enqueue(async () => this.session.toJSON());
  }

  start(tab) {
    return this.#enqueue(async () => {
      if (typeof tab?.id !== "number") throw new Error("start amplifier: missing tab");
      const refusal = captureRefusal(tab.url);
      if (refusal) throw new Error(refusal);
      if (this.session.live && this.session.tabId === tab.id) return this.session.toJSON();
      if (this.session.live) await this.#release();

      await this.stage.open();
      try {
        const streamId = await this.capture.getStreamId(tab.id);
        await this.stage.play(streamId, this.session.level);
        this.session = new CaptureSession({
          tabId: tab.id,
          title: typeof tab.title === "string" ? tab.title : "",
          level: this.session.level,
        });
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
      if (!this.session.live) return this.session.toJSON();
      await this.#release();
      return this.session.toJSON();
    });
  }

  setLevel(percent) {
    return this.#enqueue(async () => {
      const level = new GainLevel(percent);
      if (this.session.live) await this.stage.setGain(level);
      this.session = this.session.withLevel(level);
      await this.repository.saveLevel(level);
      return this.session.toJSON();
    });
  }

  tabClosed(tabId) {
    return this.#enqueue(() => this.#dropTab(tabId));
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
      ? new CaptureSession({ tabId: stored.tabId, title: stored.title, level: stored.level })
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
