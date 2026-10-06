export const BOOKMARK_PREFIX = "videoBookmarks:";
export const MAX_BOOKMARK_NOTE = 250;
export const MAX_BOOKMARKS = 100;

export class ChromeBookmarkRepository {
  constructor(storage, makeId = () => globalThis.crypto.randomUUID()) {
    this.storage = storage;
    this.makeId = makeId;
    this.chain = Promise.resolve();
  }

  list(key) { return this.#enqueue(() => this.#load(key)); }

  save(key, time, note = "") {
    return this.#enqueue(async () => {
      if (typeof time !== "number" || !Number.isFinite(time) || time < 0) throw new Error("Choose a valid video time.");
      if (typeof note !== "string" || note.length > MAX_BOOKMARK_NOTE) throw new Error("Keep the bookmark note within 250 characters.");
      const items = await this.#load(key);
      if (items.length >= MAX_BOOKMARKS) throw new Error("This video has 100 bookmarks. Remove one before saving another.");
      const item = { id: this.makeId(), time, note: note.trim() };
      items.push(item);
      items.sort((a, b) => a.time - b.time);
      await this.storage.set({ [BOOKMARK_PREFIX + key]: items });
      return { key, item };
    });
  }

  remove(key, id) {
    return this.#enqueue(async () => {
      if (typeof id !== "string" || !id) throw new Error("Choose a bookmark to remove.");
      const items = await this.#load(key);
      await this.storage.set({ [BOOKMARK_PREFIX + key]: items.filter((item) => item.id !== id) });
      return { key };
    });
  }

  #enqueue(work) {
    const operation = this.chain.then(work);
    this.chain = operation.catch(() => {});
    return operation;
  }

  async #load(key) {
    if (typeof key !== "string" || !key || key.length > 4096) throw new Error("This video doesn't have a stable bookmark identity.");
    const stored = await this.storage.get(BOOKMARK_PREFIX + key);
    const items = stored[BOOKMARK_PREFIX + key];
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.some((item) => !item || typeof item.id !== "string"
      || typeof item.time !== "number" || !Number.isFinite(item.time) || item.time < 0
      || typeof item.note !== "string")) throw new Error("Couldn't read this video's saved bookmarks.");
    return items.map(({ id, time, note }) => ({ id, time, note })).sort((a, b) => a.time - b.time);
  }
}
