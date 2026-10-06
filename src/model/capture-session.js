export class CaptureSession {
  constructor({ tabId = null, title = "", url = "", level }) {
    if (!level) throw new Error("capture session: missing gain");
    this.tabId = tabId;
    this.title = title;
    this.url = url;
    this.level = level;
  }

  static idle(level) {
    return new CaptureSession({ level });
  }

  get live() {
    return this.tabId != null;
  }

  withLevel(level) {
    return new CaptureSession({ tabId: this.tabId, title: this.title, url: this.url, level });
  }

  toJSON() {
    return {
      live: this.live,
      tabId: this.tabId,
      title: this.title,
      sliderValue: this.level.sliderValue,
    };
  }
}
