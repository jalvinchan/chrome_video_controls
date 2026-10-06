import { ChromeVideoStage } from "../video/chrome-video-stage.js";
import { ChromeTranscriptSource } from "../transcript/chrome-transcript-source.js";
import { ChromeTranscriptRepository } from "../transcript/chrome-transcript-repository.js";
import { TranscriptPanel } from "../app/transcript-panel.js";
import { TranscriptView } from "../presentation/transcript-view.js";

const video = new ChromeVideoStage(chrome);
const view = new TranscriptView(document);
const panel = new TranscriptPanel({ chrome, window, document, video, view,
  source: new ChromeTranscriptSource(video), repository: new ChromeTranscriptRepository(chrome.storage.local) });
panel.start().catch((error) => view.setStatus(error.message, "error"));
