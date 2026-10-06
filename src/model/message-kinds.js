export const AmplifierMessage = Object.freeze({
  snapshot: "snapshot",
  start: "start",
  stop: "stop",
  setLevel: "setLevel",
  captureEnded: "captureEnded",
});

export const OffscreenMessage = Object.freeze({
  play: "play",
  applyLevel: "applyLevel",
  halt: "halt",
});

const amplifierTypes = new Set(Object.values(AmplifierMessage));

export function isAmplifierMessage(message) {
  return amplifierTypes.has(message?.type) && !message?.target;
}

export function isOffscreenMessage(message) {
  return message?.target === "offscreen";
}
