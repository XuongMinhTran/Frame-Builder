import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Quaternion, Vector3 } from "three";
import { buildPlan } from "../src/assembly.ts";
import {
  insertionAt,
  motionDuration,
  rotationQuaternion,
  tablePose,
  turnBounds,
} from "../src/guideMotion.ts";
import { emptyProject, newRail } from "../src/model.ts";
import type { Vec } from "../src/model.ts";

const near = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );

test("Screws approach without spinning, then turn only after the tip reaches the nut", () => {
  const start = 0.45,
    duration = 2.4;
  const early = insertionAt(start + duration * 0.25, 0, "screws");
  assert.ok(early.visible && early.progress > 0 && !early.seated);
  assert.equal(early.turns, 0);

  let sawTurning = false,
    previousProgress = 0,
    previousTurns = 0;
  for (let sample = 0; sample <= 240; sample++) {
    const state = insertionAt(start + (duration * sample) / 240, 0, "screws");
    assert.ok(state.progress >= previousProgress);
    assert.ok(state.turns >= previousTurns);
    if (state.turns > 0) {
      sawTurning = true;
      // BenchScene starts 42 mm out. Its 7 mm shank, centered at +2.4 mm,
      // has its tip at −1.1 mm; the 3.8 mm nut's threaded face is +1.9 mm.
      const screwTip = 42 * (1 - state.progress) - 1.1;
      assert.ok(
        screwTip <= 1.9 + 1e-8,
        `Screw began turning with its tip ${screwTip.toFixed(2)} mm above the nut center`,
      );
    }
    previousProgress = state.progress;
    previousTurns = state.turns;
  }
  assert.ok(sawTurning);
});

test("Hardware stays out of view until its turn, and each prior insertion is seated first", () => {
  for (const kind of ["nuts", "screws"] as const) {
    const spacing = kind === "nuts" ? 2.5 : 2.8;
    assert.equal(insertionAt(-10, 0, kind).visible, false);
    assert.equal(insertionAt(0, 0, kind).progress, 0);
    for (let index = 0; index < 4; index++) {
      const startsAt = 0.45 + index * spacing;
      assert.equal(insertionAt(startsAt - 0.001, index, kind).visible, false);
      const started = insertionAt(startsAt + 0.001, index, kind);
      assert.equal(started.visible, true);
      assert.equal(started.seated, false);
      assert.equal(started.turns, 0);
      if (index) {
        const previous = insertionAt(startsAt, index - 1, kind);
        assert.equal(previous.visible, true);
        assert.equal(previous.seated, true);
        assert.equal(previous.progress, 1);
      }
    }
  }
});

test("The preload animation fills a slot deepest first without later nuts passing seated nuts", () => {
  const project = emptyProject(),
    host = newRail([], 400, "x", [170, 210, -75]);
  project.parts.push(host);
  for (const [index, offset] of [0, -120, 120].entries())
    project.parts.push({
      id: `nut-${index}`,
      kind: "nut",
      label: `T-nut ${index + 1}`,
      rail: host.id,
      face: "y",
      sign: 1,
      offset,
    });
  const step = buildPlan(project).find((s) => s.phase === "Preload")!;
  assert.ok(step);
  const mounts = step.mounts!;
  assert.equal(mounts.length, 3);
  const duration = motionDuration("nuts", mounts.length);
  for (let seconds = 0; seconds <= duration + 0.02; seconds += 0.02) {
    const visible = mounts.flatMap((mount, index) => {
      const state = insertionAt(seconds, index, "nuts");
      if (!state.visible) return [];
      assert.equal(state.turns, 0);
      const x = mount.p[0] + mount.insertion![0] * (1 - state.progress);
      return [{ x, state }];
    });
    for (let i = 1; i < visible.length; i++) {
      assert.equal(visible[i - 1].state.seated, true);
      // The modeled nuts are 12 mm long along the rail.
      assert.ok(visible[i - 1].x - visible[i].x >= 12);
    }
  }
  for (const [index, mount] of mounts.entries()) {
    const state = insertionAt(duration, index, "nuts");
    assert.equal(state.seated, true);
    near(mount.p[0] + mount.insertion![0] * (1 - state.progress), mount.p[0]);
  }
});

test("Motion completion leaves every nut and screw visible and fully seated without overshooting", () => {
  for (const kind of ["nuts", "screws"] as const) {
    for (const count of [1, 2, 12]) {
      const duration = motionDuration(kind, count);
      for (let index = 0; index < count; index++) {
        const seated = insertionAt(duration, index, kind),
          later = insertionAt(duration + 100, index, kind);
        assert.deepEqual(later, seated);
        assert.equal(seated.visible, true);
        assert.equal(seated.seated, true);
        assert.equal(seated.progress, 1);
        assert.equal(seated.turns, kind === "screws" ? 3 : 0);
      }
    }
  }
  assert.equal(motionDuration(undefined, 0), 0);
});

