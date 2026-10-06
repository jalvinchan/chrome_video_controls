import { TabCapturePort } from "./tab-capture-port.js";

export class ChromeTabCapturePort extends TabCapturePort {
  constructor(tabCapture) {
    super();
    this.tabCapture = tabCapture;
  }

  async getStreamId(tabId) {
    try {
      return await this.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (error) {
      throw new Error(`capture tab ${tabId}: ${error.message}`);
    }
  }
}
