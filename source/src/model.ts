import {
  bracketInterference,
  clearanceConflicts,
  newClearanceError,
} from "./clearance.ts";
export type Axis = "x" | "y" | "z";
export type Vec = [number, number, number];
export const axes: Axis[] = ["x", "y", "z"];
export const ai = (a: Axis) => axes.indexOf(a);
export const PROFILE = 20;
export const STANDARD_LENGTHS = [200, 300, 380];
export type Base = {
  id: string;
  label: string;
  hidden?: boolean;
  locked?: boolean;
  group?: string;
};
export type Rail = Base & { kind: "rail"; length: number; axis: Axis; p: Vec };
export type Nut = Base & {
  kind: "nut";
  rail: string;
  face: Axis;
  sign: number;
  offset: number;
};
/** A 90° bracket screwed to one frame (like a T-nut, it sits on a face and
 * slides along it). Its flat leg lies on face `face`/`sign` of frame `a`
 * and runs along the frame in direction `sa`; the upright leg stands out
 * from that face. When the upright leg rests against a second frame `b`,
 * the bracket joins the two and follows that frame. */
export type Bracket = Base & {
  kind: "bracket";
  a: string;
  face: Axis;
  sign: number;
  sa: number;
  /** Inside-corner position along frame a, measured from its center. */
  offset: number;
  /** Frame held by the upright leg; "" when the bracket joins nothing. */
  b: string;
  /** Turned 90° on the face: the flat leg runs across the frame instead of
   * along it (only the bracket with holes near the corner fits this way). */
  across?: boolean;
};
export type Part = Rail | Nut | Bracket;
export type Project = {
  format: "glowframes";
  version: 1;
  name: string;
  units: "mm";
  presets: number[];
  parts: Part[];
  fastenersPerSide: number;
};
export type BillRow = { item: string; spec: string; qty: number; ids: string };
export const uid = () => crypto.randomUUID();
export const rail = (parts: Part[], id: string) =>
  parts.find((p) => p.id === id && p.kind === "rail") as Rail | undefined;
export const round = (n: number) => Math.round(n * 1000) / 1000;
export const snap = (n: number, step: number) =>
  step > 0 ? round(Math.round(n / step) * step) : round(n);
export const clone = <T>(v: T): T => structuredClone(v);
export function nextLabel(parts: Part[], kind: Part["kind"]) {
  const prefix = { rail: "F", nut: "T", bracket: "B" }[kind];
  let i = 1;
  while (
    parts.some((p) => p.label === `${prefix}${String(i).padStart(2, "0")}`)
  )
    i++;
  return `${prefix}${String(i).padStart(2, "0")}`;
}
export function newRail(
  parts: Part[],
  length: number,
  axis: Axis,
  p: Vec,
): Rail {
  return {
    id: uid(),
    label: nextLabel(parts, "rail"),
    kind: "rail",
    length,
    axis,
    p,
  };
}
/** `strict` asks for real overlap (new brackets); without it, frames that
 * only meet edge to edge still count, so a held frame can slide that far. */
/* ---------- legacy joint geometry (only used to read older files) ---------- */
function legacyJunction(a: Rail, b: Rail): Vec | null {
  if (a.axis === b.axis) return null;
  const ia = ai(a.axis),
    ib = ai(b.axis),
    ic = 3 - ia - ib;
  if (Math.abs(a.p[ic] - b.p[ic]) > 0.1) return null;
  const c: Vec = [...a.p];
  c[ia] = b.p[ia];
  return c;
}

/* ---------- brackets ---------- */
export const LEG = 30;
/** Hole distances from the inside corner: the standard bracket, and the lab
 * bracket with its holes drilled near the corner. */
const HOLES = [18, 10];
type Frame = { origin: Vec; u: [number, number]; v: [number, number] };
/** The four ways a bracket can sit on a face, in 90° steps. */
export const ORIENTS: { across: boolean; sa: number }[] = [
  { across: false, sa: 1 },
  { across: true, sa: 1 },
  { across: false, sa: -1 },
  { across: true, sa: -1 },
];
export const orientOf = (b: Pick<Bracket, "across" | "sa">) =>
  ORIENTS.findIndex((o) => o.across === !!b.across && o.sa === b.sa);
