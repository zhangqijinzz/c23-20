import type { PointerEvent } from "react";
import type { SubtitleCue, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
export function TimelineModule({
  project,
  vm,
  selectedId,
  zoom,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  selectedId: string | null;
  zoom: number;
}) {
  const maxTime = Math.max(1000, ...project.cues.map((cue) => cue.endMs));
  const trackPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    cue: SubtitleCue,
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const x0 = event.clientX,
      start = cue.startMs,
      end = cue.endMs,
      trackWidth =
        event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
    let shift = 0;
    const move = (moveEvent: globalThis.PointerEvent) => {
      shift = Math.round(((moveEvent.clientX - x0) / trackWidth) * maxTime);
    };
    const done = () => {
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointermove", move);
      if (shift)
        void vm.editCue(cue.id, {
          startMs: Math.max(0, start + shift),
          endMs: Math.max(1, end + shift),
        });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done, { once: true });
  };
  return (
    <section className="module timeline-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">02 / TIMELINE</span>
          <h2>时间轴分布</h2>
        </div>
        <label className="zoom-control">
          缩放{" "}
          <input
            aria-label="时间轴缩放"
            type="range"
            min="0.6"
            max="2"
            step="0.1"
            value={zoom}
            onChange={(e) => vm.setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="time-ruler">
        <span>00:00</span>
        <span>{(maxTime / 2000).toFixed(0)}s</span>
        <span>{(maxTime / 1000).toFixed(0)}s</span>
      </div>
      <div className="timeline-track" style={{ minWidth: `${zoom * 100}%` }}>
        {project.cues.map((cue) => (
          <button
            key={cue.id}
            title={`第 ${cue.index} 条 · ${(cue.startMs / 1000).toFixed(2)}s`}
            className={`timeline-cue ${selectedId === cue.id ? "selected" : ""}`}
            style={{
              left: `${(cue.startMs / maxTime) * 100}%`,
              width: `${Math.max(2.5, ((cue.endMs - cue.startMs) / maxTime) * 100)}%`,
            }}
            onClick={() => vm.selectCue(cue.id)}
            onPointerDown={(event) => trackPointerDown(event, cue)}
          >
            {cue.index}
          </button>
        ))}
      </div>
      <div className="timeline-hint">
        拖动时间块调整起止位置 · 点击条目进行编辑
      </div>
    </section>
  );
}
