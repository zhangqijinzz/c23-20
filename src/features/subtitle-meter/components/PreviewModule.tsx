import type { SubtitleCue } from "../models";
export function PreviewModule({ cue }: { cue?: SubtitleCue }) {
  const lines = cue?.text.split("\n") ?? [];
  return (
    <section className="module preview-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">SAFE AREA</span>
          <h2>画面预览</h2>
        </div>
        <span className="safe-label">标题安全区</span>
      </div>
      <div className="preview-screen">
        <div className="safe-frame">
          <span className="frame-label">90% SAFE</span>
          <div className={`preview-caption rows-${Math.min(lines.length, 3)}`}>
            {lines.length ? (
              lines.map((line, index) => (
                <span key={`${index}-${line}`}>{line || " "}</span>
              ))
            ) : (
              <span className="preview-placeholder">字幕将在此显示</span>
            )}
          </div>
        </div>
      </div>
      <div className="preview-meta">
        <span>{lines.length || 0} 行字幕</span>
        <span>{cue ? [...cue.text.replace(/\s/g, "")].length : 0} 字符</span>
        <span>底部居中</span>
      </div>
    </section>
  );
}
