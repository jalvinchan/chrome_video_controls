import { captionText, normalizeCues } from "./transcript.js";

export class ChromeTranscriptSource {
  constructor(video) { this.video = video; }

  list(tabId, key) { return this.video.listTranscriptTracks(tabId, key); }

  async read(tabId, key, trackId) {
    const cues = normalizeCues((await this.video.readTranscriptTrack(tabId, key, trackId))
      .map((cue) => ({ ...cue, text: captionText(cue.text) })));
    if ((await this.video.snapshot(tabId)).bookmarkKey !== key) throw new Error("The video changed. Refresh the transcript.");
    return cues;
  }
}
