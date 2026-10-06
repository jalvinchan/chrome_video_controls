import { TabStreamOpener } from "./tab-stream-opener.js";

export class ChromeTabStreamOpener extends TabStreamOpener {
  constructor(mediaDevices) {
    super();
    this.mediaDevices = mediaDevices;
  }

  async open(streamId) {
    try {
      // Chrome still only accepts this legacy constraint shape for tab capture.
      return await this.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      });
    } catch (error) {
      throw new Error(`open tab audio: ${error.message}`);
    }
  }
}
