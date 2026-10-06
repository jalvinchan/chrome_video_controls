export class BookmarkClient {
  constructor(runtime) { this.runtime = runtime; }

  list(key) { return this.#send({ type: "list", key }); }

  save(key, time, note) { return this.#send({ type: "save", key, time, note }); }

  remove(key, id) { return this.#send({ type: "remove", key, id }); }

  async #send(message) {
    const response = await this.runtime.sendMessage({ target: "bookmarks", ...message });
    if (!response?.ok) throw new Error(response?.error || "Bookmarks did not respond.");
    return response.result;
  }
}
