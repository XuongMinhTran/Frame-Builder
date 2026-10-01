import { test } from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { buildPlan, mountingPoints } from "../src/assembly.ts";
import {
  bill,
  emptyProject,
  exampleProject,
  newRail,
  parseProject,
} from "../src/model.ts";
import {
  importMesh,
  newReference,
  referenceBounds,
  referenceGeometry,
  validateReferences,
} from "../src/references.ts";

function cubeSTL(binary: boolean) {
  const geometry = new BoxGeometry(20, 40, 60),
    material = new MeshBasicMaterial(),
    mesh = new Mesh(geometry, material);
  mesh.position.set(100, 200, 300);
  mesh.updateMatrixWorld(true);
  const result = binary
    ? new STLExporter().parse(mesh, { binary: true }).buffer
    : new TextEncoder().encode(new STLExporter().parse(mesh)).buffer;
  geometry.dispose();
  material.dispose();
  return result as ArrayBuffer;
}

test("Assembly preloads all slot nuts before positioning and closing frame ends", () => {
  const p = exampleProject(),
    steps = buildPlan(p);
  const nuts = mountingPoints(p).reduce((n, m) => n + m.count, 0);
  assert.equal(
    nuts,
    bill(p)
      .filter((r) => r.item === "T-nut")
      .reduce((n, r) => n + r.qty, 0),
  );
  const firstPosition = steps.findIndex((s) => s.phase === "Position");
  assert.ok(firstPosition > 1);
  for (const step of steps.filter((s) => s.phase === "Preload")) {
    const id = step.mounts![0].railId;
    assert.ok(
      steps.indexOf(step) <
        steps.findIndex(
          (s) => s.phase === "Position" && s.motion?.partIds.includes(id),
        ),
    );
  }
  for (const step of steps.filter((s) => s.phase === "Connect")) {
    const bracket = p.parts.find((b) => b.id === step.mounts?.[0]?.partId)!;
    assert.equal(bracket.kind, "bracket");
    if (bracket.kind === "bracket") {
      const mount = step.mounts![0];
      assert.ok(step.installed.includes(mount.railId));
      assert.ok(step.bench.workIds.includes(mount.railId));
      assert.ok(
        steps.findIndex(
          (s) =>
            s.phase === "Position" && s.motion?.partIds.includes(mount.railId),
        ) < steps.indexOf(step),
      );
    }
  }
  assert.equal(
    steps.filter((s) => s.phase === "Connect").length,
    mountingPoints(p).filter((m) =>
      p.parts.some((part) => part.id === m.partId && part.kind === "bracket"),
    ).length,
  );
  assert.deepEqual(
    steps.slice(-2).map((s) => s.phase),
    ["Check", "Tighten"],
  );
  assert.equal(new Set(steps.at(-1)!.installed).size, p.parts.length);
});

test("Independent nuts, hidden rails and multiple fasteners are included in assembly preparation", () => {
  const p = exampleProject();
  p.fastenersPerSide = 3;
  const r = p.parts.find((r) => r.kind === "rail")!;
  r.hidden = true;
  if (r.kind !== "rail") throw Error();
  p.parts.push({
    id: "nut",
    label: "T99",
    kind: "nut",
    rail: r.id,
    face: "y",
    sign: 1,
    offset: 0,
  });
  const points = mountingPoints(p),
    steps = buildPlan(p);
  assert.equal(
    points.reduce((n, m) => n + m.count, 0),
    97,
  );
  assert.equal(points.find((m) => m.forLabel === "T99")!.offset, r.length / 2);
  assert.ok(
    steps.find((s) => s.id === `preload-${r.id}`)?.active.includes("nut"),
  );
  assert.ok(
    steps.find(
      (s) => s.phase === "Position" && s.motion?.partIds.includes(r.id),
    ),
  );
  assert.ok(steps.at(-1)!.installed.includes("nut"));
});

