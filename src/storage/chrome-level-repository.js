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
      const stored = await this.storage.get([SLIDER_VALUE, TAB_ID, TITLE]);
      // Old percentage settings use a different scale. Start those users at
      // 0 dB rather than interpreting a value such as 200 as maximum boost.
      const sliderValue = typeof stored?.sliderValue === "number" && Number.isFinite(stored.sliderValue)
        ? stored.sliderValue
        : DEFAULT_LEVEL;
      return {
        level: new GainLevel(sliderValue),
        tabId: typeof stored?.tabId === "number" ? stored.tabId : null,
        title: typeof stored?.title === "string" ? stored.title : "",
      };
    } catch (error) {
      throw new Error(`load amplifier: ${error.message}`);
    }
  }

  async saveLevel(level) {
    try {
      await this.storage.set({ [SLIDER_VALUE]: level.sliderValue });
    } catch (error) {
      throw new Error(`save amplifier level: ${error.message}`);
    }
  }

  async saveTab(session) {
    try {
      await this.storage.set({ [TAB_ID]: session.tabId, [TITLE]: session.title });
    } catch (error) {
      throw new Error(`save amplifier tab: ${error.message}`);
    }
  }

  async clearTab() {
    try {
      await this.storage.set({ [TAB_ID]: null, [TITLE]: "" });
    } catch (error) {
      throw new Error(`save amplifier tab: ${error.message}`);
    }
  }
}
