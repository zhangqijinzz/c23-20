import type { ChangeEvent } from "react";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
export function ImportModule({
  vm,
  notice,
  phase,
  fileName,
}: {
  vm: SubtitleMeterViewModel;
  notice: string;
  phase: string;
  fileName?: string;
}) {
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void vm.importFile(file);
    event.target.value = "";
  };
  return (
    <section className="module import-module">
      <div className="module-head">
        <span className="module-kicker">01 / IMPORT</span>
        <span className="local-mark">● 本地处理</span>
      </div>
      <label className="dropzone">
        <input
          aria-label="导入 SRT 或 WebVTT 文件"
          type="file"
          accept=".srt,.vtt"
          onChange={onFile}
        />
        <span className="upload-icon">↑</span>
        <strong>{phase === "importing" ? "正在解析…" : "导入字幕文件"}</strong>
        <span>拖放或点击选择 · SRT / WebVTT</span>
      </label>
      <div className="file-status">
        <span className="status-dot" />
        {fileName ?? "等待文件导入"}
        <span className="file-size">{fileName ? "已保存到本机" : "UTF-8"}</span>
      </div>
      {notice && (
        <div
          className={`notice ${phase === "error" ? "error" : ""}`}
          role="status"
        >
          {notice}
        </div>
      )}
    </section>
  );
}
