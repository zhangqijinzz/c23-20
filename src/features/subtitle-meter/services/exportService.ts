import type { Format, SubtitleCue } from "../models";
import { formatSubtitles } from "../formatters/subtitleFormatter";
export function downloadSubtitles(
  name: string,
  cues: SubtitleCue[],
  format: Format,
): void {
  const blob = new Blob([formatSubtitles(cues, format)], {
    type:
      format === "vtt" ? "text/vtt;charset=utf-8" : "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/\.(srt|vtt)$/i, "")}-checked.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
