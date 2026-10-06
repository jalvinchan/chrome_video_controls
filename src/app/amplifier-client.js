import { AmplifierMessage } from "../model/message-kinds.js";

export class AmplifierClient {
  constructor(runtime) {
    this.runtime = runtime;
  }

  snapshot() {
    return this.#send({ type: AmplifierMessage.snapshot });
  }

  start(tab) {
    return this.#send({ type: AmplifierMessage.start, tab });
  }

  stop() {
    return this.#send({ type: AmplifierMessage.stop });
  }

  setLevel(percent) {
    return this.#send({ type: AmplifierMessage.setLevel, percent });
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
