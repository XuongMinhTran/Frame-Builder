import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import {
  flightOffset,
  lookDirection,
  rotateCameraInPlace,
} from "../src/navigation.ts";

test("WASD follows the camera; Q/E uses world up", () => {
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const forward = flightOffset(q, new Set(["w"]), 100, 0.02);
  assert.ok(Math.abs(forward.x + 2) < 1e-9);
  assert.ok(Math.abs(forward.z) < 1e-9);
  assert.deepEqual(
    flightOffset(q, new Set(["e"]), 100, 0.02).toArray(),
    [0, 2, 0],
  );
  assert.ok(flightOffset(q, new Set(["w", "s"]), 100, 0.02).length() < 1e-9);
});
test("Diagonal flight has constant speed and Shift accelerates threefold", () => {
  const q = new Quaternion();
  assert.ok(
    Math.abs(flightOffset(q, new Set(["w", "d"]), 100, 0.02).length() - 2) <
      1e-9,
  );
  assert.equal(flightOffset(q, new Set(["w"]), 100, 0.02, true).length(), 6);
  assert.equal(flightOffset(q, new Set(["w"]), 100, 10).length(), 5);
});
test("Mouse look turns toward the pointer and clamps pitch without flipping", () => {
  const initial = new Vector3(0, 0, -1);
  assert.ok(lookDirection(initial, 100, 0).x > 0);
  assert.ok(lookDirection(initial, 0, -100).y > 0);
  const up = lookDirection(initial, 0, -100000);
  assert.ok(up.y < 1 && up.y > 0.99);
  assert.ok(Math.abs(up.length() - 1) < 1e-9);
});

test("Camera look keeps the camera position fixed regardless of the previous pivot", () => {
  for (const distance of [20, 1000, 1800]) {
    const camera = new PerspectiveCamera();
    camera.position.set(350, 400, 500);
    const position = camera.position.clone();
    const target = camera.position.clone().add(new Vector3(0, 0, -distance));
    camera.lookAt(target);
    const initial = camera.quaternion.clone();
    for (let i = 0; i < 40; i++) rotateCameraInPlace(camera, target, 3, -1);
    assert.deepEqual(camera.position.toArray(), position.toArray());
    assert.ok(camera.quaternion.angleTo(initial) > 0.1);
    assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-8);
    const toward = target.clone().sub(camera.position).normalize();
    assert.ok(
      camera.getWorldDirection(new Vector3()).distanceTo(toward) < 1e-8,
    );
  }
});
