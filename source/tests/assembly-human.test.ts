import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Vector3 } from "three";
import { buildPlan, describeRail, mountingPoints } from "../src/assembly.ts";
import {
  ai,
  emptyProject,
  exampleProject,
  newRail,
  rail,
} from "../src/model.ts";
import type { Vec } from "../src/model.ts";

const rotate = (v: Vec, rotation: Vec) =>
  new Vector3(...v).applyEuler(
    new Euler(...(rotation.map((n) => (n * Math.PI) / 180) as Vec), "XYZ"),
  );

test("Each loading face lies flat, faces upward, loads deepest first and precedes installing its rail", () => {
  const project = exampleProject(),
    steps = buildPlan(project);
  for (const step of steps.filter((s) => s.phase === "Preload")) {
    const mounts = step.mounts!,
      host = rail(project.parts, mounts[0].railId)!;
    const axis: Vec = [0, 0, 0];
    axis[ai(host.axis)] = 1;
    assert.ok(Math.abs(rotate(axis, step.bench.rotation).y) < 1e-6);
    assert.deepEqual(
      step.bench.workIds.filter((id) => rail(project.parts, id)),
      [host.id],
    );
    assert.equal(new Set(mounts.map((m) => m.face)).size, 1);
    for (const [i, mount] of mounts.entries()) {
      assert.ok(rotate(mount.normal, step.bench.rotation).y > 0.999);
      if (i) assert.ok(mounts[i - 1].offset >= mount.offset);
      assert.ok(
        mount.p[ai(host.axis)] + mount.insertion![ai(host.axis)] <
          host.p[ai(host.axis)] - host.length / 2,
      );
    }
    assert.ok(
      steps.indexOf(step) <
        steps.findIndex(
          (s) => s.phase === "Position" && s.motion?.partIds.includes(host.id),
        ),
    );
  }
});

test("A whole level is laid out before loading nuts and finishes before the next level begins", () => {
  const project = exampleProject(),
    steps = buildPlan(project);
  const layouts = steps.filter((s) => s.id.startsWith("layout-floor-"));
  assert.equal(layouts.length, 2);
  for (const [i, layout] of layouts.entries()) {
    const ids = layout.bench.workIds;
    assert.equal(ids.length, 4);
    const start = steps.indexOf(layout),
      end =
        i + 1 < layouts.length ? steps.indexOf(layouts[i + 1]) : steps.length;
    for (const id of ids) {
      assert.ok(
        steps.findIndex(
          (s) =>
            s.phase === "Preload" && s.mounts?.some((m) => m.railId === id),
        ) > start,
      );
      assert.ok(
        steps.findIndex(
          (s) => s.phase === "Position" && s.motion?.partIds.includes(id),
        ) < end,
      );
    }
    const internal = project.parts.filter(
      (p) => p.kind === "bracket" && ids.includes(p.a) && ids.includes(p.b),
    );
    for (const bracket of internal) {
      const screws = steps.filter(
        (s) =>
          s.phase === "Connect" &&
          s.mounts?.some((m) => m.partId === bracket.id),
      );
      assert.equal(screws.length, 2);
      assert.ok(
        screws.every((s) => steps.indexOf(s) > start && steps.indexOf(s) < end),
      );
    }
  }
  const upperJoin = steps.find((s) => s.id.startsWith("join-level-"))!;
  assert.ok(
    upperJoin.motion!.partIds.length > 4,
    "A finished level moves with its brackets",
  );
  assert.ok(
    steps.findIndex((s) => s.id === "level-check-0-1") <
      steps.indexOf(upperJoin),
  );
});

test("Levels are assembled alone and flat on the table, including upper-level corner screws", () => {
  const project = exampleProject(),
    steps = buildPlan(project);
  for (const layout of steps.filter((s) => s.id.startsWith("layout-floor-"))) {
    const ids = layout.bench.workIds;
    const corners = project.parts
      .filter(
        (p) => p.kind === "bracket" && ids.includes(p.a) && ids.includes(p.b),
      )
      .map((p) => p.id);
    for (const step of steps.filter(
      (s) => s.phase === "Connect" && corners.includes(s.mounts![0].partId),
    )) {
      assert.deepEqual(step.bench.rotation, [0, 0, 0]);
      assert.ok(
        step.bench.workIds
          .filter((id) => rail(project.parts, id))
          .every((id) => ids.includes(id)),
      );
    }
  }
});

test("Uprights are attached one at a time after the bottom level, without turning the base on edge", () => {
  const project = exampleProject(),
    steps = buildPlan(project);
  const positions = steps.filter(
    (s) =>
      s.phase === "Position" &&
      s.motion?.partIds.some((id) => rail(project.parts, id)?.axis === "y"),
  );
  assert.equal(positions.length, 4);
  assert.ok(
    steps.findIndex((s) => s.id === "level-check-0-0") <
      steps.indexOf(positions[0]),
  );
  for (const [i, step] of positions.entries()) {
    const id = step.motion!.partIds[0];
    assert.deepEqual(step.bench.rotation, [0, 0, 0]);
    const next =
      i + 1 < positions.length
        ? steps.indexOf(positions[i + 1])
        : steps.findIndex((s) => s.id === "layout-floor-0-1");
    const screws = steps
      .slice(steps.indexOf(step) + 1, next)
      .filter(
        (s) => s.phase === "Connect" && s.mounts?.some((m) => m.railId === id),
      );
    assert.ok(screws.length > 0);
    const bracket = project.parts.find(
      (p) => p.id === screws[0].mounts![0].partId,
    )!;
    if (bracket.kind !== "bracket") throw Error();
    assert.ok(screws.at(-1)!.fastened.includes(`${bracket.id}:${bracket.a}`));
    assert.ok(screws.at(-1)!.fastened.includes(`${bracket.id}:${bracket.b}`));
  }
});

