import { DEFAULT_PERCENT, GainLevel } from "../model/gain-level.js";
import { LevelRepository } from "./level-repository.js";

const PERCENT = "percent";
const TAB_ID = "tabId";
const TITLE = "title";

export class ChromeLevelRepository extends LevelRepository {
  constructor(storage) {
    super();
    this.storage = storage;
  }

  async load() {
    try {
      const stored = await this.storage.get([PERCENT, TAB_ID, TITLE]);
      const percent = typeof stored?.percent === "number" ? stored.percent : DEFAULT_PERCENT;
      return {
        level: new GainLevel(percent),
        tabId: typeof stored?.tabId === "number" ? stored.tabId : null,
        title: typeof stored?.title === "string" ? stored.title : "",
      };
    } catch (error) {
      throw new Error(`load amplifier: ${error.message}`);
    }
  }

  async saveLevel(level) {
    try {
      await this.storage.set({ [PERCENT]: level.percent });
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
