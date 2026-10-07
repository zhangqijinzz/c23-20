import type { Format, StorageInfo, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";

const KEEP_LATEST = 5;
const MANY_SNAPSHOTS = 10;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function VersionExportModule({
  project,
  vm,
  phase,
  storage,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  phase: string;
  storage: StorageInfo | null;
}) {
  const storageText = storage
    ? `快照 ${storage.snapshotCount} 个 · 约 ${formatBytes(storage.snapshotBytes)}` +
      (storage.totalBytes !== null
        ? ` · 本地总占用约 ${formatBytes(storage.totalBytes)}`
        : "")
    : "正在统计存储占用…";

  const clearAll = () => {
    if (
      window.confirm(
        "确定清空全部快照？当前编辑内容不受影响，但已删除的快照无法恢复。",
      )
    )
      void vm.cleanupVersions(0);
  };
  const keepLatest = () => {
    if (
      window.confirm(
        `仅保留最近 ${KEEP_LATEST} 个快照，其余删除？当前编辑内容不受影响。`,
      )
    )
      void vm.cleanupVersions(KEEP_LATEST);
  };

  return (
    <section className="module version-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">04 / VERSIONS & EXPORT</span>
          <h2>版本与交付</h2>
        </div>
        <span className="saved-label">● 自动保存</span>
      </div>
      <div className="version-row">
        <div>
          <strong>本地快照</strong>
          <small>
            {project.versions.length
              ? `最近：${project.versions.at(-1)?.label}`
              : "保存当前版本以便回退"}
          </small>
        </div>
        <button
          className="secondary-button"
          onClick={() => void vm.saveVersion()}
        >
          ＋ 保存快照
        </button>
      </div>
      {project.versions.length > 0 && (
        <div className="version-list">
          {project.versions.map((version) => (
            <button
              key={version.id}
              onClick={() => void vm.restoreVersion(version.id)}
            >
              {version.label}
              <span>恢复 ↗</span>
            </button>
          ))}
        </div>
      )}
      <div className="version-row storage-row">
        <div>
          <strong>存储占用</strong>
          <small>{storageText}</small>
          {project.versions.length >= MANY_SNAPSHOTS && (
            <small className="cleanup-hint">
              快照较多，清理旧快照可释放空间
            </small>
          )}
        </div>
        {project.versions.length > 0 && (
          <div className="cleanup-actions">
            <button
              className="secondary-button"
              disabled={project.versions.length <= KEEP_LATEST}
              onClick={keepLatest}
            >
              仅留最近 {KEEP_LATEST} 个
            </button>
            <button className="secondary-button" onClick={clearAll}>
              清空快照
            </button>
          </div>
        )}
      </div>
      <div className="export-row">
        <label>
          格式
          <select
            aria-label="导出格式"
            value={project.format}
            onChange={(e) => vm.setFormat(e.target.value as Format)}
          >
            <option value="srt">SRT</option>
            <option value="vtt">WebVTT</option>
          </select>
        </label>
        <button
          className="export-button"
          disabled={phase === "exporting"}
          onClick={() => void vm.exportFile()}
        >
          导出字幕 <span>↓</span>
        </button>
      </div>
      <p className="privacy-note">字幕文件与项目版本仅保存在当前浏览器</p>
    </section>
  );
}