test("Pre-fitted brackets fasten only their present rail; every screw appears once and remains completed", () => {
  const project = exampleProject(),
    steps = buildPlan(project),
    expected = new Set<string>();
  for (const step of steps) {
    if (step.motion?.kind === "screws") {
      const mount = step.mounts![0],
        key = `${mount.partId}:${mount.railId}`;
      assert.ok(!expected.has(key));
      expected.add(key);
      assert.ok(step.bench.workIds.includes(mount.railId));
      assert.ok(step.installed.includes(mount.railId));
      assert.ok(rotate(mount.normal, step.bench.rotation).y >= -0.05);
      if (step.title.startsWith("Pre-fit"))
        assert.match(step.text, /other leg/);
    }
    assert.deepEqual(new Set(step.fastened), expected);
  }
  assert.equal(expected.size, mountingPoints(project).length);
  assert.equal(steps.at(-1)!.installed.length, project.parts.length);
});

test("Instructions use lengths and positions without equipment or physical part labels", () => {
  const project = exampleProject();
  project.parts.forEach((p, i) => (p.label = `UNAVAILABLE_LABEL_${i}`));
  const steps = buildPlan(project);
  const visible = steps
    .map((s) =>
      [
        s.title,
        s.text,
        s.check,
        s.bench.label,
        s.support.resting,
        s.support.hold,
        s.support.secure,
        ...(s.mounts?.map((m) => m.forLabel) ?? []),
      ].join(" "),
    )
    .join("\n");
  assert.doesNotMatch(
    visible,
    /clamp|padded|support block|backing board|UNAVAILABLE_LABEL|mark the|attach a label/i,
  );
  assert.match(visible, /600 mm back rail/);
  assert.match(visible, /400 mm front left upright/);
  assert.match(visible, /one level at a time/);
  assert.equal(
    describeRail(
      project,
      project.parts.find((p) => p.kind === "rail" && p.axis === "x")!.id,
    ),
    "600 mm back rail",
  );
});

test("Disconnected pieces get separate table layouts, and an unjoined upright stays flat", () => {
  const project = emptyProject(),
    first = newRail([], 200, "x", [0, 10, 0]),
    second = newRail([first], 300, "y", [500, 150, 0]);
  project.parts.push(first, second);
  const steps = buildPlan(project),
    positions = steps.filter((s) => s.phase === "Position");
  assert.equal(positions.length, 2);
  assert.deepEqual(positions[1].bench.workIds, [second.id]);
  assert.ok(Math.abs(rotate([0, 1, 0], positions[1].bench.rotation).y) < 1e-6);
  assert.ok(steps.some((s) => s.id === "set-aside-0"));
  assert.equal(steps.filter((s) => s.phase === "Connect").length, 0);
});

test("Planning changes presentation only and identifies every step uniquely", () => {
  const project = exampleProject(),
    saved = JSON.stringify(project),
    steps = buildPlan(project);
  assert.equal(JSON.stringify(project), saved);
  assert.equal(new Set(steps.map((s) => s.id)).size, steps.length);
  assert.deepEqual(
    steps.slice(-2).map((s) => s.phase),
    ["Check", "Tighten"],
  );
});

test("An open upper level is carried and attached one connected section at a time", () => {
  const project = exampleProject();
  const horizontal = project.parts.filter(
    (p) => p.kind === "rail" && p.axis !== "y",
  );
  const top = Math.max(
    ...horizontal.map((p) => (p.kind === "rail" ? p.p[1] : 0)),
  );
  const removed = new Set(
    horizontal
      .filter((p) => p.kind === "rail" && p.p[1] === top && p.axis === "z")
      .map((p) => p.id),
  );
  project.parts = project.parts.filter(
    (p) =>
      !removed.has(p.id) &&
      !(p.kind === "bracket" && (removed.has(p.a) || removed.has(p.b))),
  );
  const steps = buildPlan(project),
    joins = steps.filter((s) => s.id.startsWith("join-level-"));
  assert.equal(joins.length, 2);
  for (const [i, join] of joins.entries()) {
    const movingRails = join.motion!.partIds.filter((id) =>
      rail(project.parts, id),
    );
    assert.equal(movingRails.length, 1);
    if (i === 0) {
      const next = steps.indexOf(joins[1]);
      assert.ok(
        steps
          .slice(steps.indexOf(join) + 1, next)
          .some((s) => s.phase === "Connect"),
      );
    }
  }
  assert.equal(new Set(steps.at(-1)!.installed).size, project.parts.length);
});