const half = (r: Rail, i: number) => (i === ai(r.axis) ? r.length / 2 : 10);
/** Inside corner of a bracket and the directions of its two legs. */
export function bracketFrame(
  br: Pick<Bracket, "a" | "b" | "face" | "sign" | "sa" | "offset" | "across">,
  parts: Part[],
): Frame | null {
  const a = rail(parts, br.a);
  if (!a) return null;
  const ia = ai(a.axis),
    n = ai(br.face);
  if (n === ia) return null;
  const iw = 3 - ia - n,
    iu = br.across ? iw : ia;
  const origin: Vec = [...a.p];
  origin[n] += br.sign * 10;
  origin[ia] = a.p[ia] + br.offset;
  // Turned across, the flat leg starts at one edge of the face so its hole
  // (near the corner) lands on the slot.
  if (br.across) origin[iw] = a.p[iw] - br.sa * 10;
  const b = br.b ? rail(parts, br.b) : undefined;
  if (b && ai(b.axis) !== iu) {
    // A joined bracket follows the frame it holds.
    if (!br.across) origin[ia] = b.p[ia] + br.sa * 10;
    else if (ai(b.axis) !== ia) origin[ia] = b.p[ia];
  }
  return { origin, u: [iu, br.sa], v: [n, br.sign] };
}
/** Two frames touching only along an edge or at a corner. */
function edgeOnly(a: Rail, b: Rail) {
  const depth = [0, 1, 2].map(
    (i) => half(a, i) + half(b, i) - Math.abs(a.p[i] - b.p[i]),
  );
  if (depth.some((d) => d < -0.1)) return false; // apart: a bracket may bridge
  return depth.filter((d) => Math.abs(d) <= 0.1).length >= 2;
}
const overlapping = (a: Rail, b: Rail) =>
  [0, 1, 2].every(
    (i) => Math.abs(a.p[i] - b.p[i]) < half(a, i) + half(b, i) - 0.1,
  );
/** Does frame b sit flush against the upright leg with its slot through the
 * leg's hole (at distance h from the corner)? */
function joins(f: Frame, a: Rail, b: Rail, h: number) {
  const [iu, su] = f.u,
    [iv, sv] = f.v,
    ib = ai(b.axis);
  if (b.id === a.id || ib === iu) return false;
  // b's face lies against the back of the upright leg.
  if (Math.abs((b.p[iu] - f.origin[iu]) * su + half(b, iu)) > 0.1) return false;
  // b's slot on that face passes through the hole.
  const hole: Vec = [...f.origin];
  hole[iv] += sv * h;
  const k = 3 - iu - ib;
  if (Math.abs(hole[k] - b.p[k]) > 0.1) return false;
  if (Math.abs(hole[ib] - b.p[ib]) > b.length / 2 - 5 + 0.1) return false;
  // A frame running up the leg must reach down to the face it stands on.
  const face = f.origin[iv];
  if (ib === iv && (b.p[iv] - face) * sv - b.length / 2 > 0.1) return false;
  // The 16 mm wide leg needs frame behind it.
  const iw = 3 - iu - iv;
  if (ib === iw && Math.abs(f.origin[iw] - b.p[iw]) > b.length / 2 - 8 + 0.1)
    return false;
  return !overlapping(a, b);
}
/** Hole distance that works for this bracket, or null if none does. */
function holeFor(f: Frame, a: Rail, b?: Rail) {
  const ia = ai(a.axis),
    iw = 3 - ia - f.v[0];
  return (
    HOLES.find((h) => {
      // The flat leg's hole must land in its own frame's slot.
      const hole = f.origin[iw] + (f.u[0] === iw ? f.u[1] * h : 0);
      if (Math.abs(hole - a.p[iw]) > 0.1) return false;
      return !b || joins(f, a, b, h);
    }) ?? null
  );
}
/** The flat leg has to sit on its frame. */
function legOnFrame(f: Frame, a: Rail) {
  const ia = ai(a.axis),
    lo = a.p[ia] - a.length / 2 - 0.1,
    hi = a.p[ia] + a.length / 2 + 0.1;
  const [x, y] =
    f.u[0] === ia
      ? [f.origin[ia], f.origin[ia] + f.u[1] * LEG]
      : [f.origin[ia] - 8, f.origin[ia] + 8];
  return Math.min(x, y) >= lo && Math.max(x, y) <= hi;
}
/** Keeps a bracket out of the floor. */
function aboveFloor(f: Frame) {
  let low = Infinity;
  for (const du of [0, LEG])
    for (const dv of [0, LEG])
      for (const dw of [-8, 8]) {
        let y = f.origin[1];
        if (f.u[0] === 1) y += f.u[1] * du;
        if (f.v[0] === 1) y += f.v[1] * dv;
        if (f.u[0] !== 1 && f.v[0] !== 1) y += dw;
        low = Math.min(low, y);
      }
  return low >= -0.1;
}
function hole(br: Bracket, parts: Part[]) {
  const a = rail(parts, br.a),
    f = bracketFrame(br, parts);
  if (!a || !f) return null;
  return holeFor(f, a, br.b ? rail(parts, br.b) : undefined);
}
/** "stacked" = the lab bracket with holes near the corner. */
export function bracketType(br: Bracket, parts: Part[]) {
  const h = hole(br, parts);
  return h === null ? null : h === 10 ? "stacked" : "corner";
}
export const holeOffset = (br: Bracket, parts: Part[]) => hole(br, parts) ?? 18;
/** A bracket is valid when its flat leg is on its frame, its holes land in
 * slots and, if it joins a second frame, that frame still sits against the
 * upright leg. */
