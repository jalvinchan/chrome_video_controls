import { AmplifierMessage } from "../model/message-kinds.js";

export class AmplifierClient {
  constructor(runtime) {
    this.runtime = runtime;
  }

  snapshot(tab) {
    return this.#send({ type: AmplifierMessage.snapshot, tab });
  }

  start(tab) {
    return this.#send({ type: AmplifierMessage.start, tab });
  }

  stop() {
    return this.#send({ type: AmplifierMessage.stop });
  }

  setLevel(sliderValue, tab) {
    return this.#send({ type: AmplifierMessage.setLevel, sliderValue, tab });
  }

  async #send(message) {
    let response;
    try {
      response = await this.runtime.sendMessage(message);
    } catch (error) {
      throw new Error(`reach Amplifier background: ${error.message}`);
    }
    if (!response?.ok) {
      throw new Error(response?.error || "Amplifier background did not respond.");
    }
    return response.result;
  }
}