test("Assembly handles disconnected components and an empty frame without inventing joints", () => {
  const p = emptyProject();
  assert.deepEqual(buildPlan(p), []);
  p.parts.push(
    newRail([], 200, "x", [0, 10, 0]),
    newRail([], 300, "y", [500, 150, 0]),
  );
  const steps = buildPlan(p);
  assert.equal(steps.filter((s) => s.phase === "Position").length, 2);
  assert.equal(steps.filter((s) => s.phase === "Connect").length, 0);
  assert.match(steps[0].check, /2 model issues/);
});

test("Binary and ASCII STL preserve dimensions, center the reference, and respect source units", () => {
  for (const binary of [false, true]) {
    const r = importMesh(cubeSTL(binary), "test.stl");
    assert.deepEqual(r.size, [20, 40, 60]);
    assert.deepEqual(r.p, [0, 20, 0]);
    assert.equal(r.vertices!.length, 108);
    const geometry = referenceGeometry(r);
    geometry.computeBoundingBox();
    assert.deepEqual(
      geometry.boundingBox!.getSize(new Vector3()).toArray(),
      [20, 40, 60],
    );
    geometry.dispose();
    validateReferences([r]);
  }
  assert.deepEqual(
    importMesh(cubeSTL(true), "inches.stl", 25.4).size,
    [508, 1016, 1524],
  );
});

test("OBJ polygons are triangulated and malformed model files are rejected", () => {
  const data = new TextEncoder().encode(
    "v 0 0 0\nv 10 0 0\nv 10 20 0\nv 0 20 0\nf 1 2 3 4\n",
  ).buffer;
  const r = importMesh(data, "panel.obj");
  assert.equal(r.vertices!.length, 18);
  assert.deepEqual(r.size, [10, 20, 0.01]);
  for (const data of [
    new ArrayBuffer(2),
    new Uint8Array(84).fill(255).buffer,
    new TextEncoder().encode("solid empty\nendsolid empty").buffer,
  ])
    assert.throws(() => importMesh(data, "bad.stl"));
  assert.throws(() => importMesh(data, "not-supported.glb"));
});

test("Shapes, imported meshes and rulers round-trip without changing the hardware bill", () => {
  const p = exampleProject(),
    before = bill(p);
  p.references = [
    newReference("box"),
    newReference("sphere"),
    newReference("cylinder"),
    newReference("ruler"),
    importMesh(cubeSTL(true), "box.stl"),
  ];
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  assert.deepEqual(bill(p), before);
  const steps = buildPlan(p);
  assert.ok(
    steps.every((s) =>
      s.active.every((id) => p.parts.some((part) => part.id === id)),
    ),
  );
});

test("Project validation rejects invalid transforms, malformed meshes, duplicated IDs and excessive mesh data", () => {
  const p = emptyProject();
  for (const change of [
    { p: [0, Infinity, 0] },
    { size: [0, 1, 1] },
    { rotation: [0, 0] },
    { opacity: 2 },
    { color: "red" },
    { kind: "unknown" },
  ]) {
    p.references = [{ ...newReference("box"), ...change } as any];
    assert.throws(() => parseProject(JSON.stringify(p)));
  }
  const ref = newReference("box");
  assert.throws(() => validateReferences([ref, ref]));
  assert.throws(() =>
    validateReferences([{ ...newReference("mesh"), vertices: [0, 0, 0] }]),
  );
  assert.throws(() =>
    validateReferences([
      { ...newReference("mesh"), vertices: Array(900009).fill(0) },
    ]),
  );
});

test("Ruler length extends from its zero point and rotations preserve its endpoints", () => {
  const r = newReference("ruler", [10, 20, 30]);
  r.size[0] = 450;
  assert.equal(referenceBounds(r).min.x, 10);
  assert.equal(referenceBounds(r).max.x, 460);
  r.rotation = [0, 0, 90];
  const b = referenceBounds(r);
  assert.ok(Math.abs(b.min.y - 20) < 1e-8);
  assert.ok(Math.abs(b.max.y - 470) < 1e-8);
});
