import { describe, expect, it } from "vitest";
import { detectIssues } from "../analyzers/issueDetector";
import type { SubtitleCue } from "../models";
const cue = (
  id: string,
  startMs: number,
  endMs: number,
  text: string,
): SubtitleCue => ({ id, index: Number(id), startMs, endMs, text });
describe("issue detection", () => {
  it("distinguishes touching edges from overlap", () => {
    expect(
      detectIssues([cue("1", 0, 1000, "A"), cue("2", 1000, 2000, "B")]).some(
        (i) => i.type === "overlap",
      ),
    ).toBe(false);
    expect(
      detectIssues([cue("1", 0, 1300, "A"), cue("2", 1000, 2000, "B")]).some(
        (i) => i.type === "overlap",
      ),
    ).toBe(true);
  });
  it("detects empty, short, fast, and long captions", () => {
    const issues = detectIssues([
      cue("1", 0, 100, ""),
      cue("2", 1000, 1300, "这是一个用于检查速度的非常长的字幕内容".repeat(3)),
    ]);
    expect(issues.map((i) => i.type)).toEqual(
      expect.arrayContaining(["empty", "too-short", "too-fast", "too-long"]),
    );
  });
});
