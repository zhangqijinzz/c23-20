import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  emptyState,
  type Format,
  type MeterState,
  type StorageInfo,
  type SubtitleCue,
  type SubtitleProject,
  type VersionMeta,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  private versionSeq = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private refreshStorage() {
    void projectRepository
      .storageInfo()
      .then((storage) => {
        if (this.state.storage !== storage) this.publish({ storage });
      })
      .catch(() => undefined);
  }
  /** 保存失败时进入可恢复的错误态，但页面内的修改不丢失 */
  private async persistOrWarn(
    project: SubtitleProject,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    project.updatedAt = Date.now();
    try {
      await persist();
      return true;
    } catch {
      if (this.state.project?.updatedAt === project.updatedAt) {
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
      }
      return false;
    }
  }
  /** 普通编辑：发布后只增量写变化的 cue，快照数据完全不动 */
  private async commitEdit(
    project: SubtitleProject,
    changedCue: SubtitleCue,
    phase: MeterState["phase"] = "editing",
  ) {
    const issues = detectIssues(project.cues);
    const ok = await this.persistOrWarn(project, () =>
      projectRepository.saveCuePatch({
        changedCue,
        updatedAt: project.updatedAt,
      }),
    );
    if (!ok) return;
    this.publish({ project, issues, phase, notice: "" });
  }
  async restore() {
    try {
      const project = await projectRepository.load();
      if (project) {
        this.publish({
          project,
          issues: detectIssues(project.cues),
          phase: "ready",
          selectedId: project.cues[0]?.id ?? null,
          notice: "已恢复上次编辑",
        });
        this.refreshStorage();
      }
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
      await projectRepository.replace(project);
      this.publish({
        project,
        issues: detectIssues(cues),
        phase: "ready",
        selectedId: cues[0].id,
        notice: `已解析 ${cues.length} 条字幕`,
      });
      this.refreshStorage();
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
    const changedCue = {
      ...this.state.project.cues.find((cue) => cue.id === id)!,
      ...patch,
    };
    const cues = this.state.project.cues.map((cue) =>
      cue.id === id ? changedCue : cue,
    );
    // 乐观更新：输入立即反映在界面上，不等待存储往返
    const optimistic = { ...this.state.project, cues };
    this.publish({ project: optimistic });
    await this.commitEdit(optimistic, changedCue);
  }
  /** 保存快照：当前编辑内容复制到独立快照存储，之后编辑不再重写它 */
  async saveVersion() {
    const project = this.state.project;
    if (!project) return;
    const savedAt = Date.now();
    this.versionSeq += 1;
    const version: VersionMeta = {
      id: `v-${savedAt}-${this.versionSeq}`,
      label: `快照 ${project.versions.length + 1}`,
      savedAt,
    };
    const versions = [...project.versions, version];
    const next: SubtitleProject = { ...project, versions };
    const ok = await this.persistOrWarn(next, () =>
      projectRepository.addVersion({
        ...version,
        cues: project.cues,
        versions,
        updatedAt: next.updatedAt,
      }),
    );
    if (!ok) return;
    this.publish({ project: next, notice: "已保存版本快照" });
    this.refreshStorage();
  }
  /** 回退：按需加载快照内容（打开项目时并未载入），再替换当前编辑内容 */
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    try {
      this.publish({ notice: `正在恢复${version.label}…` });
      const cues = await projectRepository.loadVersionCues(id);
      const next: SubtitleProject = { ...project, cues };
      const ok = await this.persistOrWarn(next, () =>
        projectRepository.replaceCues({
          cues,
          updatedAt: next.updatedAt,
        }),
      );
      if (!ok) return;
      this.publish({
        project: next,
        issues: detectIssues(cues),
        phase: "ready",
        selectedId: cues[0]?.id ?? null,
        notice: `已恢复${version.label}`,
      });
      this.refreshStorage();
    } catch {
      this.publish({
        phase: "error",
        notice: "快照读取失败，当前编辑内容未改动",
      });
    }
  }
  /** 删除单个快照，当前编辑内容不受影响 */
  async deleteVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    const versions = project.versions.filter((item) => item.id !== id);
    const next: SubtitleProject = { ...project, versions };
    const ok = await this.persistOrWarn(next, () =>
      projectRepository.deleteVersion(id, versions, next.updatedAt),
    );
    if (!ok) return;
    this.publish({ project: next, notice: `已删除${version.label}` });
    this.refreshStorage();
  }
  /** 清空全部快照，当前编辑内容不受影响 */
  async clearVersions() {
    const project = this.state.project;
    if (!project || project.versions.length === 0) return;
    const removed = project.versions.length;
    const next: SubtitleProject = { ...project, versions: [] };
    const ok = await this.persistOrWarn(next, () =>
      projectRepository.clearVersions(next.updatedAt),
    );
    if (!ok) return;
    this.publish({ project: next, notice: `已清理 ${removed} 个快照` });
    this.refreshStorage();
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
    if (project) {
      const next = { ...project, format };
      void this.commitMeta(next, { format });
    }
  }
  /** 仅项目级元数据变化（如导出格式），不写 cue、不碰快照 */
  private async commitMeta(
    project: SubtitleProject,
    patch: { format?: Format; name?: string },
  ) {
    const ok = await this.persistOrWarn(project, () =>
      projectRepository.saveMetaPatch({
        ...patch,
        updatedAt: project.updatedAt,
      }),
    );
    if (ok) this.publish({ project, notice: "" });
  }
  refreshStorageInfo(): Promise<StorageInfo | null> {
    return projectRepository.storageInfo().then((storage) => {
      this.publish({ storage });
      return storage;
    });
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
