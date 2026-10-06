export class OffscreenSession {
  constructor({ opener, graphFactory }) {
    this.opener = opener;
    this.graphFactory = graphFactory;
    this.graph = null;
    this.stream = null;
    this.onEnded = () => {};
  }

  async play(streamId, level) {
    if (typeof streamId !== "string" || streamId === "") {
      throw new Error("play tab audio: missing stream");
    }
    await this.halt();
    const graph = this.graphFactory();
    let stream;
    try {
      stream = await this.opener.open(streamId);
      await graph.start(stream, level);
    } catch (error) {
      await graph.stop();
      if (stream) this.#stopTracks(stream);
      if (error instanceof Error && /^(open|play) tab audio:/.test(error.message)) throw error;
      throw new Error(`play tab audio: ${error.message}`);
    }
    this.stream = stream;
    this.graph = graph;
    const [track] = stream.getAudioTracks?.() ?? [];
    track?.addEventListener("ended", () => {
      if (this.stream !== stream) return;
      this.halt().then(() => this.onEnded(), () => this.onEnded());
    });
  }

  setGain(level) {
    if (!this.graph) throw new Error("set gain: amplifier is not running");
    this.graph.setGain(level);
  }

  async halt() {
    const stream = this.stream;
    const graph = this.graph;
    this.stream = null;
    this.graph = null;
    if (graph) await graph.stop();
    this.#stopTracks(stream);
  }

  #stopTracks(stream) {
    for (const track of stream?.getTracks?.() ?? []) track.stop?.();
  }
}