const corners = (box: Box3) =>
  [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) =>
      [box.min.z, box.max.z].map((z) => new Vector3(x, y, z)),
    ),
  );

test("Offset workpieces clear the table at every sampled angle through quarter and half turns", () => {
  const boxes = [
    new Box3(new Vector3(80, -70, 220), new Vector3(560, 220, 420)),
    new Box3(new Vector3(-930, 310, -120), new Vector3(-910, 610, 450)),
  ];
  const turns: [Vec, Vec][] = [
    [
      [0, 0, 0],
      [90, 0, 0],
    ],
    [
      [0, 0, 0],
      [180, 0, 0],
    ],
    [
      [0, 0, 0],
      [0, 90, 0],
    ],
    [
      [0, 0, 0],
      [0, 180, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 90],
    ],
    [
      [0, 0, 0],
      [0, 0, 180],
    ],
    [
      [90, 0, 0],
      [90, 180, 0],
    ],
    [
      [0, 90, 90],
      [180, 90, 90],
    ],
  ];
  for (const box of boxes)
    for (const [from, to] of turns) {
      const a = rotationQuaternion(from),
        b = rotationQuaternion(to);
      for (let sample = 0; sample <= 120; sample++) {
        const fraction = sample / 120,
          rotation = new Quaternion().slerpQuaternions(a, b, fraction),
          lift = Math.sin(Math.PI * fraction) * 90,
          position = tablePose(box, rotation, lift),
          placed = corners(box).map((corner) =>
            corner.applyQuaternion(rotation).add(position),
          );
        const bottom = Math.min(...placed.map((v) => v.y));
        assert.ok(bottom >= -1e-8, "Rotating workpiece entered the table");
        near(bottom, lift);
        const center = box
          .getCenter(new Vector3())
          .applyQuaternion(rotation)
          .add(position);
        near(center.x, 0);
        near(center.z, 0);
      }
    }
});

test("Final tabletop poses rest directly on the table and ignore a negative lift request", () => {
  const box = new Box3(new Vector3(125, -320, 85), new Vector3(525, -300, 105)),
    original = box.clone();
  for (const turn of [
    [0, 0, 0],
    [90, 0, 0],
    [0, 0, 180],
  ] as Vec[]) {
    const rotation = rotationQuaternion(turn),
      originalRotation = rotation.clone(),
      position = tablePose(box, rotation, -50),
      bottom = Math.min(
        ...corners(box).map(
          (corner) => corner.applyQuaternion(rotation).add(position).y,
        ),
      );
    near(bottom, 0);
    assert.deepEqual(box, original);
    assert.deepEqual(rotation, originalRotation);
  }
});

test("Camera bounds contain long workpieces throughout lifted quarter and half turns", () => {
  const box = new Box3(new Vector3(-1400, 35, 160), new Vector3(900, 55, 580));
  for (const target of [
    [0, 0, 90],
    [180, 0, 0],
    [90, 180, 90],
  ] as Vec[]) {
    const from = rotationQuaternion([0, 0, 0]),
      to = rotationQuaternion(target);
    const fit = turnBounds(box, from, to);
    for (let sample = 0; sample <= 1000; sample++) {
      const fraction = sample / 1000;
      const rotation = new Quaternion().slerpQuaternions(from, to, fraction);
      const lift =
        Math.sin(Math.PI * fraction) *
        Math.max(90, box.getSize(new Vector3()).length() * 0.17);
      const position = tablePose(box, rotation, lift);
      for (const corner of corners(box))
        assert.ok(
          fit.containsPoint(corner.applyQuaternion(rotation).add(position)),
        );
    }
  }
});

test("Ghost context fits around a turning tabletop section without changing its grounding", () => {
  const context = new Box3(
    new Vector3(-300, 0, -200),
    new Vector3(300, 600, 200),
  );
  const workpiece = new Box3(
    new Vector3(-300, 400, -200),
    new Vector3(300, 420, 200),
  );
  const from = rotationQuaternion([0, 0, 0]),
    to = rotationQuaternion([180, 0, 0]);
  const fit = turnBounds(context, from, to, workpiece);
  for (let i = 0; i <= 120; i++) {
    const t = i / 120,
      rotation = new Quaternion().slerpQuaternions(from, to, t);
    const lift =
      Math.sin(Math.PI * t) *
      Math.max(90, workpiece.getSize(new Vector3()).length() * 0.17);
    const position = tablePose(workpiece, rotation, lift);
    near(
      Math.min(
        ...corners(workpiece).map(
          (p) => p.applyQuaternion(rotation).add(position).y,
        ),
      ),
      lift,
    );
    for (const p of corners(context))
      assert.ok(fit.containsPoint(p.applyQuaternion(rotation).add(position)));
  }
});
