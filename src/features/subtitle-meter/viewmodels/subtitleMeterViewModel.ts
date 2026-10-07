import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  emptyState,
  type Format,
  type MeterState,
  type SubtitleCue,
  type SubtitleProject,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
  ) {
    project.updatedAt = Date.now();
    const issues = detectIssues(project.cues);
    this.publish({ project, issues, phase, notice: "" });
    try {
      await projectRepository.saveCurrent(project);
    } catch {
      if (this.state.project?.updatedAt === project.updatedAt) {
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
      }
    }
  }
  async restore() {
    try {
      const project = await projectRepository.load();
      if (project)
        this.publish({
          project,
          issues: detectIssues(project.cues),
          phase: "ready",
          selectedId: project.cues[0]?.id ?? null,
          notice: "已恢复上次编辑",
        });
    } catch {
      this.publish({ notice: "本地项目暂时无法读取，可继续导入字幕文件" });
    }
  }
  async importFile(file: File) {
    this.publish({ phase: "importing", notice: "正在读取并解析字幕文件…" });
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      const project: SubtitleProject = {
        id: "subtitle-meter.current.v1",
        name: file.name,
        format,
        cues,
        updatedAt: Date.now(),
        versions: [],
      };
      this.publish({
        selectedId: cues[0].id,
        notice: `已解析 ${cues.length} 条字幕`,
      });
      await this.commit(project, "ready");
    } catch (error) {
      this.publish({
        phase: "error",
        notice:
          error instanceof Error ? error.message : "导入失败，请检查文件后重试",
      });
    }
  }
  selectCue(id: string) {
    this.publish({ selectedId: id });
  }
  setZoom(zoom: number) {
    this.publish({ zoom });
  }
  async editCue(
    id: string,
    patch: Partial<Pick<SubtitleCue, "text" | "startMs" | "endMs">>,
  ) {
    if (!this.state.project) return;
    const cues = this.state.project.cues.map((cue) =>
      cue.id === id ? { ...cue, ...patch } : cue,
    );
    await this.commit({ ...this.state.project, cues });
  }
  async saveVersion() {
    const project = this.state.project;
    if (!project) return;
    const snapshot = {
      id: `v-${Date.now()}-${project.versions.length + 1}`,
      label: `快照 ${project.versions.length + 1}`,
      savedAt: Date.now(),
      cues: structuredClone(project.cues),
    };
    try {
      await projectRepository.saveVersion(snapshot);
    } catch {
      this.publish({
        phase: "error",
        notice: "快照保存失败；当前编辑内容不受影响",
      });
      return;
    }
    const versions = [
      ...project.versions,
      { id: snapshot.id, label: snapshot.label, savedAt: snapshot.savedAt },
    ];
    await this.commit({ ...project, versions });
    this.publish({ notice: "已保存版本快照" });
  }
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    try {
      const cues = await projectRepository.loadVersionCues(id);
      if (!cues) throw new Error("snapshot body missing");
      await this.commit({ ...project, cues: structuredClone(cues) });
      this.publish({ notice: `已恢复${version.label}` });
    } catch {
      this.publish({
        phase: "error",
        notice: "快照内容读取失败，当前编辑内容未改动",
      });
    }
  }
  async cleanupVersions(keepLast = 0) {
    const project = this.state.project;
    if (!project || project.versions.length <= keepLast) return;
    const kept = keepLast === 0 ? [] : project.versions.slice(-keepLast),
      removed = project.versions.slice(
        0,
        project.versions.length - kept.length,
      );
    try {
      await projectRepository.deleteVersions(removed.map((item) => item.id));
    } catch {
      this.publish({
        phase: "error",
        notice: "快照清理失败，请稍后重试",
      });
      return;
    }
    await this.commit({ ...project, versions: kept });
    this.publish({
      notice: kept.length
        ? `已清理旧快照，保留最近 ${kept.length} 个`
        : "已清空全部快照",
    });
    void this.refreshStorage();
  }
  async refreshStorage() {
    try {
      const storage = await projectRepository.estimateStorage();
      this.publish({ storage });
    } catch {
      // 存储统计失败不影响编辑
    }
  }
  async exportFile() {
    const project = this.state.project;
    if (!project) return;
    this.publish({ phase: "exporting" });
    try {
      formatSubtitles(project.cues, project.format);
      downloadSubtitles(project.name, project.cues, project.format);
      this.publish({ phase: "ready", notice: "字幕文件已导出" });
    } catch {
      this.publish({
        phase: "error",
        notice: "导出失败，编辑内容已保留，请重试",
      });
    }
  }
  setFormat(format: Format) {
    const project = this.state.project;
    if (project) void this.commit({ ...project, format });
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
