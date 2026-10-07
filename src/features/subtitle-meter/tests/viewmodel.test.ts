import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { projectRepository } from "../repositories/projectRepository";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";
vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(
    async () => "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
  ),
}));
vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    load: vi.fn(async () => null),
    saveCurrent: vi.fn(async () => undefined),
    saveVersion: vi.fn(async () => undefined),
    loadVersionCues: vi.fn(async () => null),
    deleteVersions: vi.fn(async () => undefined),
    estimateStorage: vi.fn(async () => ({
      totalBytes: null,
      snapshotBytes: 0,
      snapshotCount: 0,
    })),
  },
}));
vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));
describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vi.clearAllMocks();
    vm = new SubtitleMeterViewModel();
  });
  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });
  it("keeps a recoverable error when an unsupported import is selected", async () => {
    await vm.importFile(new File(["x"], "clip.txt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("仅支持");
  });
  it("shows a parse failure as a recoverable import error", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("缺少时间码");
  });
  it("keeps editing visible immediately and reports export failures", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    const cue = vm.state.project!.cues[0];
    const saving = vm.editCue(cue.id, { text: "Immediate edit" });
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
    await saving;
    vi.mocked(downloadSubtitles).mockImplementationOnce(() => {
      throw new Error("download unavailable");
    });
    await vm.exportFile();
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("导出失败");
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
  });
  it("saves snapshot bodies separately and keeps only metadata in the project", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.editCue(vm.state.project!.cues[0].id, { text: "Edited" });
    await vm.saveVersion();
    expect(vi.mocked(projectRepository.saveVersion)).toHaveBeenCalledWith(
      expect.objectContaining({
        cues: [expect.objectContaining({ text: "Edited" })],
      }),
    );
    const meta = vm.state.project!.versions[0];
    expect(meta).not.toHaveProperty("cues");
    // 保存快照后写入当前项目时只带元数据
    const lastSaved = vi
      .mocked(projectRepository.saveCurrent)
      .mock.calls.at(-1)![0];
    expect(lastSaved.versions[0]).not.toHaveProperty("cues");
  });
  it("loads snapshot cues on demand when restoring a version", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.saveVersion();
    const meta = vm.state.project!.versions[0];
    await vm.editCue(vm.state.project!.cues[0].id, { text: "Later edit" });
    vi.mocked(projectRepository.loadVersionCues).mockResolvedValueOnce([
      { id: "cue-x", index: 1, startMs: 0, endMs: 1000, text: "From snapshot" },
    ]);
    await vm.restoreVersion(meta.id);
    expect(vi.mocked(projectRepository.loadVersionCues)).toHaveBeenCalledWith(
      meta.id,
    );
    expect(vm.state.project!.cues[0].text).toBe("From snapshot");
    expect(vm.state.notice).toContain(meta.label);
  });
  it("keeps current cues untouched when a snapshot body is missing", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.saveVersion();
    const meta = vm.state.project!.versions[0];
    await vm.editCue(vm.state.project!.cues[0].id, { text: "Keep me" });
    await vm.restoreVersion(meta.id);
    expect(vm.state.phase).toBe("error");
    expect(vm.state.project!.cues[0].text).toBe("Keep me");
  });
  it("cleans up old snapshots without touching current editing content", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.editCue(vm.state.project!.cues[0].id, { text: "Current work" });
    await vm.saveVersion();
    await vm.saveVersion();
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(3);
    await vm.cleanupVersions(1);
    expect(vm.state.project!.versions).toHaveLength(1);
    expect(vi.mocked(projectRepository.deleteVersions)).toHaveBeenCalledTimes(
      1,
    );
    const removedIds = vi.mocked(projectRepository.deleteVersions).mock
      .calls[0][0];
    expect(removedIds).toHaveLength(2);
    expect(vm.state.project!.cues[0].text).toBe("Current work");
    await vm.cleanupVersions(0);
    expect(vm.state.project!.versions).toHaveLength(0);
    expect(vm.state.project!.cues[0].text).toBe("Current work");
  });
  it("refreshes storage usage into state", async () => {
    vi.mocked(projectRepository.estimateStorage).mockResolvedValueOnce({
      totalBytes: 4096,
      snapshotBytes: 1024,
      snapshotCount: 2,
    });
    await vm.refreshStorage();
    expect(vm.state.storage).toEqual({
      totalBytes: 4096,
      snapshotBytes: 1024,
      snapshotCount: 2,
    });
  });
});
