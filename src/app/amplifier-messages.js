import { AmplifierMessage } from "../model/message-kinds.js";

export async function handleAmplifierMessage(app, message) {
  switch (message?.type) {
    case AmplifierMessage.snapshot:
      return app.snapshot(message.tab);
    case AmplifierMessage.start:
      return app.start(message.tab);
    case AmplifierMessage.stop:
      return app.stop();
    case AmplifierMessage.setLevel:
      return app.setLevel(message.sliderValue, message.tab);
    case AmplifierMessage.captureEnded:
      return app.captureEnded();
    default:
      throw new Error("Unknown Amplifier message.");
  }
}
