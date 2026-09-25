import { Box3, Vector3 } from "three";
import type { Bracket, Part, Rail, Vec } from "./model.ts";
import { bracketFrame, holeOffset } from "./model.ts";

type Solid = {
  vertices: Vector3[];
  normals: Vector3[];
  edges: Vector3[];
  box: Box3;
};
const index = (axis: string) => "xyz".indexOf(axis);
const unit = (i: number, sign = 1) => new Vector3().setComponent(i, sign);
function prism(
  points: number[][],
  lo: number,
  hi: number,
  transform: (v: Vector3) => Vector3,
): Solid {
  const vertices = [lo, hi].flatMap((z) =>
    points.map(([x, y]) => transform(new Vector3(x, y, z))),
  );
  const origin = transform(new Vector3()),
    vector = (v: Vector3) => transform(v).sub(origin);
  const edges = points.map(([x, y], i) => {
    const next = points[(i + 1) % points.length];
    return new Vector3(next[0] - x, next[1] - y, 0).normalize();
  });
  return {
    vertices,
    box: new Box3().setFromPoints(vertices),
    normals: [
      vector(unit(2)),
      ...edges.map((e) => vector(new Vector3(-e.y, e.x, 0))),
    ],
    edges: [vector(unit(2)), ...edges.map(vector)],
  };
}
function bodyBox(min: Vec, max: Vec, transform: (v: Vector3) => Vector3) {
  return prism(
    [
      [min[0], min[1]],
      [max[0], min[1]],
      [max[0], max[1]],
      [min[0], max[1]],
    ],
    min[2],
    max[2],
    transform,
  );
}
function bodies(part: Rail | Bracket, parts: Part[]): Solid[] {
  if (part.kind === "rail") {
    const size = part.p.map((_, i) =>
      i === index(part.axis) ? part.length / 2 : 10,
    ) as Vec;
    return [
      bodyBox(size.map((v) => -v) as Vec, size, (v) =>
        v.add(new Vector3(...part.p)),
      ),
    ];
  }
  const f = bracketFrame(part, parts);
  if (!f) return [];
  const u = unit(f.u[0], f.u[1]),
    v = unit(f.v[0], f.v[1]),
    w = new Vector3().crossVectors(u, v);
  const origin = new Vector3(...f.origin);
  const h = holeOffset(part, parts);
  const world = (p: Vector3) =>
    origin
      .clone()
      .addScaledVector(u, p.x)
      .addScaledVector(v, p.y)
      .addScaledVector(w, p.z);
  const result = [
    bodyBox([0, 0, -8], [30, 2.8, 8], world),
    bodyBox([0, 2.8, -8], [2.8, 30, 8], world),
  ];
  for (const z of [-8, 6])
    result.push(
      prism(
        [
          [2.8, 2.8],
          [27, 2.8],
          [2.8, 27],
        ],
        z,
        z + 2,
        world,
      ),
    );
  const hex = Array.from({ length: 6 }, (_, i) => [
    3.8 * Math.sin((i * Math.PI) / 3),
    3.8 * Math.cos((i * Math.PI) / 3),
  ]);
  result.push(
    prism(hex, -1.25, 1.25, (p) =>
      world(new Vector3(h + p.x, 4.2 + p.z, p.y)),
    ),
  );
  result.push(
    prism(hex, -1.25, 1.25, (p) =>
      world(new Vector3(4.2 - p.z, h + p.x, p.y)),
    ),
  );
  return result;
}
function overlap(a: Solid, b: Solid) {
  if (!a.box.intersectsBox(b.box)) return false;
  const axes = [
    ...a.normals,
    ...b.normals,
    ...a.edges.flatMap((x) =>
      b.edges.map((y) => new Vector3().crossVectors(x, y)),
    ),
  ];
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-10) continue;
    axis.normalize();
    const av = a.vertices.map((v) => v.dot(axis)),
      bv = b.vertices.map((v) => v.dot(axis));
    if (
      Math.min(Math.max(...av), Math.max(...bv)) -
        Math.max(Math.min(...av), Math.min(...bv)) <=
      0.01
    )
      return false;
  }
  return true;
}
export function bracketInterference(bracket: Bracket, parts: Part[]) {
  const a = bodies(bracket, parts);
  for (const other of parts) {
    if (other.id === bracket.id || other.kind === "nut") continue;
    const b = bodies(other, parts);
    if (a.some((x) => b.some((y) => overlap(x, y)))) return other;
  }
  return undefined;
}
export function railInterference(rail: Rail, parts: Part[]) {
  const a = bodies(rail, parts);
  return parts.find(
    (p) =>
      p.kind === "bracket" &&
      bodies(p, parts).some((b) => a.some((s) => overlap(s, b))),
  );
}
export function clearanceConflicts(parts: Part[]) {
  const entries = parts
    .filter((p): p is Rail | Bracket => p.kind !== "nut")
    .map((p) => ({ p, b: bodies(p, parts) }));
  const result: { key: string; message: string; ids: string[] }[] = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i],
        b = entries[j];
      if (a.p.kind !== "bracket" && b.p.kind !== "bracket") continue;
      if (a.b.some((x) => b.b.some((y) => overlap(x, y))))
        result.push({
          key: [a.p.id, b.p.id].sort().join(":"),
          ids: [a.p.id, b.p.id],
          message: `${a.p.label} / ${b.p.label}: hardware overlaps`,
        });
    }
  return result;
}
export function newClearanceError(before: Part[], after: Part[]) {
  const old = new Set(clearanceConflicts(before).map((c) => c.key));
  return clearanceConflicts(after).find((c) => !old.has(c.key))?.message;
}
