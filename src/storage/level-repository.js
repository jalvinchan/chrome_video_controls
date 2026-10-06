export class LevelRepository {
  async load() {
    throw new Error("LevelRepository.load is not implemented");
  }

  async saveLevel(_level) {
    throw new Error("LevelRepository.saveLevel is not implemented");
  }

  async saveTab(_session) {
    throw new Error("LevelRepository.saveTab is not implemented");
  }

  async clearTab() {
    throw new Error("LevelRepository.clearTab is not implemented");
  }
}