export function bracketOk(br: Bracket, parts: Part[]) {
  const a = rail(parts, br.a),
    f = bracketFrame(br, parts);
  if (!a || !f || ![1, -1].includes(br.sa) || ![1, -1].includes(br.sign))
    return false;
  if (!legOnFrame(f, a)) return false;
  if (br.b && !rail(parts, br.b)) return false;
  return hole(br, parts) !== null;
}
/** Compatibility alias. */
export const bracketFits = bracketOk;
/** Joints a bracket on this face, turned this way, could make; `near` is
 * where along the frame to put it when the joint doesn't fix that. */
function joints(
  a: Rail,
  face: Axis,
  sign: number,
  o: { across: boolean; sa: number },
  parts: Part[],
  near: number,
) {
  const ia = ai(a.axis),
    out: Bracket[] = [];
  for (const b of parts) {
    if (b.kind !== "rail" || b.id === a.id || b.hidden) continue;
    // Frames that only meet along an edge don't get new joints (an existing
    // joint may still slide out that far).
    if (edgeOnly(a, b)) continue;
    const lim = a.length / 2 - (o.across ? 8 : 0);
    const br: Bracket = {
      kind: "bracket",
      id: "candidate",
      label: "Bracket",
      a: a.id,
      face,
      sign,
      sa: o.sa,
      offset: round(Math.max(-lim, Math.min(lim, near - a.p[ia]))),
      b: b.id,
      ...(o.across ? { across: true } : {}),
    };
    const f = bracketFrame(br, parts)!;
    br.offset = round(f.origin[ia] - a.p[ia]);
    if (bracketOk(br, parts)) out.push(br);
  }
  return out;
}
const sameSpot = (x: Bracket, y: Bracket, parts: Part[]) => {
  const f = bracketFrame(x, parts),
    g = bracketFrame(y, parts);
  return (
    !!f &&
    !!g &&
    // The legs are alike, so a bracket seen from either frame is the same.
    [f.u, f.v].sort().join() === [g.u, g.v].sort().join() &&
    f.origin.every((v, i) => Math.abs(v - g.origin[i]) < 0.5)
  );
};
/** Middle of the bracket's footprint along its frame. */
const centerAlong = (f: Frame, a: Rail) =>
  f.u[0] === ai(a.axis) ? f.origin[ai(a.axis)] + f.u[1] * 15 : f.origin[ai(a.axis)];
/** Where a bracket goes on frame `a`, face `face`/`sign`, with the cursor at
 * `point`. With `join` it snaps into a joint within `reach` mm; otherwise it
 * sits at the cursor, kept on the frame. `orient` (0-3, see ORIENTS) fixes
 * how it is turned; leave it out to use whichever fits. */
