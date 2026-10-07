import type { Format, SubtitleCue } from "../models";
import { parseTimestamp } from "./timecode";
export function detectFormat(name: string): Format {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "srt" || ext === "vtt") return ext;
  throw new Error("仅支持 .srt 或 .vtt 文件");
}
export function parseSubtitles(raw: string, format: Format): SubtitleCue[] {
  const source = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = source
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const cues: SubtitleCue[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split("\n");
    if (format === "vtt" && blockIndex === 0 && lines[0]?.startsWith("WEBVTT"))
      continue;
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0] ?? "")) continue;
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) throw new Error(`第 ${blockIndex + 1} 段缺少时间码`);
    const [from, toWithSettings] = lines[timeIndex].split("-->");
    const startMs = parseTimestamp(from),
      endMs = parseTimestamp(toWithSettings.trim().split(/\s+/)[0]);
    if (endMs <= startMs)
      throw new Error(`第 ${blockIndex + 1} 段结束时间必须晚于开始时间`);
    cues.push({
      id: `cue-${cues.length + 1}`,
      index: cues.length + 1,
      startMs,
      endMs,
      text: lines
        .slice(timeIndex + 1)
        .join("\n")
        .trim(),
    });
  }
  if (!cues.length) throw new Error("没有找到可用字幕条目");
  return cues;
}
