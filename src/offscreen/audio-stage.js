export class AudioStage {
  async open() {
    throw new Error("AudioStage.open is not implemented");
  }

  async isOpen() {
    throw new Error("AudioStage.isOpen is not implemented");
  }

  async play(_streamId, _level) {
    throw new Error("AudioStage.play is not implemented");
  }

  async setGain(_level) {
    throw new Error("AudioStage.setGain is not implemented");
  }

  async halt() {
    throw new Error("AudioStage.halt is not implemented");
  }
}
