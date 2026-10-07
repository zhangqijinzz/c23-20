import { describe, expect, it } from "vitest";
import { parseSubtitles } from "../parsers/subtitleParser";
import { formatSubtitles } from "../formatters/subtitleFormatter";
describe("subtitle parser and formatter", () => {
  it("parses multiline SRT and preserves text on round trip", () => {
    const raw =
      "1\n00:00:01,120 --> 00:00:03,500\n第一行\n第二行\n\n2\n00:00:04,000 --> 00:00:06,000\n结束";
    const cues = parseSubtitles(raw, "srt");
    expect(cues[0]).toMatchObject({
      startMs: 1120,
      endMs: 3500,
      text: "第一行\n第二行",
    });
    expect(parseSubtitles(formatSubtitles(cues, "srt"), "srt")).toEqual(cues);
  });
  it("parses WebVTT headers and cue settings", () => {
    const cues = parseSubtitles(
      "WEBVTT\n\n00:00:00.500 --> 00:00:02.000 align:start\nHello\n\n00:00:02.100 --> 00:00:03.000\nWorld",
      "vtt",
    );
    expect(cues).toHaveLength(2);
    expect(cues[0].startMs).toBe(500);
  });
  it("reports malformed and reversed timecodes", () => {
    expect(() => parseSubtitles("1\nwrong --> time\nOops", "srt")).toThrow(
      "无法解析时间码",
    );
    expect(() =>
      parseSubtitles("1\n00:00:02,000 --> 00:00:01,000\nOops", "srt"),
    ).toThrow("结束时间");
  });
});
