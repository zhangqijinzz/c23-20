import { useState } from "react";
import type { Format, StorageInfo, SubtitleProject } from "../models";
import { SNAPSHOT_CLEANUP_THRESHOLD } from "../services/indexedDbService";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const StoragePanel = ({
  storage,
  count,
  onClear,
}: {
  storage: StorageInfo | null;
  count: number;
  onClear: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  const crowded = count >= SNAPSHOT_CLEANUP_THRESHOLD;
  return (
    <div className={`storage-panel ${crowded ? "crowded" : ""}`}>
      <div className="storage-head">
        <strong>本地存储占用</strong>
        {crowded && (
          <span className="storage-warn">
            快照已超过 {SNAPSHOT_CLEANUP_THRESHOLD} 个，建议清理
          </span>
        )}
      </div>
      <div className="storage-rows">
        <div>
          <span>当前编辑内容</span>
          <b>{formatBytes(storage?.currentBytes ?? 0)}</b>
        </div>
        <div>
          <span>快照（{count} 个）</span>
          <b>{formatBytes(storage?.snapshotBytes ?? 0)}</b>
        </div>
        <div className="storage-total">
          <span>合计</span>
          <b>{formatBytes(storage?.totalBytes ?? 0)}</b>
        </div>
      </div>
      {count > 0 &&
        (confirming ? (
          <div className="storage-confirm">
            <span>清空全部快照？当前编辑内容不会受影响。</span>
            <button
              className="danger-button"
              onClick={() => {
                setConfirming(false);
                onClear();
              }}
            >
              确认清空
            </button>
            <button
              className="secondary-button"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="secondary-button storage-clear"
            onClick={() => setConfirming(true)}
          >
            清理全部快照
          </button>
        ))}
    </div>
  );
};

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
            <div key={version.id} className="version-item">
              <button
                className="version-restore"
                onClick={() => void vm.restoreVersion(version.id)}
              >
                {version.label}
                <span>恢复 ↗</span>
              </button>
              <button
                className="version-delete"
                aria-label={`删除${version.label}`}
                title="删除此快照（不影响当前编辑）"
                onClick={() => void vm.deleteVersion(version.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <StoragePanel
        storage={storage}
        count={project.versions.length}
        onClear={() => void vm.clearVersions()}
      />
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
