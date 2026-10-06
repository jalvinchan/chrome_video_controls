import { DEFAULT_LEVEL, GainLevel } from "../model/gain-level.js";
import { LevelRepository } from "./level-repository.js";

const SLIDER_VALUE = "sliderValue";
const TAB_ID = "tabId";
const TITLE = "title";

export class ChromeLevelRepository extends LevelRepository {
  constructor(storage) {
    super();
    this.storage = storage;
  }

  async load() {
    try {
      const stored = await this.storage.get([SLIDER_VALUE, "liveSliderValue", TAB_ID, TITLE, "tabUrl"]);
      // Old percentage settings use a different scale. Start those users at
      // 0 dB rather than interpreting a value such as 200 as maximum boost.
      const value = stored?.liveSliderValue ?? stored?.sliderValue;
      const sliderValue = typeof value === "number" && Number.isFinite(value)
        ? value
        : DEFAULT_LEVEL;
      return {
        level: new GainLevel(sliderValue),
        tabId: typeof stored?.tabId === "number" ? stored.tabId : null,
        title: typeof stored?.title === "string" ? stored.title : "",
        url: typeof stored?.tabUrl === "string" ? stored.tabUrl : "",
      };
    } catch (error) {
      throw new Error(`load amplifier: ${error.message}`);
    }
  }

  async saveLevel(level) {
    try {
      await this.storage.set({ liveSliderValue: level.sliderValue });
    } catch (error) {
      throw new Error(`save amplifier level: ${error.message}`);
    }
  }

  async saveTab(session) {
    try {
      await this.storage.set({ [TAB_ID]: session.tabId, [TITLE]: session.title, tabUrl: session.url });
    } catch (error) {
      throw new Error(`save amplifier tab: ${error.message}`);
    }
  }

  async clearTab() {
    try {
      await this.storage.set({ [TAB_ID]: null, [TITLE]: "", tabUrl: "" });
    } catch (error) {
      throw new Error(`save amplifier tab: ${error.message}`);
    }
  }
}
