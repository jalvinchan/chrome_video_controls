import { normalizeCues } from "./transcript.js";

export const TRANSCRIPT_PREFIX = "videoTranscript:";

export class ChromeTranscriptRepository {
  constructor(storage) { this.storage = storage; }

  storageKey(key) {
    if (typeof key !== "string" || !key || key.length > 4096) throw new Error("Choose a loaded video before importing subtitles.");
    return TRANSCRIPT_PREFIX + key;
  }

  async load(key) {
    const id = this.storageKey(key);
    const value = (await this.storage.get(id))[id];
    if (value === undefined) return null;
    if (value?.version !== 1 || typeof value.name !== "string") throw new Error("The saved transcript could not be read. Import the file again.");
    return { name: value.name, cues: normalizeCues(value.cues) };
  }

  async save(key, name, cues) {
    const id = this.storageKey(key);
    if (typeof name !== "string" || !name.trim() || name.length > 255) throw new Error("Choose a subtitle file with a valid name.");
    const record = { version: 1, name, cues: normalizeCues(cues) };
    // Each import replaces one complete record atomically; there is no read/modify/write.
    await this.storage.set({ [id]: record });
    return record;
  }

  async remove(key) { await this.storage.remove(this.storageKey(key)); }
}
