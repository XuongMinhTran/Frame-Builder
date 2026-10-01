import React, { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Scan,
  Printer,
  Play,
  Pause,
  RotateCcw,
  Move3d,
} from "lucide-react";
import { describeRail } from "../assembly";
import type { BuildStep } from "../assembly";
import type { Project } from "../model";
import { issues } from "../model";
import "./build-guide.css";

export function BuildGuide({
  project,
  steps,
  index,
  setIndex,
  focus,
  overview,
  finish,
  print,
  playing,
  onPlayingChange,
  replay,
}: {
  project: Project;
  steps: BuildStep[];
  index: number;
  setIndex: (n: number) => void;
  focus: () => void;
  overview: () => void;
  finish: () => void;
  print: () => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  replay: () => void;
}) {
  const step = steps[index],
    checks = issues(project.parts);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [index]);
  if (!step)
    return (
      <aside className="panel feature-panel">
        <div className="feature-heading">
          <span className="eyebrow">BUILD GUIDE</span>
          <h2>Start with a frame</h2>
          <p>
            Add frames and connecting brackets, then come back for a suggested
            assembly sequence.
          </p>
          <button className="feature-button primary" onClick={finish}>
            Back to Frame
          </button>
        </div>
      </aside>
    );
  return (
    <aside
      className="panel feature-panel build-panel"
      aria-label="Assembly instructions"
    >
      <div ref={panel} className="build-guide-scroll">
        <div className="feature-heading">
          <span className="eyebrow">{step.level ?? "BUILD ON YOUR TABLE"}</span>
          <div className="guide-progress-label">
            <span>
              Step {index + 1} of {steps.length}
            </span>
            <span>{step.phase}</span>
          </div>
          <progress
            aria-label="Assembly progress"
            value={index + 1}
            max={steps.length}
          />
          <h2>{step.title}</h2>
          <p>{step.text}</p>
        </div>
        <section className="guide-bench-card" aria-label="Table setup">
          <div className="guide-bench-heading">
            <Move3d size={17} aria-hidden="true" />
            <div>
              <span>ON THE TABLE</span>
              <strong>{step.bench.label}</strong>
            </div>
          </div>
          <dl className="guide-support-list">
            <div>
              <dt>Rest</dt>
              <dd>{step.support.resting}</dd>
            </div>
            <div>
              <dt>Hold</dt>
              <dd>{step.support.hold}</dd>
            </div>
            <div>
              <dt>Secure</dt>
              <dd>{step.support.secure}</dd>
            </div>
          </dl>
          <p className="guide-support-note">
            Match pieces by length and position; no physical labels are needed.
          </p>
        </section>
        {step.hardware && (
          <div className="hardware-card">
            <span>HAVE READY</span>
            <strong>{step.hardware}</strong>
          </div>
        )}
        {!!step.mounts?.length && (
          <details
            key={`mounts-${step.id}`}
            className="mount-table guide-mount-details"
            open={step.phase === "Preload"}
          >
            <summary>
              Slot positions · {step.mounts.length} mounting points
            </summary>
            <p className="panel-note">
              Measure from the end shown as 0 mm on screen. Slot-face directions
              stay the same when the frame turns.
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Frame / for</th>
                  <th scope="col">Face</th>
                  <th scope="col">mm</th>
                  <th scope="col">Qty</th>
                </tr>
              </thead>
              <tbody>
                {step.mounts.map((m, i) => (
                  <tr key={i}>
                    <td>
                      {describeRail(project, m.railId)}
                      <small>{m.forLabel}</small>
                    </td>
                    <td>{m.face}</td>
                    <td>{m.offset}</td>
                    <td>{m.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {project.fastenersPerSide > 1 && (
              <p className="panel-note">
                Positions mark each bracket leg. Use your bracket's actual hole
                spacing for its additional fasteners.
              </p>
            )}
          </details>
        )}
        <div className="guide-check">
          <span>BEFORE MOVING ON</span>
          <p>{step.check}</p>
        </div>
        <div className="feature-buttons">
          <button className="feature-button" onClick={focus}>
            <Scan size={14} />
            Focus step
          </button>
          <button className="feature-button" onClick={overview}>
            Whole frame
          </button>
        </div>
        <div className="guide-scene-legend" aria-label="Model appearance">
          <span>
            <i className="guide-legend-solid" />
            Working parts stay solid
          </span>
          <span>
            <i className="guide-legend-transparent" />
            Other assembled parts are translucent
          </span>
          <p>Faint parts show the complete frame as a reference.</p>
        </div>
        <p className="panel-note guide-camera-note">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> to move in Drone view. Right-drag to look; use the cube
          to turn your view.
        </p>
        <label className="feature-field">
          Jump to step
          <select
            aria-label="Build guide step"
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {steps.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.title}
              </option>
            ))}
          </select>
        </label>
        {!!checks.length && (
          <details className="guide-issues" open={index === 0}>
            <summary>{checks.length} model issues to review</summary>
            {checks.map((c, i) => (
              <p key={i}>{c.text}</p>
            ))}
          </details>
        )}
        <button className="feature-button" onClick={print}>
          <Printer size={14} />
          Export printable guide
        </button>
      </div>
      <div className="build-guide-footer">
        <div
          className="guide-motion-controls"
          role="group"
          aria-label="Step animation"
        >
          <span className="guide-motion-label">
            {step.motion?.kind === "nuts" || step.motion?.kind === "screws"
              ? "Watch the insertion close-up"
              : step.motion?.kind === "turn"
                ? "Turn the assembly"
                : step.motion?.kind === "place"
                  ? "Place the next part"
                  : "Inspect this step"}
            {step.motion && " · loops"}
          </span>
          <div className="feature-buttons">
            <button
              className="feature-button"
              disabled={!step.motion}
              onClick={() => onPlayingChange(!playing)}
              aria-label={
                playing && step.motion
                  ? "Pause step animation"
                  : "Play step animation"
              }
            >
              {playing && step.motion ? (
                <Pause size={14} />
              ) : (
                <Play size={14} />
              )}
              {playing && step.motion ? "Pause" : "Play"}
            </button>
            <button
              className="feature-button"
              disabled={!step.motion}
              onClick={replay}
              aria-label="Replay step animation"
            >
              <RotateCcw size={14} />
              Replay
            </button>
          </div>
        </div>
        <nav className="guide-navigation" aria-label="Build guide navigation">
          <button
            className="feature-button"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <ArrowLeft size={15} />
            Back
          </button>
          <button
            className="feature-button primary"
            onClick={() =>
              index === steps.length - 1 ? finish() : setIndex(index + 1)
            }
          >
            {index === steps.length - 1 ? "Finish guide" : "Next step"}
            <ArrowRight size={15} />
          </button>
        </nav>
      </div>
    </aside>
  );
}
