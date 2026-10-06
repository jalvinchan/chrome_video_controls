export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
export const MAX_TRANSCRIPT_CUES = 20000;

// Caption markup is formatting, never executable panel content.
export function captionText(text) {
  if (typeof text !== "string") throw new Error("The subtitle track contains an unreadable text cue.");
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()];
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  }).trim();
}

export function normalizeCues(cues) {
  if (!Array.isArray(cues) || !cues.length) throw new Error("No subtitle lines were found in this track.");
  if (cues.length > MAX_TRANSCRIPT_CUES) throw new Error("Use a transcript with at most 20,000 lines.");
  const result = cues.map((cue) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < 0 || cue.end <= cue.start || typeof cue.text !== "string") {
      throw new Error("The transcript contains an invalid timestamp or subtitle line.");
    }
    return { start: cue.start, end: cue.end, text: cue.text.trim() };
  }).filter((cue) => cue.text).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!result.length) throw new Error("No subtitle lines were found in this track.");
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_TRANSCRIPT_BYTES) {
    throw new Error("Use a transcript smaller than 2 MB.");
  }
  return result;
}

function timestamp(value) {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error("The subtitle file contains an invalid timestamp.");
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

export function parseSubtitleFile(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > MAX_TRANSCRIPT_BYTES) {
    throw new Error("Choose an SRT or VTT file smaller than 2 MB.");
  }
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text);
  const blocks = text.split(/\n[ \t]*\n+/);
  const cues = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const lines = blocks[index].split("\n");
    if (vtt && ((index === 0 && /^WEBVTT/.test(lines[0])) || /^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0]))) continue;
    const timingIndex = lines[0].includes("-->") ? 0 : 1;
    const timing = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+.*)?$/.exec(lines[timingIndex] ?? "");
    if (!timing) throw new Error("The subtitle file contains a malformed cue. Choose a valid SRT or VTT file.");
    if (!vtt && timingIndex === 1 && !/^\d+$/.test(lines[0])) throw new Error("Choose a valid SRT or VTT file.");
    cues.push({ start: timestamp(timing[1]), end: timestamp(timing[2]), text: captionText(lines.slice(timingIndex + 1).join("\n")) });
  }
  return normalizeCues(cues);
}

export function formatTranscriptTime(seconds) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(total % 60).padStart(2, "0")}`;
}
