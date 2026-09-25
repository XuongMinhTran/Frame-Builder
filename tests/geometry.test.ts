import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ShapeUtils,
  Vector2,
  Vector3,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  type BufferGeometry,
} from "three";
import {
  createBracketGeometry,
  createRailGeometry,
  railProfile,
} from "../src/geometry.ts";

function side(a: Vector2, b: Vector2, p: Vector2) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

test("The four rail slots form a simple contour without intersecting walls", () => {
  const points = railProfile().extractPoints(12).shape;
  if (points[0].equals(points.at(-1)!)) points.pop();
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      assert.ok(
        !(
          side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
        ),
        `walls ${i} and ${j} intersect`,
      );
    }
  }
});

function capAreas(geometry: BufferGeometry) {
  const p = geometry.getAttribute("position");
  const areas = new Map<number, number>();
  for (let i = 0; i < p.count; i += 3) {
    const z = p.getZ(i);
    if (p.getZ(i + 1) !== z || p.getZ(i + 2) !== z) continue;
    const area =
      Math.abs(
        (p.getX(i + 1) - p.getX(i)) * (p.getY(i + 2) - p.getY(i)) -
          (p.getY(i + 1) - p.getY(i)) * (p.getX(i + 2) - p.getX(i)),
      ) / 2;
    areas.set(z, (areas.get(z) ?? 0) + area);
  }
  return [...areas.values()];
}

test("Rail caps cover the metal profile exactly and preserve 20 mm dimensions", () => {
  const profile = railProfile().extractPoints(12);
  const expected =
    Math.abs(ShapeUtils.area(profile.shape)) -
    Math.abs(ShapeUtils.area(profile.holes[0]));
  for (const length of [20, 360, 2000]) {
    const geometry = createRailGeometry(length);
    const caps = capAreas(geometry);
    assert.equal(caps.length, 2);
    for (const area of caps)
      assert.ok(Math.abs(area - expected) < 0.001, `${area} != ${expected}`);
    geometry.computeBoundingBox();
    assert.deepEqual(geometry.boundingBox!.getSize(new Vector3()).toArray(), [
      20,
      20,
      length,
    ]);
    geometry.dispose();
  }
});

test("Bracket legs share one body without duplicated corner faces", () => {
  const geometry = createBracketGeometry();
  const caps = capAreas(geometry);
  assert.equal(caps.length, 2);
  for (const area of caps)
    assert.ok(Math.abs(area - (2 * 30 * 2.8 - 2.8 * 2.8)) < 0.001);
  geometry.dispose();
});

test("All four diagonal webs have continuous metal across a 1.8 mm strip", () => {
  const geometry = createRailGeometry(100),
    material = new MeshBasicMaterial(),
    mesh = new Mesh(geometry, material);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const offset of [-0.9, 0, 0.9]) {
        const point = new Vector3(
          sx * (5 + offset / Math.SQRT2),
          sy * (5 - offset / Math.SQRT2),
          60,
        );
        const hits = new Raycaster(
          point,
          new Vector3(0, 0, -1),
        ).intersectObject(mesh);
        assert.ok(hits.length > 0, `Missing web at ${point.toArray()}`);
        assert.ok(Math.abs(hits[0].point.z - 50) < 0.001);
      }
  geometry.dispose();
  material.dispose();
});
