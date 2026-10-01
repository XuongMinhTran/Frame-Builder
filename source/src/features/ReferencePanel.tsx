import React, { useEffect, useState } from "react";
import {
  Box,
  Circle,
  Cylinder,
  Ruler,
  Upload,
  Eye,
  EyeOff,
  Trash2,
  Copy,
} from "lucide-react";
import type { Project, Vec } from "../model";
import { bounds, round } from "../model";
import { referenceBounds } from "../references";
import type { ReferenceObject } from "../references";

function Field({
  label,
  value,
  min = -100000,
  max = 100000,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const apply = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
    else setText(String(round(value)));
  };
  return (
    <input
      type="number"
      aria-label={label}
      value={text}
      min={min}
      max={max}
      step="any"
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(String(round(value)));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function ReferencePanel({
  project,
  selected,
  select,
  add,
  update,
  remove,
  duplicate,
  importFile,
  units,
  setUnits,
  focus,
}: {
  project: Project;
  selected: string | null;
  select: (id: string | null) => void;
  add: (kind: ReferenceObject["kind"]) => void;
  update: (id: string, change: Partial<ReferenceObject>) => void;
  remove: () => void;
  duplicate: () => void;
  importFile: () => void;
  units: number;
  setUnits: (n: number) => void;
  focus: () => void;
}) {
  const refs = project.references ?? [],
    ref = refs.find((r) => r.id === selected);
  const box = ref && referenceBounds(ref);
  const overlaps =
    box && ref?.kind !== "ruler"
      ? project.parts.filter((p) => {
          if (p.kind !== "rail" || p.hidden) return false;
          const b = bounds([p]);
          return b.min.every(
            (v, i) =>
              v < box.max.getComponent(i) - 0.01 &&
              b.max[i] > box.min.getComponent(i) + 0.01,
          );
        })
      : [];
  return (
    <aside className="panel feature-panel">
      <div className="feature-heading">
        <span className="eyebrow">FIT CHECK</span>
        <h2>Make room for your idea</h2>
        <p>
          Place shapes and equipment inside your frame. All dimensions are in
          millimeters.
        </p>
      </div>
      <div className="shape-grid">
        {(
          [
            ["box", "Box", Box],
            ["cylinder", "Cylinder", Cylinder],
            ["sphere", "Sphere", Circle],
            ["ruler", "Ruler", Ruler],
          ] as const
        ).map(([kind, label, Icon]) => (
          <button key={kind} onClick={() => add(kind)}>
            <Icon size={21} strokeWidth={1.5} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="import-controls">
        <button className="feature-button" onClick={importFile}>
          <Upload size={15} /> Import STL / OBJ
        </button>
        <label>
          File units
          <select
            aria-label="Import model units"
            value={units}
            onChange={(e) => setUnits(Number(e.target.value))}
          >
            <option value={1}>Millimeters</option>
            <option value={10}>Centimeters</option>
            <option value={1000}>Meters</option>
            <option value={25.4}>Inches</option>
          </select>
        </label>
        <p>
          STL has no unit metadata. Choose the source units before importing. Up
          to 100,000 triangles total.
        </p>
      </div>
      <div className="feature-divider" />
      <h3>
        Objects <span className="muted">{refs.length}</span>
      </h3>
      <div
        className="reference-list"
        role="listbox"
        aria-label="Fit-check objects"
      >
        {refs.map((r) => (
          <div
            key={r.id}
            className={`reference-row ${selected === r.id ? "selected" : ""}`}
          >
            <button
              role="option"
              aria-selected={selected === r.id}
              onClick={() => select(r.id)}
            >
              <i style={{ background: r.color }} />
              <span>{r.name}</span>
            </button>
            <button
              aria-label={`${r.hidden ? "Show" : "Hide"} ${r.name}`}
              onClick={() => update(r.id, { hidden: !r.hidden })}
            >
              {r.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        ))}
        {!refs.length && (
          <p className="panel-note">
            Add a shape or import a model to compare its size with your frame.
          </p>
        )}
      </div>
      {ref && (
        <div className="reference-properties" key={ref.id}>
          <div className="feature-divider" />
          <div className="reference-actions">
            <h3>
              {ref.kind === "ruler" ? "Physical ruler" : "Object properties"}
            </h3>
            <button
              onClick={duplicate}
              aria-label="Duplicate object"
              title="Duplicate object"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={remove}
              aria-label="Delete object"
              title="Delete object"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <label className="feature-field">
            Name
            <input
              aria-label="Object name"
              value={ref.name}
              maxLength={80}
              onChange={(e) => update(ref.id, { name: e.target.value })}
            />
          </label>
          {ref.kind === "ruler" ? (
            <>
              <label className="feature-field">
                Length · mm
                <Field
                  label="Ruler length"
                  value={ref.size[0]}
                  min={10}
                  onChange={(n) => update(ref.id, { size: [n, 3, 24] })}
                />
              </label>
              <p className="panel-note">
                Drag the ruler to move it. Drag its round end handle to extend
                it. Colored arrows move along each axis.
              </p>
              <div className="seg">
                {(
                  [
                    ["X", [0, 0, 0]],
                    ["Y", [0, 0, 90]],
                    ["Z", [0, -90, 0]],
                  ] as [string, Vec][]
                ).map(([label, rotation]) => (
                  <button
                    key={label}
                    onClick={() => update(ref.id, { rotation })}
                  >
                    Along {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="field-caption">Dimensions · mm</p>
              <div className="vector-fields">
                {ref.size.map((n, i) => (
                  <label key={i}>
                    {"XYZ"[i]}
                    <Field
                      label={`Object size ${"XYZ"[i]}`}
                      value={n}
                      min={0.01}
                      onChange={(v) =>
                        update(ref.id, {
                          size: ref.size.map((n, j) =>
                            i === j ? v : n,
                          ) as Vec,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="feature-field">
                Scale uniformly
                <select
                  aria-label="Scale object uniformly"
                  value=""
                  onChange={(e) => {
                    const factor = Number(e.target.value);
                    const size = ref.size.map((n) => n * factor) as Vec;
                    if (size.every((n) => n >= 0.01 && n <= 100000))
                      update(ref.id, { size });
                  }}
                >
                  <option value="">Choose multiplier…</option>
                  {[0.1, 0.5, 2, 10, 25.4].map((n) => (
                    <option key={n} value={n}>
                      × {n}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <p className="field-caption">
            {ref.kind === "ruler" ? "Zero point" : "Center"} · mm
          </p>
          <div className="vector-fields">
            {ref.p.map((n, i) => (
              <label key={i}>
                {"XYZ"[i]}
                <Field
                  label={`Object position ${"XYZ"[i]}`}
                  value={n}
                  onChange={(v) =>
                    update(ref.id, {
                      p: ref.p.map((n, j) => (i === j ? v : n)) as Vec,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="field-caption">Rotation · degrees</p>
          <div className="vector-fields">
            {ref.rotation.map((n, i) => (
              <label key={i}>
                {"XYZ"[i]}
                <Field
                  label={`Object rotation ${"XYZ"[i]}`}
                  value={n}
                  min={-360}
                  max={360}
                  onChange={(v) =>
                    update(ref.id, {
                      rotation: ref.rotation.map((n, j) =>
                        i === j ? v : n,
                      ) as Vec,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="appearance-fields">
            <label>
              Color
              <input
                type="color"
                aria-label="Object color"
                value={ref.color}
                onChange={(e) => update(ref.id, { color: e.target.value })}
              />
            </label>
            {ref.kind !== "ruler" && (
              <label>
                Opacity
                <input
                  type="range"
                  aria-label="Object opacity"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={ref.opacity}
                  onChange={(e) =>
                    update(ref.id, { opacity: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </div>
          <div className="feature-buttons">
            <button className="feature-button" onClick={focus}>
              Focus object
            </button>
            <button
              className="feature-button"
              onClick={() =>
                update(ref.id, {
                  p: [ref.p[0], round(ref.p[1] - box!.min.y), ref.p[2]],
                })
              }
            >
              Set on ground
            </button>
          </div>
          {!!overlaps.length && (
            <p className="fit-notice">
              Bounding boxes overlap {overlaps.map((p) => p.label).join(", ")}.
              Orbit to inspect the fit; this is a rough check, not a precise
              collision test.
            </p>
          )}
          {ref.kind === "mesh" && (
            <p className="panel-note">
              {(ref.vertices!.length / 9).toLocaleString()} triangles · saved
              with this project
            </p>
          )}
        </div>
      )}
      <p className="panel-note">
        Fit-check objects and rulers are excluded from your hardware list and
        build sequence.
      </p>
    </aside>
  );
}
