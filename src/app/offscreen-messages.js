import { GainLevel } from "../model/gain-level.js";
import { OffscreenMessage } from "../model/message-kinds.js";

export async function handleOffscreenMessage(session, message) {
  switch (message?.type) {
    case OffscreenMessage.play:
      await session.play(message.streamId, new GainLevel(message.sliderValue));
      return null;
    case OffscreenMessage.applyLevel:
      session.setGain(new GainLevel(message.sliderValue));
      return null;
    case OffscreenMessage.halt:
      await session.halt();
      return null;
    default:
      throw new Error("Unknown Amplifier audio message.");
  }
}
