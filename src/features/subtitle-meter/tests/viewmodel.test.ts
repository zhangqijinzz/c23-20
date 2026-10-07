import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";
import { projectRepository } from "../repositories/projectRepository";
vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(
    async () => "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
  ),
}));
vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    replace: vi.fn(async () => undefined),
    saveCuePatch: vi.fn(async () => undefined),
    replaceCues: vi.fn(async () => undefined),
    saveMetaPatch: vi.fn(async () => undefined),
    addVersion: vi.fn(async () => undefined),
    loadVersionCues: vi.fn(async () => []),
    deleteVersion: vi.fn(async () => undefined),
    clearVersions: vi.fn(async () => undefined),
    storageInfo: vi.fn(async () => null),
  },
}));
vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));
describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
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
    expect(projectRepository.addVersion).toHaveBeenCalledTimes(1);
    // 编辑过程中快照存储不会被触碰
    await vm.editCue(cue.id, { text: "Edited again" });
    expect(projectRepository.addVersion).toHaveBeenCalledTimes(1);
    expect(projectRepository.saveCuePatch).toHaveBeenCalled();
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });
  it("restores a snapshot by lazily loading its cues", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.saveVersion();
    const versionId = vm.state.project!.versions[0].id;
    vi.mocked(projectRepository.loadVersionCues).mockResolvedValueOnce([
      { id: "cue-1", index: 1, startMs: 100, endMs: 2000, text: "Snapshot" },
    ]);
    await vm.restoreVersion(versionId);
    expect(projectRepository.loadVersionCues).toHaveBeenCalledWith(versionId);
    expect(vm.state.project!.cues[0].text).toBe("Snapshot");
  });
  it("clears snapshots without touching current cues", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.saveVersion();
    await vm.editCue(vm.state.project!.cues[0].id, { text: "Keep me" });
    await vm.clearVersions();
    expect(projectRepository.clearVersions).toHaveBeenCalledTimes(1);
    expect(vm.state.project!.versions).toHaveLength(0);
    expect(vm.state.project!.cues[0].text).toBe("Keep me");
  });
  it("deletes a single snapshot and keeps the current content", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.saveVersion();
    await vm.saveVersion();
    const [first, second] = vm.state.project!.versions;
    await vm.deleteVersion(first.id);
    expect(vm.state.project!.versions.map((v) => v.id)).toEqual([second.id]);
    expect(projectRepository.deleteVersion).toHaveBeenCalledWith(
      first.id,
      [second],
      expect.any(Number),
    );
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
});
