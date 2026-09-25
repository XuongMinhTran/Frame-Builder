import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  FilePlus2,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  MousePointer2,
  Ruler,
  RotateCw,
  Copy,
  Trash2,
  Magnet,
  Link2,
  Camera,
  Printer,
  Scan,
  Lock,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { newClearanceError } from "./clearance";
import {
  ai,
  axes,
  bill,
  bounds,
  bracketFrame,
  bracketAt,
  bracketOk,
  joinTouching,
  ORIENTS,
  orientOf,
  bracketType,
  clone,
  connectedIds,
  csv,
  emptyProject,
  exampleProject,
  expandedSelection,
  issues,
  moveParts,
  nextLabel,
  parseProject,
  rail,
  removeParts,
  round,
  uid,
} from "./model";
import type { Axis, Bracket, Nut, Part, Project, Rail, Vec } from "./model";
import { Viewport } from "./viewport";
import type { Placement, ViewConfig } from "./viewport";
import "./style.css";

const RECOVERY = "glowframes.recovery.v1";
const filename = (name: string) =>
  name
    .trim()
    .replace(/[^a-z0-9 _-]/gi, "")
    .replace(/\s+/g, "-")
    .toLowerCase() || "frame";
function download(content: Blob | string, name: string) {
  const a = document.createElement("a");
  const url =
    typeof content === "string" ? content : URL.createObjectURL(content);
  a.href = url;
  a.download = name;
  a.click();
  if (typeof content !== "string")
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const escape = (s: unknown) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function constructionDocument(p: Project, image: string) {
  const b = bounds(p.parts),
    rows = bill(p),
    rails = p.parts.filter((x) => x.kind === "rail") as Rail[];
  const connections = p.parts.filter((x) => x.kind === "bracket") as Bracket[];
  const table = (headers: string[], rows: unknown[][]) =>
    `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(p.name)} · Construction sheet</title><style>body{font:12px Arial,sans-serif;max-width:1000px;margin:36px auto;color:#202830;padding:0 24px}h1{font-size:26px;margin-bottom:8px}h2{font-size:16px;margin-top:28px}p{line-height:1.6}header{border-bottom:2px solid #323c43;padding-bottom:18px}small{color:#56636c}img{width:100%;max-height:480px;object-fit:contain;background:#353b42}table{width:100%;border-collapse:collapse;font-size:11px}td,th{text-align:left;padding:8px;border:1px solid #cbd0d4}th{background:#eef0f1}tr{break-inside:avoid}button{padding:10px 18px;cursor:pointer;float:right}@media print{body{margin:0;padding:0}button{display:none}@page{margin:15mm}thead{display:table-header-group}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><header><small>gLOWframes / CONSTRUCTION SHEET</small><h1>${escape(p.name)}</h1><p>${new Date().toLocaleDateString()} · Units: mm · Frame profile: 20 × 20 mm<br>Overall dimensions: X ${b.size[0]} × Y ${b.size[1]} × Z ${b.size[2]}</p></header><h2>Assembly view</h2><img src="${image}" alt="Assembly view"><h2>Materials</h2>${table(
    ["Item", "Specification", "Quantity", "IDs"],
    rows.map((r) => [r.item, r.spec, r.qty, r.ids]),
  )}<h2>Frame locations</h2><p>Positions refer to frame centers. X and Z are horizontal; Y is vertical. Ends are center ± half the length along the listed axis.</p>${table(
    ["ID", "Length", "Axis", "Center X", "Center Y", "Center Z"],
    rails.map((r) => [r.label, r.length, r.axis.toUpperCase(), ...r.p]),
  )}<h2>Brackets</h2><p>Each bracket is screwed to one frame (“On”). Its inside corner sits the listed distance from that frame's negative-axis end, on the listed face; the flat leg runs toward + or − along the frame. “Joins” is the second frame held by the upright leg.</p>${table(
    ["ID", "On", "Face", "Corner from end", "Leg runs", "Joins", "Type"],
    connections.map((c) => {
      const a = rail(p.parts, c.a)!,
        f = bracketFrame(c, p.parts)!,
        ia = ai(a.axis);
      return [
        c.label,
        a.label,
        `${c.sign > 0 ? "+" : "−"}${c.face.toUpperCase()}`,
        round(f.origin[ia] - (a.p[ia] - a.length / 2)),
        `${c.sa > 0 ? "+" : "−"}${a.axis.toUpperCase()}`,
        c.b ? rail(p.parts, c.b)?.label : "—",
        bracketType(c, p.parts) === "stacked" ? "Holes near corner" : "Standard",
      ];
    }),
  )}<h2>Independent mounting points</h2>${table(
    ["ID", "Frame", "Slot face", "Offset from negative end"],
    p.parts
      .filter((x) => x.kind === "nut")
      .map((x) => {
        const n = x as Nut,
          r = rail(p.parts, n.rail)!;
        return [
          n.label,
          r.label,
          `${n.sign > 0 ? "+" : "−"}${n.face.toUpperCase()}`,
          round(n.offset + r.length / 2),
        ];
      }),
  )}<h2>Assembly checks</h2><p>${
    issues(p.parts).length
      ? issues(p.parts)
          .map((i) => escape(i.text))
          .join("<br>")
      : "No frame overlaps or frames without bracket connections detected."
  }</p><p><small>Fastener assumption: ${p.fastenersPerSide} screw and ${p.fastenersPerSide} T-nut per bracket side. Independently placed T-nuts do not imply external mounting screws. Verify hardware compatibility, clearances, bracket leg dimensions, and load capacity before construction. This sheet describes geometry and quantities, not structural certification.</small></p></body></html>`;
}
function NumberField({
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const apply = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n) && n >= min && n <= max) {
      if (n !== value) onChange(n);
      setText(String(round(value)));
    } else setText(String(round(value)));
  };
  return (
    <input
      aria-label={label}
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}
const STEPS = [1, 5, 10, 20, 50, 100];
const cm = (mm: number) => `${round(mm / 10)} cm`;

/* ---------- small building blocks ---------- */

type MenuItem =
  | {
      label: string;
      action?: () => void;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      sub?: MenuItem[];
    }
  | "-";

function MenuList({
  items,
  onDone,
  style,
  nested = false,
}: {
  items: MenuItem[];
  onDone: () => void;
  style?: React.CSSProperties;
  nested?: boolean;
}) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div
      className={`menu-popup ${nested ? "nested" : ""}`}
      style={style}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "-" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            role="menuitem"
            aria-disabled={item.disabled}
            className={`menu-item ${item.disabled ? "disabled" : ""} ${sub === i ? "hot" : ""}`}
            onMouseEnter={() => setSub(item.sub ? i : null)}
            onClick={(e) => {
              e.stopPropagation();
              if (item.disabled || item.sub || !item.action) return;
              onDone();
              item.action();
            }}
          >
            <span className="menu-check">{item.checked ? "✓" : ""}</span>
            <span className="menu-label">{item.label}</span>
            <span className="menu-shortcut">
              {item.sub ? "▸" : item.shortcut}
            </span>
            {item.sub && sub === i && !item.disabled && (
              <MenuList items={item.sub} onDone={onDone} nested />
            )}
          </div>
        ),
      )}
    </div>
  );
}

