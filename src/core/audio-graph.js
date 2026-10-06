// High-ratio compression reduces loud peaks after gain. This is not a strict
// output ceiling; attack behavior and automatic makeup gain can affect peaks.
const LIMITER = Object.freeze({
  threshold: -1,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.1,
});

const GAIN_RAMP_SECONDS = 0.015;

export class AudioGraph {
  constructor(context) {
    this.context = context;
    this.source = null;
    this.gain = null;
    this.compressor = null;
  }

  async start(stream, level) {
    if (this.context.state === "suspended") await this.context.resume();
    this.source = this.context.createMediaStreamSource(stream);
    this.gain = this.context.createGain();
    this.gain.gain.value = level.linear;
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = LIMITER.threshold;
    this.compressor.knee.value = LIMITER.knee;
    this.compressor.ratio.value = LIMITER.ratio;
    this.compressor.attack.value = LIMITER.attack;
    this.compressor.release.value = LIMITER.release;
    this.source.connect(this.gain);
    this.gain.connect(this.compressor);
    // Tab capture replaces the tab's own output. The stream has to reach
    // the speakers, or the tab stays silent.
    this.compressor.connect(this.context.destination);
  }

  setGain(level) {
    if (!this.gain) throw new Error("set gain: amplifier is not running");
    const param = this.gain.gain;
    if (typeof param.setTargetAtTime === "function" && typeof this.context.currentTime === "number") {
      param.setTargetAtTime(level.linear, this.context.currentTime, GAIN_RAMP_SECONDS);
      return;
    }
    param.value = level.linear;
  }

  async stop() {
    this.#disconnect(this.source);
    this.#disconnect(this.gain);
    this.#disconnect(this.compressor);
    this.source = null;
    this.gain = null;
    this.compressor = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }

  #disconnect(node) {
    try {
      node?.disconnect();
    } catch {
      // Already disconnected, or the context has closed.
    }
  }
}
