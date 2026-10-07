import type { SubtitleCue, SubtitleIssue } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
export function InspectionModule({
  cues,
  issues,
  vm,
  selectedId,
}: {
  cues: SubtitleCue[];
  issues: SubtitleIssue[];
  vm: SubtitleMeterViewModel;
  selectedId: string | null;
}) {
  const selected = cues.find((cue) => cue.id === selectedId) ?? cues[0];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const cps = selected
    ? [...selected.text.replace(/\s/g, "")].length /
      Math.max(0.1, (selected.endMs - selected.startMs) / 1000)
    : 0;
  return (
    <section className="module inspection-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">03 / INSPECTION</span>
          <h2>
            问题检查 <span className="issue-count">{issues.length}</span>
          </h2>
        </div>
        <div className="issue-summary">
          <span className="error-color">{errors} 错误</span>
          <span className="warning-color">{warnings} 提醒</span>
        </div>
      </div>
      <div className="issue-list">
        {issues.length ? (
          issues.map((issue) => (
            <button
              key={issue.id}
              className={`issue-row ${issue.severity}`}
              onClick={() => vm.selectCue(issue.cueId)}
            >
              <span className="issue-bullet">
                {issue.severity === "error" ? "!" : "·"}
              </span>
              <span>{issue.message}</span>
              <span className="issue-cue">
                #{cues.find((cue) => cue.id === issue.cueId)?.index}
              </span>
            </button>
          ))
        ) : (
          <div className="clear-state">✓ 当前未发现明显问题</div>
        )}
      </div>
      {selected && (
        <div className="edit-card">
          <div className="edit-title">
            <span>当前条目 · #{selected.index}</span>
            <span className={cps > 18 ? "warning-color" : ""}>
              {cps.toFixed(1)} 字/秒
            </span>
          </div>
          <textarea
            aria-label="字幕文本"
            value={selected.text}
            onChange={(e) =>
              void vm.editCue(selected.id, { text: e.target.value })
            }
            rows={Math.min(4, Math.max(2, selected.text.split("\n").length))}
          />
          <div className="time-edit">
            <label>
              开始
              <input
                aria-label="开始时间毫秒"
                type="number"
                min="0"
                step="100"
                value={selected.startMs}
                onChange={(e) =>
                  void vm.editCue(selected.id, {
                    startMs: Number(e.target.value),
                  })
                }
              />
            </label>
            <span>→</span>
            <label>
              结束
              <input
                aria-label="结束时间毫秒"
                type="number"
                min="0"
                step="100"
                value={selected.endMs}
                onChange={(e) =>
                  void vm.editCue(selected.id, {
                    endMs: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
