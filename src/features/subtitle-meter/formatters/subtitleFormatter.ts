import type { Format, SubtitleCue } from "../models";
import { formatTimestamp } from "../parsers/timecode";
export function formatSubtitles(cues: SubtitleCue[], format: Format): string {
  const body = [...cues]
    .sort((a, b) => a.startMs - b.startMs)
    .map(
      (cue, i) =>
        `${format === "srt" ? i + 1 : cue.id}\n${formatTimestamp(cue.startMs, format)} --> ${formatTimestamp(cue.endMs, format)}\n${cue.text}`,
    )
    .join("\n\n");
  return format === "vtt" ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}
