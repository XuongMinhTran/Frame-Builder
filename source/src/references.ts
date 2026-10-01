import * as T from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import type { Vec } from "./model.ts";

/** Fit-check objects are deliberately separate from structural frame parts. */
export type ReferenceObject = {
  id: string;
  name: string;
  kind: "box" | "cylinder" | "sphere" | "mesh" | "ruler";
  p: Vec;
  size: Vec;
  rotation: Vec;
  color: string;
  opacity: number;
  hidden: boolean;
  /** Centered vertices normalized to a unit bounding box. */
  vertices?: number[];
};
export const MAX_VERTICES = 900_000;
export const MAX_PROJECT_BYTES = 25_000_000;

export function validateReferences(
  value: unknown,
): asserts value is ReferenceObject[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Too many fit-check objects (maximum 100).");
  const ids = new Set<string>();
  let components = 0;
  const vec = (v: unknown, positive = false) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every(
      (n) =>
        typeof n === "number" &&
        Number.isFinite(n) &&
        Math.abs(n) <= 100000 &&
        (!positive || n >= 0.01),
    );
  for (const r of value) {
    if (
      !r ||
      typeof r.id !== "string" ||
      r.id.length > 100 ||
      ids.has(r.id) ||
      typeof r.name !== "string" ||
      r.name.length > 80 ||
      !["box", "cylinder", "sphere", "mesh", "ruler"].includes(r.kind) ||
      !vec(r.p) ||
      !vec(r.size, true) ||
      !vec(r.rotation) ||
      typeof r.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(r.color) ||
      typeof r.opacity !== "number" ||
      !Number.isFinite(r.opacity) ||
      r.opacity < 0.1 ||
      r.opacity > 1 ||
      typeof r.hidden !== "boolean"
    )
      throw new Error("Invalid fit-check object.");
    ids.add(r.id);
    if (r.kind === "mesh") {
      if (
        !Array.isArray(r.vertices) ||
        !r.vertices.length ||
        r.vertices.length % 9 ||
        r.vertices.length > MAX_VERTICES ||
        !r.vertices.every(
          (n: unknown) =>
            typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 0.501,
        )
      )
        throw new Error("Invalid imported mesh.");
      components += r.vertices.length;
    } else if (r.vertices !== undefined)
      throw new Error("Unexpected mesh data.");
  }
  if (components > MAX_VERTICES)
    throw new Error(
      "Imported models exceed 100,000 triangles in total. Use a simpler mesh.",
    );
}

export function referenceGeometry(r: ReferenceObject) {
  let g: T.BufferGeometry;
  if (r.kind === "mesh") {
    g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(r.vertices!, 3));
    g.computeVertexNormals();
  } else if (r.kind === "sphere") g = new T.SphereGeometry(0.5, 32, 20);
  else if (r.kind === "cylinder") g = new T.CylinderGeometry(0.5, 0.5, 1, 40);
  else g = new T.BoxGeometry(1, 1, 1);
  g.scale(...r.size);
  if (r.kind === "ruler") g.translate(r.size[0] / 2, 0, 0);
  return g;
}
export function referenceMatrix(r: ReferenceObject) {
  return new T.Matrix4().compose(
    new T.Vector3(...r.p),
    new T.Quaternion().setFromEuler(
      new T.Euler(...(r.rotation.map(T.MathUtils.degToRad) as Vec)),
    ),
    new T.Vector3(1, 1, 1),
  );
}
export function referenceBounds(r: ReferenceObject) {
  const min =
    r.kind === "ruler"
      ? new T.Vector3(0, -r.size[1] / 2, -r.size[2] / 2)
      : new T.Vector3(...r.size).multiplyScalar(-0.5);
  const max =
    r.kind === "ruler"
      ? new T.Vector3(r.size[0], r.size[1] / 2, r.size[2] / 2)
      : new T.Vector3(...r.size).multiplyScalar(0.5);
  return new T.Box3(min, max).applyMatrix4(referenceMatrix(r));
}
export function newReference(
  kind: ReferenceObject["kind"],
  p: Vec = [0, 50, 0],
): ReferenceObject {
  return {
    id: crypto.randomUUID(),
    name: {
      box: "Box",
      cylinder: "Cylinder",
      sphere: "Sphere",
      mesh: "Imported model",
      ruler: "Ruler",
    }[kind],
    kind,
    p,
    size: kind === "ruler" ? [300, 3, 24] : [100, 100, 100],
    rotation: [0, 0, 0],
    color: kind === "ruler" ? "#e7be69" : "#6dcbbb",
    opacity: kind === "ruler" ? 1 : 0.55,
    hidden: false,
  };
}

export function importMesh(
  data: ArrayBuffer,
  name: string,
  units = 1,
): ReferenceObject {
  if (data.byteLength > 10_000_000)
    throw new Error("Model exceeds 10 MB. Export a simpler STL or OBJ.");
  let vertices: number[] = [];
  const collect = (g: T.BufferGeometry, matrix = new T.Matrix4()) => {
    const pos = g.getAttribute("position"),
      index = g.getIndex();
    const count = index?.count ?? pos?.count ?? 0;
    if (!count || count % 3 || vertices.length + count * 3 > MAX_VERTICES)
      throw new Error("Use a model with at most 100,000 triangles.");
    const v = new T.Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(
        matrix,
      );
      vertices.push(v.x, v.y, v.z);
    }
  };
  if (/\.stl$/i.test(name)) {
    const faces =
      data.byteLength >= 84 ? new DataView(data).getUint32(80, true) : 0;
    const binary = data.byteLength >= 84 && 84 + faces * 50 === data.byteLength;
    if (binary && faces > MAX_VERTICES / 9)
      throw new Error("Use an STL with at most 100,000 triangles.");
    if (!binary) {
      const source = new TextDecoder().decode(data);
      if (
        !/^\s*solid\b/i.test(source) ||
        !/endsolid\b/i.test(source) ||
        (source.match(/\bfacet\s+normal\b/gi)?.length ?? 0) > MAX_VERTICES / 9
      )
        throw new Error(
          "Invalid or oversized STL. Export a valid binary or ASCII STL.",
        );
    }
    const g = new STLLoader().parse(data);
    try {
      collect(g);
    } finally {
      g.dispose();
    }
  } else if (/\.obj$/i.test(name)) {
    const root = new OBJLoader().parse(new TextDecoder().decode(data));
    root.updateMatrixWorld(true);
    try {
      root.traverse((o) => {
        if (o instanceof T.Mesh) collect(o.geometry, o.matrixWorld);
      });
    } finally {
      root.traverse((o) => {
        if (
          o instanceof T.Mesh ||
          o instanceof T.Line ||
          o instanceof T.Points
        ) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            m.dispose(),
          );
        }
      });
    }
  } else throw new Error("Choose an STL or OBJ model.");
  if (!vertices.length || vertices.some((n) => !Number.isFinite(n)))
    throw new Error("Model has no valid triangles.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((v, i) => {
    min[i % 3] = Math.min(min[i % 3], v);
    max[i % 3] = Math.max(max[i % 3], v);
  });
  const size = max.map((v, i) => Math.max(0.01, (v - min[i]) * units)) as Vec;
  if (!size.every((n) => Number.isFinite(n) && n <= 100000))
    throw new Error("Model dimensions exceed 100,000 mm. Check import units.");
  vertices = vertices.map(
    (v, i) => ((v - (max[i % 3] + min[i % 3]) / 2) * units) / size[i % 3],
  );
  return {
    ...newReference("mesh", [0, size[1] / 2, 0]),
    name: name.slice(0, 80),
    size,
    vertices,
  };
}