export function bracketAt(
  parts: Part[],
  a: Rail,
  face: Axis,
  sign: number,
  point: Vec,
  opts: {
    orient?: number;
    step?: number;
    join?: boolean;
    reach?: number;
    id?: string;
    label?: string;
  },
): { bracket: Bracket; error?: undefined } | { bracket?: undefined; error: string } {
  const ia = ai(a.axis),
    n = ai(face);
  if (n === ia) return { error: "Point at a side of the frame" };
  const others = parts.filter((p) => p.id !== opts.id);
  const id = opts.id || uid(),
    label = opts.label || nextLabel(parts, "bracket");
  const orients =
    opts.orient === undefined ? [ORIENTS[0], ORIENTS[2]] : [ORIENTS[opts.orient % 4]];
  const fits = (br: Bracket) => {
    const f = bracketFrame(br, others);
    // The grid is only a guide, not a floor: brackets may reach below it.
    return !!f && bracketOk(br, others) && !bracketInterference(br, others);
  };
  const step = opts.step || 0;
  if (opts.join) {
    const reach = opts.reach ?? 40;
    const found = orients
      .flatMap((o) => joints(a, face, sign, o, others, snap(point[ia], step)))
      .map((br) => ({
        br: { ...br, id, label },
        d: Math.abs(centerAlong(bracketFrame(br, others)!, a) - point[ia]),
      }))
      .filter((j) => j.d <= reach)
      .sort((x, y) => x.d - y.d);
    for (const j of found) if (fits(j.br)) return { bracket: j.br };
  }
  let blocked = false;
  for (const o of orients) {
    const lo = a.p[ia] - a.length / 2,
      hi = a.p[ia] + a.length / 2;
    let at: number;
    if (o.across) {
      at = snap(point[ia] - a.p[ia], step) + a.p[ia];
      at = Math.min(Math.max(at, lo + 8), hi - 8);
    } else {
      // The cursor marks the middle of the flat leg.
      at = snap(point[ia] - o.sa * 15 - a.p[ia], step) + a.p[ia];
      at = o.sa > 0 ? Math.min(Math.max(at, lo), hi - LEG) : Math.max(Math.min(at, hi), lo + LEG);
    }
    const br: Bracket = {
      kind: "bracket",
      id,
      label,
      a: a.id,
      face,
      sign,
      sa: o.sa,
      offset: round(at - a.p[ia]),
      b: "",
      ...(o.across ? { across: true } : {}),
    };
    if (fits(br)) return { bracket: br };
    blocked = true;
  }
  return {
    error: blocked
      ? "No room for a bracket there — it would hit another part"
      : "This frame is too short for a bracket",
  };
}
/** Lone brackets whose upright leg now rests against a frame join it. */
export function joinTouching(parts: Part[]) {
  for (const br of parts) {
    if (br.kind !== "bracket" || br.b) continue;
    const a = rail(parts, br.a),
      f = bracketFrame(br, parts);
    if (!a || !f) continue;
    const j = joints(a, br.face, br.sign, { across: !!br.across, sa: br.sa }, parts, f.origin[ai(a.axis)]).find(
      (j) => {
        const g = bracketFrame(j, parts)!;
        return g.origin.every((v, i) => Math.abs(v - f.origin[i]) < 0.1);
      },
    );
    if (j) br.b = j.b;
  }
  return parts;
}
/** Every open joint position (used to fill in the example frame). */
export function bracketCandidates(parts: Part[]) {
  const rails = parts.filter((p) => p.kind === "rail" && !p.hidden) as Rail[];
  const existing = parts.filter((p) => p.kind === "bracket") as Bracket[];
  const result: Bracket[] = [];
  for (const a of rails)
    for (const face of axes) {
      if (face === a.axis) continue;
      for (const sign of [1, -1])
        for (const o of [ORIENTS[0], ORIENTS[2]])
          for (const br of joints(a, face, sign, o, parts, a.p[ai(a.axis)])) {
            const f = bracketFrame(br, parts)!;
            if (!aboveFloor(f) || bracketInterference(br, parts)) continue;
            if ([...existing, ...result].some((x) => sameSpot(x, br, parts))) continue;
            result.push(br);
          }
    }
  return result;
}
export function partPosition(part: Part, parts: Part[]): Vec {
  if (part.kind === "rail") return [...part.p];
  if (part.kind === "nut") {
    const r = rail(parts, part.rail);
    if (!r) return [0, 0, 0];
    const p: Vec = [...r.p];
    p[ai(r.axis)] += part.offset;
    p[ai(part.face)] += part.sign * 8;
    return p;
  }
  const f = bracketFrame(part, parts);
  if (!f) return [...(rail(parts, part.a)?.p || [0, 0, 0])] as Vec;
  const p: Vec = [...f.origin];
  p[f.u[0]] += f.u[1] * 10;
  p[f.v[0]] += f.v[1] * 10;
  return p;
}
export function bounds(parts: Part[]) {
  const min: Vec = [Infinity, Infinity, Infinity],
    max: Vec = [-Infinity, -Infinity, -Infinity];
  for (const r of parts.filter((p) => p.kind === "rail") as Rail[])
    for (let i = 0; i < 3; i++) {
      const h = i === ai(r.axis) ? r.length / 2 : 10;
      min[i] = Math.min(min[i], r.p[i] - h);
      max[i] = Math.max(max[i], r.p[i] + h);
    }
  if (!Number.isFinite(min[0]))
    return {
      min: [0, 0, 0] as Vec,
      max: [0, 0, 0] as Vec,
      size: [0, 0, 0] as Vec,
    };
  return { min, max, size: max.map((v, i) => round(v - min[i])) as Vec };
}
export function bill(project: Project): BillRow[] {
  const rows: BillRow[] = [];
  const lengths = [
    ...new Set(
      project.parts
        .filter((p) => p.kind === "rail")
        .map((p) => (p as Rail).length),
    ),
  ].sort((a, b) => a - b);
  for (const len of lengths) {
    const rs = project.parts.filter(
      (p) => p.kind === "rail" && p.length === len,
    );
    rows.push({
      item: "T-slot frame",
      spec: `20 × 20 × ${len} mm`,
      qty: rs.length,
      ids: rs.map((p) => p.label).join(", "),
    });
  }
  const brackets = project.parts.filter((p) => p.kind === "bracket") as Bracket[],
    nuts = project.parts.filter((p) => p.kind === "nut");
  for (const stacked of [false, true]) {
    const group = brackets.filter(
      (p) => (bracketType(p, project.parts) === "stacked") === stacked,
    );
    if (group.length)
      rows.push({
        item: stacked ? "Corner bracket, holes near corner" : "Corner bracket",
        spec: stacked
          ? "90° · 20 mm profile · stacked joints"
          : "90° · 20 mm profile",
        qty: group.length,
        ids: group.map((p) => p.label).join(", "),
      });
  }
  const fast = brackets.length * 2 * project.fastenersPerSide;
  if (fast) {
    rows.push({
      item: "T-nut",
      spec: "Bracket connections",
      qty: fast,
      ids: "",
    });
    rows.push({
      item: "Hex-socket screw",
      spec: "Bracket connections",
      qty: fast,
      ids: "",
    });
  }
  if (nuts.length)
    rows.push({
      item: "T-nut",
      spec: "Independent mounting points",
      qty: nuts.length,
      ids: nuts.map((p) => p.label).join(", "),
    });
  return rows;
}
export function csv(project: Project) {
  return (
    "\uFEFF" +
    [
      ["Item", "Specification", "Quantity", "Part IDs"],
      ...bill(project).map((r) => [r.item, r.spec, r.qty, r.ids]),
    ]
      .map((row) =>
        row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n")
  );
}
export function removeParts(project: Project, ids: string[]): Project {
  const next = clone(project),
    removing = new Set(ids);
  next.parts = next.parts.filter(
    (p) =>
      !removing.has(p.id) &&
      !(p.kind === "nut" && removing.has(p.rail)) &&
      !(p.kind === "bracket" && removing.has(p.a)),
  );
  // A bracket whose second frame is gone stays screwed to its own frame.
  for (const p of next.parts)
    if (p.kind === "bracket" && removing.has(p.b)) {
      const f = bracketFrame(p, project.parts),
        a = rail(next.parts, p.a)!;
      if (f) p.offset = round(f.origin[ai(a.axis)] - a.p[ai(a.axis)]);
      p.b = "";
    }
  return next;
}
export function moveParts(
  project: Project,
  ids: string[],
  delta: Vec,
): { project: Project; error?: string } {
  const next = clone(project),
    selected = new Set(ids);
  for (const p of next.parts)
    if (selected.has(p.id)) {
      if (p.locked) return { project, error: `${p.label} is locked` };
      if (p.kind === "rail")
        p.p = p.p.map((v, i) => round(v + delta[i])) as Vec;
      if (p.kind === "bracket" && !p.b && !selected.has(p.a)) {
        // A lone bracket slides along its frame like a T-nut.
        const r = rail(next.parts, p.a);
        if (r) p.offset = round(p.offset + delta[ai(r.axis)]);
      }
      if (p.kind === "nut") {
        const r = rail(next.parts, p.rail);
        if (r && !selected.has(r.id))
          p.offset = Math.max(
            -r.length / 2 + 5,
            Math.min(r.length / 2 - 5, round(p.offset + delta[ai(r.axis)])),
          );
      }
    }
  for (const p of next.parts) {
    if (p.kind === "bracket") {
      if (!bracketOk(p, next.parts))
        return {
          project,
          error: `${p.label} limits this movement · detach or move the assembly`,
        };
      if (p.locked && p.b && selected.has(p.a) !== selected.has(p.b))
        return { project, error: `${p.label} is locked` };
    }
  }
  const clearance = newClearanceError(project.parts, next.parts);
  if (clearance) return { project, error: clearance };
  joinTouching(next.parts);
  return { project: next };
}
export function expandedSelection(parts: Part[], ids: string[]) {
  const groups = new Set(
    parts.filter((p) => ids.includes(p.id) && p.group).map((p) => p.group),
  );
  return [
    ...new Set([
      ...ids,
      ...parts.filter((p) => p.group && groups.has(p.group)).map((p) => p.id),
    ]),
  ];
}
export function connectedIds(parts: Part[], ids: string[]) {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of parts)
      if (
        p.kind === "bracket" &&
        (result.has(p.a) || (p.b && result.has(p.b)) || result.has(p.id))
      )
        for (const id of [p.id, p.a, p.b].filter(Boolean))
          if (!result.has(id)) {
            result.add(id);
            changed = true;
          }
  }
  for (const p of parts)
    if (p.kind === "nut" && result.has(p.rail)) result.add(p.id);
  return [...result];
}
export function issues(parts: Part[]) {
  const result: { text: string; ids: string[] }[] = [];
  for (const c of clearanceConflicts(parts))
    result.push({ text: c.message, ids: c.ids });
  const rails = parts.filter((p) => p.kind === "rail") as Rail[];
  for (let i = 0; i < rails.length; i++)
    for (let j = i + 1; j < rails.length; j++) {
      const a = rails[i],
        b = rails[j];
      if (
        axes.every(
          (_, k) =>
            Math.abs(a.p[k] - b.p[k]) <
            (k === ai(a.axis) ? a.length / 2 : 10) +
              (k === ai(b.axis) ? b.length / 2 : 10) -
              0.1,
        )
      )
        result.push({
          text: `${a.label} overlaps ${b.label}`,
          ids: [a.id, b.id],
        });
    }
  for (const b of parts)
    if (b.kind === "bracket" && !b.b)
      result.push({
        text: `${b.label} holds only ${rail(parts, b.a)?.label} — slide it against another frame`,
        ids: [b.id],
      });
  for (const r of rails)
    if (
      !parts.some((p) => p.kind === "bracket" && (p.a === r.id || p.b === r.id))
    )
      result.push({
        text: `${r.label} has no bracket connection`,
        ids: [r.id],
      });
  return result;
}
export function emptyProject(): Project {
  return {
    format: "glowframes",
    version: 1,
    name: "Untitled frame",
    units: "mm",
    presets: [...STANDARD_LENGTHS],
    parts: [],
    fastenersPerSide: 1,
  };
}
export function exampleProject(): Project {
  const p = emptyProject();
  p.name = "Detector support";
  const add = (length: number, axis: Axis, pos: Vec) => {
    const r = newRail(p.parts, length, axis, pos);
    p.parts.push(r);
    return r;
  };
  add(600, "x", [0, 10, -190]);
  add(600, "x", [0, 10, 190]);
  add(360, "z", [-290, 10, 0]);
  add(360, "z", [290, 10, 0]);
  for (const x of [-290, 290])
    for (const z of [-190, 190]) add(400, "y", [x, 220, z]);
  add(560, "x", [0, 300, -190]);
  add(560, "x", [0, 300, 190]);
  add(360, "z", [-120, 300, 0]);
  add(360, "z", [120, 300, 0]);
  const pairs = new Set<string>();
  for (const c of bracketCandidates(p.parts)) {
    const key = [c.a, c.b].sort().join();
    if (pairs.has(key)) continue;
    pairs.add(key);
    p.parts.push({ ...c, id: uid(), label: nextLabel(p.parts, "bracket") });
  }
  return p;
}
export function parseProject(text: string): Project {
  if (text.length > 5_000_000) throw new Error("Project file exceeds 5 MB.");
  const p = JSON.parse(text);
  const finite = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000;
  if (
    !p ||
    p.format !== "glowframes" ||
    p.version !== 1 ||
    p.units !== "mm" ||
    typeof p.name !== "string" ||
    p.name.length > 120 ||
    !Array.isArray(p.parts) ||
    p.parts.length > 2000 ||
    !Array.isArray(p.presets) ||
    p.presets.length > 30 ||
    !p.presets.every((n: unknown) => finite(n) && (n as number) >= 40) ||
    !Number.isInteger(p.fastenersPerSide) ||
    p.fastenersPerSide < 1 ||
    p.fastenersPerSide > 4
  )
    throw new Error("This is not a supported gLOWframes project.");
  const ids = new Set();
  for (const part of p.parts) {
    if (
      !part ||
      typeof part.id !== "string" ||
      part.id.length > 100 ||
      ids.has(part.id) ||
      typeof part.label !== "string" ||
      part.label.length > 80
    )
      throw new Error("Invalid or duplicate part identifier.");
    ids.add(part.id);
    if (part.kind === "rail") {
      if (
        !axes.includes(part.axis) ||
        !finite(part.length) ||
        part.length < 40 ||
        !Array.isArray(part.p) ||
        part.p.length !== 3 ||
        !part.p.every(finite)
      )
        throw new Error("Invalid frame dimensions.");
    } else if (part.kind === "nut") {
      if (
        !axes.includes(part.face) ||
        ![1, -1].includes(part.sign) ||
        !finite(part.offset)
      )
        throw new Error("Invalid mounting point.");
    } else if (part.kind === "bracket") {
      if (typeof part.a !== "string" || (part.b !== undefined && typeof part.b !== "string"))
        throw new Error("Invalid bracket.");
    } else throw new Error("Unknown part type.");
  }
  for (const part of p.parts as Part[]) {
    if (part.kind === "nut") {
      const r = rail(p.parts, part.rail);
      if (
        !r ||
        r.axis === part.face ||
        Math.abs(part.offset) > r.length / 2 - 5 + 0.01
      )
        throw new Error("A mounting point is outside its slot.");
    }
  }
  // Older files stored brackets as a pair of frames; convert them.
  p.parts = (p.parts as any[]).filter((part) => !(part.kind === "bracket" && part.free));
  for (const part of p.parts as any[]) {
    if (part.kind !== "bracket" || part.face !== undefined) continue;
    const a = rail(p.parts, part.a),
      b = rail(p.parts, part.b);
    if (!a || !b || ![1, -1].includes(part.sa) || ![1, -1].includes(part.sb))
      throw new Error("A bracket has an invalid connection.");
    const ia = ai(a.axis),
      ib = ai(b.axis);
    const options = part.stack
      ? [{ a: a.id, b: b.id, face: axes[3 - ia - ib], sign: part.sb, sa: part.sa, offset: round(b.p[ia] + part.sa * 10 - a.p[ia]) }]
      : legacyJunction(a, b)
        ? [
            { a: a.id, b: b.id, face: b.axis, sign: part.sb, sa: part.sa, offset: round(b.p[ia] + part.sa * 10 - a.p[ia]) },
            { a: b.id, b: a.id, face: a.axis, sign: part.sa, sa: part.sb, offset: round(a.p[ib] + part.sb * 10 - b.p[ib]) },
          ]
        : [];
    const fit = options.find((o) => bracketOk({ ...part, ...o }, p.parts));
    if (!fit) throw new Error("A bracket has an invalid connection.");
    Object.assign(part, fit);
    delete part.sb;
    delete part.stack;
  }
  for (const part of p.parts as Part[]) {
    if (part.kind !== "bracket") continue;
    part.b = part.b || "";
    if (
      !axes.includes(part.face) ||
      ![1, -1].includes(part.sign) ||
      ![1, -1].includes(part.sa) ||
      !finite(part.offset) ||
      (part.across !== undefined && typeof part.across !== "boolean") ||
      !bracketOk(part, p.parts)
    )
      throw new Error(`Bracket ${part.label} doesn't fit where it is.`);
  }
  // Upgrade the original stock tray while preserving custom collections.
  const legacy = [100, 200, 300, 400, 600];
  if (
    p.presets.length === legacy.length &&
    p.presets.every((n: number, i: number) => n === legacy[i])
  )
    p.presets = [...STANDARD_LENGTHS];
  return p as Project;
}