function MenuBar({
  menus,
  children,
}: {
  menus: { label: string; items: MenuItem[] }[];
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <nav className="menubar" ref={ref}>
      {menus.map((m, i) => (
        <div className="menu-root" key={m.label}>
          <button
            className={open === i ? "open" : ""}
            onMouseDown={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
          {open === i && (
            <MenuList items={m.items} onDone={() => setOpen(null)} />
          )}
        </div>
      ))}
      {children}
    </nav>
  );
}

function Btn({
  icon: Icon,
  label,
  text,
  onClick,
  active,
  disabled,
  shortcut,
}: {
  icon?: LucideIcon;
  label: string;
  text?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      className={`btn ${active ? "on" : ""} ${text ? "has-text" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={`${label}${shortcut ? `  (${shortcut})` : ""}`}
      aria-label={label}
      aria-pressed={active}
    >
      {Icon && <Icon size={15} strokeWidth={1.75} />}
      {text && <span>{text}</span>}
    </button>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  title,
  disabled,
}: {
  value: T | null;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <div className="seg" title={title}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "on" : ""}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const AxisLetter = ({ a }: { a: Axis }) => (
  <b className={`axis-${a}`}>{a.toUpperCase()}</b>
);

function Section({
  title,
  open,
  onToggle,
  extra,
  grow,
  children,
}: {
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`section ${grow && open ? "grow" : ""}`}>
      <header className="section-head" onClick={onToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
        <span className="flex" />
        <span onClick={(e) => e.stopPropagation()}>{extra}</span>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="window" role="dialog" aria-modal="true">
        <header className="window-title">
          <span>{title}</span>
          <button onClick={onClose} aria-label="Close">
            <X size={13} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function RailGlyph({ length, max }: { length: number; max: number }) {
  const w = 22 + (66 * length) / max,
    x = 6,
    y = 16,
    h = 12,
    d = 6;
  return (
    <svg viewBox="0 0 100 40" className="glyph" aria-hidden="true">
      <defs>
        <linearGradient id="rgf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dfe4e8" />
          <stop offset="1" stopColor="#7e878d" />
        </linearGradient>
      </defs>
      <path d={`M${x} ${y} l${d} -${d} h${w} l-${d} ${d} z`} fill="#eef1f3" />
      <line x1={x + d / 2 + 2} y1={y - d / 2} x2={x + w + d / 2 - 2} y2={y - d / 2} stroke="#8d969c" strokeWidth="1.4" />
      <rect x={x} y={y} width={w} height={h} fill="url(#rgf)" />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#566067" strokeWidth="1.6" />
      <path d={`M${x + w} ${y} l${d} -${d} v${h} l-${d} ${d} z`} fill="#7a838a" />
    </svg>
  );
}
function BracketGlyph() {
  return (
    <svg viewBox="0 0 100 40" className="glyph" aria-hidden="true">
      <path d="M36 4 h8 v24 h24 v8 h-32 z" fill="#b9c1c7" stroke="#59636a" />
      <path d="M44 28 V14 L58 28 Z" fill="#848e95" />
      <circle cx="40" cy="14" r="2.2" fill="#3b4348" />
      <circle cx="56" cy="32" r="2.2" fill="#3b4348" />
    </svg>
  );
}
function NutGlyph() {
  return (
    <svg viewBox="0 0 100 40" className="glyph" aria-hidden="true">
      <rect x="32" y="12" width="36" height="16" rx="4" fill="#cfb883" stroke="#7a6640" />
      <circle cx="50" cy="20" r="4.5" fill="#3a3530" />
      <circle cx="50" cy="20" r="2" fill="#6b604d" />
    </svg>
  );
}
const kindIcon = (k: Part["kind"]) => (
  <span className={`kind-icon ${k}`} aria-hidden="true" />
);

/* ---------- application ---------- */

type Modal = "part" | "step" | "help" | null;

function App() {
  const [project, setProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem(RECOVERY);
      if (saved) return parseProject(saved);
    } catch {}
    return exampleProject();
  });
  const recoveredAtStart = useRef(
    (() => {
      try {
        return !!localStorage.getItem(RECOVERY);
      } catch {
        return false;
      }
    })(),
  );
  const [selection, setSelection] = useState<string[]>([]),
    [placement, setPlacement] = useState<Placement>(null),
    [tool, setTool] = useState<ViewConfig["tool"]>("select"),
    [moveAxis, setMoveAxis] = useState<Axis | "plane">("plane");
  const [step, setStep] = useState(10),
    [snapEnabled, setSnapEnabled] = useState(true),
    [attach, setAttach] = useState(true),
    [grid, setGrid] = useState(true),
    [labels, setLabels] = useState(false),
    [dimensions, setDimensions] = useState(false),
    [repeat, setRepeat] = useState(false),
    [axis, setAxis] = useState<Axis>("x");
  const [message, setMessage] = useState(
      recoveredAtStart.current ? "Recovered your last session" : "",
    ),
    [measure, setMeasure] = useState<number | null>(null),
    [dirty, setDirty] = useState(false),
    [modal, setModal] = useState<Modal>(null),
    [revision, setRevision] = useState(0),
    [currentView, setCurrentView] = useState<
      "perspective" | "top" | "front" | "right"
    >("perspective"),
    [webglError, setWebglError] = useState(""),
    [open, setOpen] = useState({
      outliner: true,
      properties: true,
      bom: true,
      rail: true,
      bracket: false,
      nut: true,
    }),
    [context, setContext] = useState<{
      x: number;
      y: number;
      items: MenuItem[];
    } | null>(null);
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    viewport = useRef<Viewport | null>(null),
    host = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    latest = useRef({ project, repeat }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = { project, repeat };
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const notify = useCallback((s: string) => {
    setMessage(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 5000);
  }, []);
  useEffect(() => {
    if (message) notify(message);
  }, []);
  const commit = useCallback((p: Project) => {
    if (JSON.stringify(p) === JSON.stringify(latest.current.project)) return;
    history.current.push(clone(latest.current.project));
    if (history.current.length > 100) history.current.shift();
    future.current = [];
    latest.current.project = p;
    setProject(p);
    setDirty(true);
    setRevision((n) => n + 1);
  }, []);
  const cfg: ViewConfig = {
    project,
    selection,
    placement,
    step,
    snapEnabled,
    attach,
    labels,
    dimensions,
    grid,
    tool,
    moveAxis,
  };
  useEffect(() => {
    if (!host.current) return;
    try {
      viewport.current = new Viewport(host.current, cfg, {
        select: setSelection,
        commit,
        message: notify,
        placed: () => {
          if (!latest.current.repeat) setPlacement(null);
        },
        measure: setMeasure,
        navigating: () => setCurrentView("perspective"),
      });
      viewport.current.fit();
    } catch (e) {
      setWebglError(
        "The 3D view could not start. Turn on hardware acceleration or try another browser.",
      );
      console.error(e);
    }
    return () => viewport.current?.dispose();
  }, []);
  useEffect(() => {
    viewport.current?.update(cfg);
  }, [
    project,
    selection,
    placement,
    step,
    snapEnabled,
    attach,
    labels,
    dimensions,
    grid,
    tool,
    moveAxis,
  ]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(RECOVERY, JSON.stringify(project));
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [project]);
  useEffect(() => {
    document.title = `${project.name}${dirty ? " *" : ""} — gLOWframes`;
  }, [project.name, dirty]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    document
      .querySelector(".tree-row.sel")
      ?.scrollIntoView({ block: "nearest" });
  }, [selection.join(",")]);

  /* ----- commands ----- */
  const restore = (p: Project | undefined, into: Project[], label: string) => {
    if (!p) return;
    into.push(clone(latest.current.project));
    latest.current.project = p;
    setProject(p);
    setSelection((s) => s.filter((id) => p.parts.some((x) => x.id === id)));
    setDirty(true);
    setRevision((n) => n + 1);
    notify(label);
  };
  const undo = () => restore(history.current.pop(), future.current, "Undo");
  const redo = () => restore(future.current.pop(), history.current, "Redo");
  const save = () => {
    download(
      new Blob([JSON.stringify(latest.current.project, null, 2)], {
        type: "application/json",
      }),
      filename(latest.current.project.name) + ".glowframe",
    );
    setDirty(false);
    notify("Saved to your downloads");
  };
  const load = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > 5_000_000) throw new Error("File is larger than 5 MB.");
      const p = parseProject(await f.text());
      commit(p);
      setSelection([]);
      setPlacement(null);
      setDirty(false);
      notify(`Opened ${f.name}`);
      requestAnimationFrame(() => viewport.current?.fit());
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not read that file");
    }
  };
  const selected = project.parts.filter((p) => selection.includes(p.id)),
    single = selected.length === 1 ? selected[0] : null,
    rails = project.parts.filter((p) => p.kind === "rail") as Rail[],
    selRails = selected.filter((p) => p.kind === "rail") as Rail[],
    bb = useMemo(() => bounds(project.parts), [project]),
    rows = useMemo(() => bill(project), [project]),
    checks = useMemo(() => issues(project.parts), [project]),
    totalLength = round(rails.reduce((s, r) => s + r.length, 0) / 1000);
  const cancel = () => {
    setPlacement(null);
    viewport.current?.cancelOperation();
    setMeasure(null);
    setContext(null);
  };
  const remove = (ids = selection) => {
    ids = ids.filter((id) => !project.parts.find((p) => p.id === id)?.locked);
    if (!ids.length) return;
    const blocked = project.parts.find(
      (p) =>
        p.locked &&
        ((p.kind === "nut" && ids.includes(p.rail)) ||
          (p.kind === "bracket" && (ids.includes(p.a) || ids.includes(p.b)))),
    );
    if (blocked) {
      notify(`${blocked.label} is locked — unlock it first`);
      return;
    }
    commit(removeParts(project, ids));
    setSelection([]);
    notify(`Deleted ${ids.length} part${ids.length > 1 ? "s" : ""}`);
  };
  const duplicate = () => {
    const p = clone(project),
      idMap = new Map<string, string>(),
      newIds: string[] = [];
    for (const part of selected) idMap.set(part.id, uid());
    for (const part of selected) {
      const n = clone(part);
      n.id = idMap.get(part.id)!;
      n.label = nextLabel(p.parts, n.kind);
      n.locked = false;
      delete n.group;
      if (n.kind === "rail") n.p = [n.p[0] + 40, n.p[1], n.p[2] + 40];
      if (n.kind === "nut") {
        n.rail = idMap.get(n.rail) || n.rail;
        if (!idMap.has(part.kind === "nut" ? part.rail : "")) {
          const r = rail(p.parts, n.rail)!;
          n.offset = Math.min(r.length / 2 - 5, n.offset + 20);
        }
      }
      if (n.kind === "bracket") {
        const f = bracketFrame(n, project.parts),
          host = rail(project.parts, n.a);
        if (!f || !host) continue;
        const corner = round(f.origin[ai(host.axis)] - host.p[ai(host.axis)]);
        if (idMap.has(n.a)) {
          n.a = idMap.get(n.a)!;
          n.b = idMap.get(n.b) || "";
          n.offset = corner;
        } else {
          // Copy it further along the same frame.
          const point = [...f.origin] as Vec;
          point[ai(host.axis)] += (n.across ? 1 : n.sa) * 40 + (n.across ? 0 : n.sa * 15);
          const res = bracketAt(p.parts, host, n.face, n.sign, point, { orient: orientOf(n), join: attach });
          if (!res.bracket) continue;
          Object.assign(n, { ...res.bracket, id: n.id, label: n.label });
        }
      }
      p.parts.push(n);
      newIds.push(n.id);
    }
    if (newIds.length) {
      commit(p);
      setSelection(newIds);
      notify("Duplicated — drag the copy into place");
    } else notify("No room to copy that here");
  };
  const alter = (fn: (p: Part) => void, ids = selection) => {
    const p = clone(project);
    p.parts.filter((x) => ids.includes(x.id)).forEach(fn);
    commit(p);
  };
  const showAll = () => alter((x) => (x.hidden = false), project.parts.map((x) => x.id));
  const validateCommit = (p: Project) => {
    const clearance = newClearanceError(project.parts, p.parts);
    if (clearance) {
      notify(clearance);
      return false;
    }
    for (const b of p.parts)
      if (b.kind === "bracket") {
        if (!bracketOk(b, p.parts)) {
          notify(`${b.label} is in the way — detach it first`);
          return false;
        }
      }
    joinTouching(p.parts);
    commit(p);
    return true;
  };
  const updatePart = (id: string, changes: Partial<Part>) => {
    const p = clone(project),
      part = p.parts.find((x) => x.id === id);
    if (!part || part.locked) return;
    Object.assign(part, changes);
    if (part.kind === "rail")
      for (const n of p.parts)
        if (n.kind === "nut" && n.rail === id) {
          if (n.face === part.axis) {
            notify("Remove its T-nuts before turning this frame");
            return;
          }
          if (Math.abs(n.offset) > part.length / 2 - 5) {
            notify("A T-nut would fall off the shorter frame");
            return;
          }
        }
    validateCommit(p);
  };
  const rotate = () => {
    if (placement?.kind === "rail") {
      const a = axes[(ai(placement.axis) + 1) % 3];
      setAxis(a);
      setPlacement({ ...placement, axis: a });
      return;
    }
    if (placement?.kind === "bracket") {
      const now = viewport.current?.candidateOrient() ?? placement.orient ?? 0;
      setPlacement({ kind: "bracket", orient: (now + 1) % ORIENTS.length });
      return;
    }
    if (single?.kind === "rail")
      updatePart(single.id, { axis: axes[(ai(single.axis) + 1) % 3] });
    else if (single?.kind === "bracket") rotateBracket(single);
    else notify("Select one frame or bracket to rotate");
  };
  const setMode = (mode: ViewConfig["tool"]) => {
    setPlacement(null);
    setTool(mode);
    setMeasure(null);
    viewport.current?.cancelOperation();
  };
  const put = (kind: Part["kind"], length = 200) => {
    setPlacement(kind === "rail" ? { kind, length, axis } : { kind });
    setTool("select");
  };
  /** Press on a shelf tile: drag it into the view to drop it there, or just
   * click it and then click in the view. Keys (R, Alt) work while dragging. */
  const shelfDrag = (e: React.PointerEvent, kind: Part["kind"], length = 200) => {
    if (e.button !== 0) return;
    e.preventDefault();
    put(kind, length);
    const from = [e.clientX, e.clientY];
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", up, true);
      if (Math.hypot(ev.clientX - from[0], ev.clientY - from[1]) < 6) return;
      if (host.current?.contains(ev.target as Node)) viewport.current?.dropAt(ev);
      else if (!latest.current.repeat) setPlacement(null);
    };
    window.addEventListener("pointerup", up, true);
  };
  const projectNew = (example: boolean) => {
    commit(example ? exampleProject() : emptyProject());
    setSelection([]);
    setPlacement(null);
    requestAnimationFrame(() => viewport.current?.fit());
    notify(example ? "Example opened — Undo brings back your frame" : "New frame — Undo brings back your old one");
  };
  const exportFile = (type: "image" | "csv" | "sheet") => {
    const name = filename(project.name);
    const view = viewport.current;
    if (type === "csv")
      download(
        new Blob([csv(project)], { type: "text/csv;charset=utf-8" }),
        name + "-parts.csv",
      );
    else if (view && type === "image") {
      view.update({ ...cfg, selection: [], placement: null });
      const data = view.image();
      view.update(cfg);
      download(data, name + ".png");
    } else if (view) {
      view.update({
        ...cfg,
        selection: [],
        labels: true,
        dimensions: true,
        placement: null,
      });
      const image = view.image();
      view.update(cfg);
      download(
        new Blob([constructionDocument(project, image)], {
          type: "text/html;charset=utf-8",
        }),
        name + "-construction.html",
      );
    }
    notify(
      type === "sheet"
        ? "Build sheet downloaded — open it to print or save as PDF"
        : type === "image"
          ? "Image downloaded"
          : "Parts list downloaded",
    );
  };
  const spatial = (mode: "align" | "distribute", a: Axis) => {
    if (selRails.some((p) => p.locked)) {
      notify("Unlock the selected frames first");
      return;
    }
    if (selRails.length < (mode === "align" ? 2 : 3)) return;
    const next = clone(project),
      i = ai(a),
      sorted = [...selRails].sort((a, b) => a.p[i] - b.p[i]);
    const lo = sorted[0].p[i],
      hi = sorted[sorted.length - 1].p[i];
    sorted.forEach((r, j) => {
      rail(next.parts, r.id)!.p[i] =
        mode === "align"
          ? selRails[0].p[i]
          : round(lo + ((hi - lo) * j) / (sorted.length - 1));
    });
    if (validateCommit(next))
      notify(mode === "align" ? `Aligned on ${a.toUpperCase()}` : `Spaced evenly on ${a.toUpperCase()}`);
  };
  const replaceBracket = (b: Bracket, next: Bracket) => {
    const p = clone(project);
    const i = p.parts.findIndex((x) => x.id === b.id);
    p.parts[i] = { ...next, id: b.id, label: b.label, ...(b.group ? { group: b.group } : {}), ...(b.hidden ? { hidden: true } : {}) };
    return validateCommit(p);
  };
  /** Stop holding the second frame; the bracket stays on its own frame. */
  const release = (b: Bracket) => {
    const f = bracketFrame(b, project.parts),
      host = rail(project.parts, b.a);
    if (!f || !host || !b.b) return;
    if (b.locked) return notify(`${b.label} is locked`);
    const was = rail(project.parts, b.b)?.label;
    if (replaceBracket(b, { ...b, b: "", offset: round(f.origin[ai(host.axis)] - host.p[ai(host.axis)]) }))
      notify(`${b.label} no longer holds ${was} — that frame can move freely`);
  };
  /** Middle of a bracket's footprint along its frame, as a cursor point. */
  const bracketPoint = (b: Bracket, host: Rail) => {
    const f = bracketFrame(b, project.parts)!,
      ia = ai(host.axis),
      point = [...f.origin] as Vec;
    if (!b.across) point[ia] += b.sa * 15;
    return point;
  };
  /** Turn a bracket 90° on its face, keeping it where it is. */
  const rotateBracket = (b: Bracket) => {
    if (b.locked) return notify(`${b.label} is locked`);
    const host = rail(project.parts, b.a);
    if (!host || !bracketFrame(b, project.parts)) return;
    const others = project.parts.filter((x) => x.id !== b.id),
      point = bracketPoint(b, host);
    // Try the next quarter turn; if that doesn't fit here, keep turning.
    for (let k = 1; k < ORIENTS.length; k++) {
      const orient = (orientOf(b) + k) % ORIENTS.length;
      const res = bracketAt(others, host, b.face, b.sign, point, { orient, join: attach, id: b.id, label: b.label });
      if (res.bracket) {
        if (replaceBracket(b, res.bracket))
          notify(`${b.label} turned${k > 1 ? ` (${k * 90}° — no room at ${90}°)` : " 90°"}`);
        return;
      }
    }
    notify(`No room to turn ${b.label} here`);
  };
  /** Move a bracket to another face of its frame. */
  const setBracketFace = (b: Bracket, face: Axis, sign: number) => {
    const host = rail(project.parts, b.a),
      f = bracketFrame(b, project.parts);
    if (!host || !f) return;
    const others = project.parts.filter((x) => x.id !== b.id);
    const point = [...host.p] as Vec;
    point[ai(host.axis)] = bracketPoint(b, host)[ai(host.axis)];
    const res = bracketAt(others, host, face, sign, point, { orient: orientOf(b), join: attach, id: b.id, label: b.label });
    if (!res.bracket) return notify(res.error);
    replaceBracket(b, res.bracket);
  };
  const detach = (r: Rail) => {
    const toRemove = project.parts.filter(
      (p) => p.kind === "bracket" && (p.a === r.id || p.b === r.id),
    );
    if (!toRemove.length) return notify(`${r.label} has no brackets`);
    if (r.locked || toRemove.some((p) => p.locked))
      return notify("Unlock the frame and its brackets first");
    commit(removeParts(project, toRemove.map((p) => p.id)));
    notify(`${r.label} detached — ${toRemove.length} bracket${toRemove.length > 1 ? "s" : ""} removed`);
  };
  const view = (v: typeof currentView) => {
    viewport.current?.view(v);
    setCurrentView(v);
  };
  const nudge = (k: string) => {
    const delta: Vec = [0, 0, 0];
    const i =
      moveAxis !== "plane"
        ? ai(moveAxis)
        : k === "arrowleft" || k === "arrowright"
          ? 0
          : 2;
    delta[i] = (["arrowleft", "arrowdown"].includes(k) ? -1 : 1) * step;
    const r = moveParts(project, selection, delta);
    if (r.error) notify(r.error);
    else commit(r.project);
  };
  const cycleStep = (dir: number) => {
    const index = STEPS.findIndex((s) => s >= step);
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, (index < 0 ? STEPS.length - 1 : index) + dir))];
    setStep(next);
    notify(`Step ${next} mm`);
  };
  const canRotate =
    placement?.kind === "rail" ||
    placement?.kind === "bracket" ||
    single?.kind === "rail" ||
    single?.kind === "bracket";
  const allLocked = selected.length > 0 && selected.every((p) => p.locked);
  const allHidden = selected.length > 0 && selected.every((p) => p.hidden);

  /* ----- keyboard ----- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (modal) {
        if (e.key === "Escape") setModal(null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey,
        k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        save();
      } else if (mod && k === "o") {
        e.preventDefault();
        file.current?.click();
      } else if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod && k === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod && k === "a") {
        e.preventDefault();
        setSelection(project.parts.filter((p) => !p.hidden).map((p) => p.id));
      } else if (mod) return;
      else if (k === "escape") {
        cancel();
        setSelection([]);
      } else if (k === "delete" || k === "backspace") {
        e.preventDefault();
        remove();
      } else if (k === "r") {
        if (!viewport.current?.rotateDraggedBracket()) rotate();
      }
      else if (k === "v") setMode("select");
      else if (k === "m") setMode("measure");
      else if (k === "f") viewport.current?.fit(!!selection.length);
      else if (k === "home") {
        e.preventDefault();
        viewport.current?.fit();
      } else if (k === "h") {
        if (e.shiftKey) showAll();
        else alter((p) => (p.hidden = true));
      } else if (k === "1") view("front");
      else if (k === "3") view("right");
      else if (k === "7") view("top");
      else if (k === "0" || k === "5") view("perspective");
      else if (axes.includes(k as Axis)) {
        const next = moveAxis === k ? "plane" : (k as Axis);
        setMoveAxis(next);
        notify(next === "plane" ? "Free movement" : `Moving along ${next.toUpperCase()} only`);
      } else if (k === "[" || k === "]") cycleStep(k === "[" ? -1 : 1);
      else if (
        ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) &&
        selection.length
      ) {
        e.preventDefault();
        nudge(k);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [project, selection, placement, step, moveAxis, modal, revision]);

  /* ----- menus ----- */
  const partMenu = (ids: string[]): MenuItem[] => {
    const parts = project.parts.filter((p) => ids.includes(p.id));
    const one = parts.length === 1 ? parts[0] : null;
    return [
      { label: "Select connected", action: () => setSelection(connectedIds(project.parts, ids)) },
      { label: "Zoom to", shortcut: "F", action: () => requestAnimationFrame(() => viewport.current?.fit(true)) },
      "-",
      { label: "Duplicate", shortcut: "Ctrl+D", action: duplicate },
      { label: "Delete", shortcut: "Del", action: () => remove(ids) },
      "-",
      {
        label: parts.every((p) => p.hidden) ? "Show" : "Hide",
        shortcut: "H",
        action: () => alter((p) => (p.hidden = !parts.every((x) => x.hidden)), ids),
      },
      {
        label: parts.every((p) => p.locked) ? "Unlock" : "Lock",
        action: () => alter((p) => (p.locked = !parts.every((x) => x.locked)), ids),
      },
      ...(one?.kind === "rail"
        ? (["-", { label: "Detach from brackets", action: () => detach(one) }] as MenuItem[])
        : one?.kind === "bracket"
          ? ([
              "-",
              { label: "Rotate 90°", shortcut: "R", action: () => rotateBracket(one) },
              ...(one.b ? [{ label: `Let go of ${rail(project.parts, one.b)?.label}`, action: () => release(one) }] : []),
            ] as MenuItem[])
          : []),
    ];
  };
  const axisSub = (fn: (a: Axis) => void, disabled: boolean): MenuItem[] =>
    axes.map((a) => ({ label: `Along ${a.toUpperCase()}`, action: () => fn(a), disabled }));
  const menus: { label: string; items: MenuItem[] }[] = [
    {
      label: "File",
      items: [
        { label: "New", action: () => projectNew(false) },
        { label: "Open example frame", action: () => projectNew(true) },
        { label: "Open…", shortcut: "Ctrl+O", action: () => file.current?.click() },
        "-",
        { label: "Save", shortcut: "Ctrl+S", action: save },
        "-",
        { label: "Export image (PNG)", action: () => exportFile("image") },
        { label: "Export parts list (CSV)", action: () => exportFile("csv") },
        { label: "Export build sheet (printable)", action: () => exportFile("sheet") },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", action: undo, disabled: !history.current.length },
        { label: "Redo", shortcut: "Ctrl+Y", action: redo, disabled: !future.current.length },
        "-",
        { label: "Duplicate", shortcut: "Ctrl+D", action: duplicate, disabled: !selection.length },
        { label: "Delete", shortcut: "Del", action: () => remove(), disabled: !selection.length },
        { label: "Rotate", shortcut: "R", action: rotate, disabled: !canRotate },
        "-",
        { label: "Select all", shortcut: "Ctrl+A", action: () => setSelection(project.parts.filter((p) => !p.hidden).map((p) => p.id)) },
        { label: "Select connected", action: () => setSelection(connectedIds(project.parts, selection)), disabled: !selection.length },
        { label: "Select none", shortcut: "Esc", action: () => setSelection([]), disabled: !selection.length },
        "-",
        { label: "Align centers", sub: axisSub((a) => spatial("align", a), selRails.length < 2), disabled: selRails.length < 2 },
        { label: "Space evenly", sub: axisSub((a) => spatial("distribute", a), selRails.length < 3), disabled: selRails.length < 3 },
        {
          label: "Group",
          action: () => {
            const id = uid();
            alter((p) => (p.group = id));
            notify("Grouped — these parts now select together");
          },
          disabled: selection.length < 2,
        },
        { label: "Ungroup", action: () => alter((p) => delete p.group), disabled: !selected.some((p) => p.group) },
        "-",
        { label: allHidden ? "Show" : "Hide", shortcut: "H", action: () => alter((p) => (p.hidden = !allHidden)), disabled: !selection.length },
        { label: "Show all", shortcut: "Shift+H", action: showAll, disabled: !project.parts.some((p) => p.hidden) },
        { label: allLocked ? "Unlock" : "Lock", action: () => alter((p) => (p.locked = !allLocked)), disabled: !selection.length },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Perspective", shortcut: "0", checked: currentView === "perspective", action: () => view("perspective") },
        { label: "Top", shortcut: "7", checked: currentView === "top", action: () => view("top") },
        { label: "Front", shortcut: "1", checked: currentView === "front", action: () => view("front") },
        { label: "Right", shortcut: "3", checked: currentView === "right", action: () => view("right") },
        "-",
        { label: "Zoom to selection", shortcut: "F", action: () => viewport.current?.fit(true), disabled: !selection.length },
        { label: "Zoom to everything", shortcut: "Home", action: () => viewport.current?.fit() },
        "-",
        { label: "Grid", checked: grid, action: () => setGrid(!grid) },
        { label: "Frame names", checked: labels, action: () => setLabels(!labels) },
        { label: "Overall dimensions", checked: dimensions, action: () => setDimensions(!dimensions) },
      ],
    },
    {
      label: "Help",
      items: [{ label: "Controls…", shortcut: "", action: () => setModal("help") }],
    },
  ];

  /* ----- derived UI text ----- */
  const hint = placement
    ? placement.kind === "rail"
      ? `Placing ${cm(placement.length)} frame along ${placement.axis.toUpperCase()} — click to drop · R turn · Alt free · Esc stop`
      : placement.kind === "bracket"
        ? "Placing bracket — point at a frame face · it snaps into joints nearby · R turn · Alt don't join · Esc stop"
        : "Placing T-nut — point at a frame face · Esc stop"
    : tool === "measure"
      ? measure !== null
        ? `Distance ${round(measure)} mm — click two more points, or V to go back`
        : "Measure — click two points"
      : selection.length
        ? "Drag to move · arrows nudge · R rotate · Del delete · right-drag look"
        : "Drag a part up from the shelf · click to select · right-drag look · WASD fly";
  const maxPreset = Math.max(...project.presets, 1);

  const railRows = (kind: Part["kind"]) =>
    project.parts
      .filter((p) => p.kind === kind)
      .map((p) => (
        <div
          key={p.id}
          role="option"
          aria-selected={selection.includes(p.id)}
          className={`tree-row leaf ${selection.includes(p.id) ? "sel" : ""} ${p.hidden ? "dim" : ""}`}
          onClick={(e) =>
            setSelection(
              expandedSelection(
                project.parts,
                e.shiftKey || e.ctrlKey || e.metaKey
                  ? selection.includes(p.id)
                    ? selection.filter((x) => x !== p.id)
                    : [...selection, p.id]
                  : [p.id],
              ),
            )
          }
          onDoubleClick={() => setSelection(connectedIds(project.parts, [p.id]))}
          onContextMenu={(e) => {
            e.preventDefault();
            const ids = selection.includes(p.id) ? selection : [p.id];
            if (!selection.includes(p.id)) setSelection([p.id]);
            setContext({ x: e.clientX, y: e.clientY, items: partMenu(ids) });
          }}
        >
          {kindIcon(p.kind)}
          <span className="name">{p.label}</span>
          <span className="desc">
            {p.kind === "rail"
              ? `${p.length} ${p.axis.toUpperCase()}`
              : p.kind === "bracket"
                ? p.b
                  ? `${rail(project.parts, p.a)?.label} · ${rail(project.parts, p.b)?.label}`
                  : `on ${rail(project.parts, p.a)?.label}`
                : rail(project.parts, p.rail)?.label}
          </span>
          {p.locked && <Lock size={10} className="lock" />}
        </div>
      ));

  /* ----- render ----- */
  return (
    <div className="app">
      <MenuBar menus={menus}>
        <span className="flex" />
        <span className="doc-title">
          {project.name}
          {dirty && <span title="Not saved to a file yet"> *</span>}
        </span>
        <span className="flex" />
        <span className="app-name">gLOWframes</span>
      </MenuBar>

      <div className="toolbar">
        <Btn icon={FilePlus2} label="New frame" onClick={() => projectNew(false)} />
        <Btn icon={FolderOpen} label="Open" shortcut="Ctrl+O" onClick={() => file.current?.click()} />
        <Btn icon={Save} label="Save" shortcut="Ctrl+S" onClick={save} />
        <span className="tb-sep" />
        <Btn icon={Undo2} label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!history.current.length} />
        <Btn icon={Redo2} label="Redo" shortcut="Ctrl+Y" onClick={redo} disabled={!future.current.length} />
        <span className="tb-sep" />
        <Btn icon={MousePointer2} text="Select" label="Select and move" shortcut="V" active={tool === "select" && !placement} onClick={() => setMode("select")} />
        <Btn icon={Ruler} text="Measure" label="Measure between two points" shortcut="M" active={tool === "measure"} onClick={() => setMode("measure")} />
        <span className="tb-sep" />
        <Btn icon={RotateCw} label="Rotate" shortcut="R" onClick={rotate} disabled={!canRotate} />
        <Btn icon={Copy} label="Duplicate" shortcut="Ctrl+D" onClick={duplicate} disabled={!selection.length} />
        <Btn icon={Trash2} label="Delete" shortcut="Del" onClick={() => remove()} disabled={!selection.length} />
        <span className="tb-sep" />
        <span className="tb-label">Snap</span>
        <Btn icon={Magnet} label="Snap moves to the step size (hold Alt to ignore)" active={snapEnabled} onClick={() => setSnapEnabled(!snapEnabled)} />
        <select
          className="step-select"
          aria-label="Step size"
          title="Step size  ([ and ])"
          disabled={!snapEnabled}
          value={STEPS.includes(step) ? step : "custom"}
          onChange={(e) => (e.target.value === "custom" ? setModal("step") : setStep(Number(e.target.value)))}
        >
          {STEPS.map((n) => (
            <option value={n} key={n}>
              {n} mm
            </option>
          ))}
          <option value="custom">{STEPS.includes(step) ? "Other…" : `${step} mm`}</option>
        </select>
        <Btn icon={Link2} label="Snap frames flush against other frames" text="Faces" active={attach} onClick={() => setAttach(!attach)} />
        <span className="flex" />
        <Btn icon={Camera} text="Image" label="Export image of this view (PNG)" onClick={() => exportFile("image")} />
        <Btn icon={Printer} text="Build sheet" label="Export printable build sheet with dimensions and parts" onClick={() => exportFile("sheet")} />
      </div>

      <div className="workspace">
        {/* ---- Viewport ---- */}
        <main className="view-shell">
          <div className="view-head">
            <Seg
              value={currentView}
              onChange={view}
              options={[
                { value: "perspective", label: "Persp", title: "Perspective (0)" },
                { value: "top", label: "Top", title: "Top (7)" },
                { value: "front", label: "Front", title: "Front (1)" },
                { value: "right", label: "Right", title: "Right (3)" },
              ]}
            />
            <span className="flex" />
            {moveAxis !== "plane" && (
              <span className="axis-lock" onClick={() => setMoveAxis("plane")} title="Click to free movement">
                Locked to <AxisLetter a={moveAxis} /> <X size={11} />
              </span>
            )}
            <div className="seg">
              {(
                [
                  ["Grid", grid, setGrid, "Show floor grid"],
                  ["Names", labels, setLabels, "Show frame names"],
                  ["Size", dimensions, setDimensions, "Show overall dimensions"],
                ] as const
              ).map(([name, on, set, tip]) => (
                <button key={name} className={on ? "on" : ""} title={tip} onClick={() => set(!on)}>
                  {name}
                </button>
              ))}
            </div>
            <Btn icon={Scan} label="Zoom to everything" shortcut="Home" onClick={() => viewport.current?.fit()} />
          </div>
          <div className="view-area">
            <div ref={host} className="viewport" />
            {webglError && <div className="webgl-error">{webglError}</div>}
            {!project.parts.length && !placement && (
              <div className="empty">Drag a frame up from the shelf below</div>
            )}
            {measure !== null && (
              <div className="measure-tag">
                {round(measure)} mm
              </div>
            )}
          </div>
          <div className="shelf" aria-label="Parts">
            <div className="shelf-group">
              <div className="shelf-label">
                Frames <span>20 × 20 mm</span>
              </div>
              <div className="shelf-row">
                {project.presets.map((length) => (
                  <div
                    key={length}
                    className={`tile ${placement?.kind === "rail" && placement.length === length ? "sel" : ""}`}
                    onPointerDown={(e) => shelfDrag(e, "rail", length)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContext({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          {
                            label: "Remove from shelf",
                            disabled: project.presets.length < 2,
                            action: () => commit({ ...project, presets: project.presets.filter((x) => x !== length) }),
                          },
                        ],
                      });
                    }}
                    title="Drag into the view, or click then click in the view"
                  >
                    <RailGlyph length={length} max={maxPreset} />
                    <span className="tile-name">{cm(length)}</span>
                  </div>
                ))}
                <div className="tile add" onClick={() => setModal("part")} title="Add another frame length">
                  <span className="plus">+</span>
                  <span className="tile-name">Other length</span>
                </div>
              </div>
            </div>
            <div className="shelf-group">
              <div className="shelf-label">Points</div>
              <div className="shelf-col">
                <Seg
                  value={placement?.kind === "rail" ? placement.axis : axis}
                  title="Direction new frames point (R)"
                  options={axes.map((a) => ({
                    value: a,
                    label: <AxisLetter a={a} />,
                    title: a === "y" ? "Upright (Y)" : `Flat along ${a.toUpperCase()}`,
                  }))}
                  onChange={(a) => {
                    setAxis(a);
                    if (placement?.kind === "rail") setPlacement({ ...placement, axis: a });
                  }}
                />
                <label className="check-row" title="Stay in placing mode after each drop">
                  <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                  Keep placing
                </label>
              </div>
            </div>
            <div className="shelf-group">
              <div className="shelf-label">Hardware</div>
              <div className="shelf-row">
                {(
                  [
                    ["bracket", "Bracket 90°", <BracketGlyph />, "Drop where two frames meet"],
                    ["nut", "T-nut", <NutGlyph />, "Drop on any frame face — for mounting things"],
                  ] as const
                ).map(([kind, name, glyph, tip]) => (
                  <div
                    key={kind}
                    className={`tile ${placement?.kind === kind ? "sel" : ""}`}
                    onPointerDown={(e) => shelfDrag(e, kind)}
                    title={tip}
                  >
                    {glyph}
                    <span className="tile-name">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        {/* ---- Right column ---- */}
        <aside className="panel right">
          <Section title="Outliner" grow open={open.outliner} onToggle={() => toggle("outliner")}>
            <div className="tree" role="listbox" aria-multiselectable="true">
              {(
                [
                  ["rail", "Frames"],
                  ["bracket", "Brackets"],
                  ["nut", "T-nuts"],
                ] as const
              ).map(([kind, name]) => {
                const count = project.parts.filter((p) => p.kind === kind).length;
                if (!count) return null;
                return (
                  <React.Fragment key={kind}>
                    <div className="tree-row branch" onClick={() => toggle(kind)}>
                      {open[kind] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      <span className="name">{name}</span>
                      <span className="desc">{count}</span>
                    </div>
                    {open[kind] && railRows(kind)}
                  </React.Fragment>
                );
              })}
              {!project.parts.length && <div className="tree-empty">Nothing yet</div>}
            </div>
          </Section>

          <Section
            title={single ? `${single.label} · ${single.kind === "rail" ? "Frame" : single.kind === "nut" ? "T-nut" : "Bracket"}` : selection.length ? `${selection.length} selected` : "Frame"}
            open={open.properties}
            onToggle={() => toggle("properties")}
          >
            <div className="props">
              {single ? (
                <>
                  {single.locked && (
                    <div className="locked-bar">
                      <Lock size={11} /> Locked
                      <button className="mini" onClick={() => updateLock(single.id, false)}>Unlock</button>
                    </div>
                  )}
                  <label className="prop">
                    <span>Name</span>
                    <input value={single.label} maxLength={80} disabled={single.locked} onChange={(e) => updatePart(single.id, { label: e.target.value })} />
                  </label>
                  {single.kind === "rail" && (
                    <>
                      <label className="prop">
                        <span>Length</span>
                        <NumberField label="Frame length" value={single.length} min={40} step={step} onChange={(v) => updatePart(single.id, { length: v })} />
                        <em>mm</em>
                      </label>
                      <div className="prop">
                        <span>Points</span>
                        <Seg
                          value={single.axis}
                          disabled={single.locked}
                          options={axes.map((a) => ({ value: a, label: <AxisLetter a={a} /> }))}
                          onChange={(a) => updatePart(single.id, { axis: a })}
                        />
                      </div>
                      <div className="prop-label">Center</div>
                      <div className="xyz">
                        {axes.map((a, i) => (
                          <label key={a}>
                            <AxisLetter a={a} />
                            <NumberField
                              label={`Center ${a.toUpperCase()}`}
                              value={single.p[i]}
                              step={step}
                              onChange={(v) => {
                                const delta: Vec = [0, 0, 0];
                                delta[i] = v - single.p[i];
                                const r = moveParts(project, selection, delta);
                                r.error ? notify(r.error) : commit(r.project);
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="prop-actions">
                        <button className="mini" onClick={() => setSelection(connectedIds(project.parts, selection))}>Select connected</button>
                        <button className="mini" onClick={() => detach(single)}>Detach</button>
                      </div>
                    </>
                  )}
                  {single.kind === "nut" && (() => {
                    const r = rail(project.parts, single.rail);
                    const len = r?.length || 0;
                    return (
                      <>
                        <div className="prop">
                          <span>On frame</span>
                          <button className="link" onClick={() => setSelection([single.rail])}>{r?.label}</button>
                        </div>
                        <label className="prop">
                          <span>Face</span>
                          <select
                            aria-label="T-nut face"
                            value={`${single.sign},${single.face}`}
                            disabled={single.locked}
                            onChange={(e) => {
                              const [sign, face] = e.target.value.split(",");
                              updatePart(single.id, { sign: Number(sign), face: face as Axis });
                            }}
                          >
                            {axes
                              .filter((a) => a !== r?.axis)
                              .flatMap((a) =>
                                [1, -1].map((s) => (
                                  <option key={`${s}${a}`} value={`${s},${a}`}>
                                    {a === "y" ? (s > 0 ? "Top" : "Bottom") : `${s > 0 ? "+" : "−"}${a.toUpperCase()} side`}
                                  </option>
                                )),
                              )}
                          </select>
                        </label>
                        <label className="prop" title="Measured from the frame's low-coordinate end">
                          <span>From end</span>
                          <NumberField label="Distance from frame end" value={single.offset + len / 2} min={5} max={len - 5} step={step} onChange={(v) => updatePart(single.id, { offset: v - len / 2 })} />
                          <em>mm</em>
                        </label>
                      </>
                    );
                  })()}
                  {single.kind === "bracket" && (() => {
                    const host = rail(project.parts, single.a);
                    const f = bracketFrame(single, project.parts);
                    if (!host || !f) return null;
                    const ia = ai(host.axis);
                    const fromEnd = round(f.origin[ia] - (host.p[ia] - host.length / 2));
                    return (
                      <>
                        <div className="prop">
                          <span>On</span>
                          <button className="link" onClick={() => setSelection([host.id])}>{host.label}</button>
                        </div>
                        <label className="prop">
                          <span>Face</span>
                          <select
                            aria-label="Bracket face"
                            value={`${single.sign},${single.face}`}
                            disabled={single.locked}
                            onChange={(e) => {
                              const [sign, face] = e.target.value.split(",");
                              setBracketFace(single, face as Axis, Number(sign));
                            }}
                          >
                            {axes
                              .filter((a) => a !== host.axis)
                              .flatMap((a) =>
                                [1, -1].map((s) => (
                                  <option key={`${s}${a}`} value={`${s},${a}`}>
                                    {a === "y" ? (s > 0 ? "Top" : "Bottom") : `${s > 0 ? "+" : "−"}${a.toUpperCase()} side`}
                                  </option>
                                )),
                              )}
                          </select>
                        </label>
                        <label className="prop" title="Inside corner, measured from the frame's low-coordinate end">
                          <span>From end</span>
                          {single.b ? (
                            <span className="value">{fromEnd} mm · follows {rail(project.parts, single.b)?.label}</span>
                          ) : (
                            <>
                              <NumberField
                                label="Bracket corner from frame end"
                                value={fromEnd}
                                step={step}
                                onChange={(v) => {
                                  const offset = round(v - host.length / 2);
                                  const next = { ...single, offset };
                                  if (!bracketOk(next, project.parts)) return notify("That would put the leg off the frame");
                                  replaceBracket(single, next);
                                }}
                              />
                              <em>mm</em>
                            </>
                          )}
                        </label>
                        <div className="prop">
                          <span>Joins</span>
                          {single.b ? (
                            <button className="link" onClick={() => setSelection([single.b])}>{rail(project.parts, single.b)?.label}</button>
                          ) : (
                            <span className="value muted">nothing yet — slide it against a frame</span>
                          )}
                        </div>
                        <div className="prop">
                          <span>Type</span>
                          <span className="value">{bracketType(single, project.parts) === "stacked" ? "Holes near corner (stacked)" : "Standard 90°"}</span>
                        </div>
                        <div className="prop-actions">
                          <button className="mini" disabled={single.locked} onClick={() => rotateBracket(single)}>Rotate 90° (R)</button>
                          {single.b && (
                            <button className="mini" disabled={single.locked} onClick={() => release(single)}>Let go of {rail(project.parts, single.b)?.label}</button>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </>
              ) : selection.length ? (
                <>
                  <div className="prop">
                    <span>Contains</span>
                    <span className="value">
                      {[
                        [selRails.length, "frame"],
                        [selected.filter((p) => p.kind === "bracket").length, "bracket"],
                        [selected.filter((p) => p.kind === "nut").length, "T-nut"],
                      ]
                        .filter(([n]) => n)
                        .map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`)
                        .join(", ")}
                    </span>
                  </div>
                  <div className="prop-actions">
                    <button className="mini" onClick={() => setSelection(connectedIds(project.parts, selection))}>Select connected</button>
                    <button className="mini" onClick={() => alter((p) => (p.locked = !allLocked))}>{allLocked ? "Unlock" : "Lock"}</button>
                    {selRails.length >= 2 && (
                      <button className="mini" onClick={(e) => setContext({ x: e.clientX, y: e.clientY, items: [
                        { label: "Align centers", sub: axisSub((a) => spatial("align", a), false) },
                        { label: "Space evenly", sub: axisSub((a) => spatial("distribute", a), selRails.length < 3), disabled: selRails.length < 3 },
                      ] })}>Arrange ▾</button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className="prop">
                    <span>Name</span>
                    <input value={project.name} maxLength={120} onChange={(e) => commit({ ...project, name: e.target.value })} />
                  </label>
                  <div className="prop-label">Overall size</div>
                  <div className="xyz readout">
                    {axes.map((a, i) => (
                      <div key={a}>
                        <AxisLetter a={a} />
                        <span>{bb.size[i]}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>

          <Section
            title="Parts list"
            open={open.bom}
            onToggle={() => toggle("bom")}
            extra={
              <button className="mini" title="Download as CSV spreadsheet" onClick={() => exportFile("csv")}>
                CSV
              </button>
            }
          >
            <table className="bom">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="qty">{r.qty}×</td>
                    <td>
                      {r.item === "T-slot frame" ? `Frame ${cm(Number(r.spec.split("×").pop()!.replace(/[^\d.]/g, "")))}` : r.item}
                      {r.item !== "T-slot frame" && r.spec && <small>{r.spec.replace("Bracket connections", "for brackets").replace("Independent mounting points", "mounting")}</small>}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="muted" colSpan={2}>No parts yet</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="bom-foot">
              <span>Total length</span>
              <b>{totalLength} m</b>
            </div>
            <label className="bom-foot" title="How many screws and T-nuts hold each leg of a bracket">
              <span>Screws per bracket leg</span>
              <select aria-label="Screws per bracket leg" value={project.fastenersPerSide} onChange={(e) => commit({ ...project, fastenersPerSide: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="checks">
              {checks.length ? (
                checks.map((c, i) => (
                  <button key={i} className="issue" onClick={() => setSelection(c.ids)} title="Click to select">
                    ⚠ {c.text}
                  </button>
                ))
              ) : project.parts.length ? (
                <span className="ok">✓ No overlaps or loose frames</span>
              ) : null}
            </div>
          </Section>
        </aside>
      </div>

      <footer className="statusbar">
        <span className="status-msg">{message || hint}</span>
        <span className="status-cell">{selection.length ? `${selection.length} selected` : `${project.parts.length} parts`}</span>
        <span className="status-cell">{bb.size.join(" × ")} mm</span>
        <span className="status-cell">{rails.length} frames · {totalLength} m</span>
      </footer>

      <input ref={file} type="file" accept=".glowframe,.json" hidden onChange={load} />

      {context && (
        <div className="context-layer" onMouseDown={() => setContext(null)} onContextMenu={(e) => { e.preventDefault(); setContext(null); }}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <MenuList
              items={context.items}
              onDone={() => setContext(null)}
              style={{ position: "fixed", left: Math.min(context.x, window.innerWidth - 200), top: Math.min(context.y, window.innerHeight - 240) }}
            />
          </div>
        </div>
      )}

      {modal === "part" && (
        <Dialog title="Add frame length" onClose={() => setModal(null)}>
          <NewPart project={project} onCommit={commit} onClose={() => setModal(null)} />
        </Dialog>
      )}
      {modal === "step" && (
        <Dialog title="Step size" onClose={() => setModal(null)}>
          <CustomStep step={step} onStep={setStep} onClose={() => setModal(null)} />
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="Controls" onClose={() => setModal(null)}>
          <div className="window-body">
            <table className="keys">
              <tbody>
                {[
                  ["Add a part", "Drag it from the shelf into the view"],
                  ["Select / add to selection", "Click / Shift+click"],
                  ["Box select", "Drag on empty space"],
                  ["Move", "Drag a part, or its colored arrows"],
                  ["Move along one axis", "X, Y or Z (again to release)"],
                  ["Nudge by one step", "Arrow keys"],
                  ["Change step", "[ and ]"],
                  ["Ignore snapping", "Hold Alt while dragging"],
                  ["Other snap spots", "Tab while snapped"],
                  ["Rotate a frame / turn a bracket", "R"],
                  ["Look around", "Hold right mouse and drag"],
                  ["Fly", "W A S D · Q/E down/up · Shift faster"],
                  ["Pan / zoom", "Shift+right-drag / wheel"],
                  ["Views", "0 persp · 7 top · 1 front · 3 right"],
                  ["Zoom to selection / all", "F / Home"],
                  ["Hide / show all", "H / Shift+H"],
                  ["Undo / redo", "Ctrl+Z / Ctrl+Y"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Save writes a .glowframe file to your downloads. Your latest work is also kept in this browser in case the tab closes.</p>
          </div>
        </Dialog>
      )}
    </div>
  );

  function updateLock(id: string, locked: boolean) {
    const p = clone(project);
    const part = p.parts.find((x) => x.id === id);
    if (part) part.locked = locked;
    commit(p);
  }
}

function NewPart({
  project,
  onCommit,
  onClose,
}: {
  project: Project;
  onCommit: (p: Project) => void;
  onClose: () => void;
}) {
  const [length, setLength] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="window-body"
      onSubmit={(e) => {
        e.preventDefault();
        const c = Number(length),
          mm = Math.round(c * 10);
        if (!length.trim() || !Number.isFinite(c) || mm < 40 || mm > 100000)
          return setError("Use a length between 4 and 10,000 cm.");
        if (project.presets.includes(mm)) return setError("That length is already in the list.");
        if (project.presets.length >= 30) return setError("The list holds up to 30 lengths.");
        onCommit({ ...project, presets: [...project.presets, mm].sort((a, b) => a - b) });
        onClose();
      }}
    >
      <label className="prop">
        <span>Length</span>
        <input
          autoFocus
          aria-label="New frame length in cm"
          type="number"
          min="4"
          max="10000"
          step="0.1"
          value={length}
          onChange={(e) => {
            setLength(e.target.value);
            setError("");
          }}
        />
        <em>cm</em>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="window-actions">
        <button type="button" className="mini" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="mini default">
          Add
        </button>
      </div>
    </form>
  );
}

function CustomStep({
  step,
  onStep,
  onClose,
}: {
  step: number;
  onStep: (n: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(step));
  const n = Number(value);
  const ok = value.trim() !== "" && Number.isFinite(n) && n >= 0.1 && n <= 1000;
  return (
    <form
      className="window-body"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onStep(n);
        onClose();
      }}
    >
      <label className="prop">
        <span>Step</span>
        <input autoFocus aria-label="Custom step" type="number" min="0.1" max="1000" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} />
        <em>mm</em>
      </label>
      {!ok && <p className="error">Use a step between 0.1 and 1000 mm.</p>}
      <div className="window-actions">
        <button type="button" className="mini" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="mini default" disabled={!ok}>
          OK
        </button>
      </div>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
