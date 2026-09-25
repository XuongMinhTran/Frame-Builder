import { test } from "node:test";
import assert from "node:assert/strict";
import { Ray, Vector3 } from "three";
import {
  attachments,
  nearbyAttachments,
  pickRail,
  overlaps,
} from "../src/attachment.ts";
import { bracketInterference, clearanceConflicts } from "../src/clearance.ts";
import { moveParts, bracketCandidates, issues } from "../src/model.ts";
import type { Rail, Bracket, Project, Axis, Vec } from "../src/model.ts";
const beam = (id: string, axis: Axis, length: number, p: Vec): Rail => ({
  id,
  label: id,
  kind: "rail",
  axis,
  length,
  p,
});

test("Box targeting closes grooves and the end bore on all six faces", () => {
  for (const axis of ["x", "y", "z"] as Axis[]) {
    const r = beam("r", axis, 100, [0, 0, 0]);
    for (let i = 0; i < 3; i++)
      for (const sign of [-1, 1]) {
        const origin = new Vector3().setComponent(i, sign * 200),
          direction = new Vector3().setComponent(i, -sign);
        const hit = pickRail(new Ray(origin, direction), r)!;
        assert.equal(
          hit.point.getComponent(i),
          sign * ("xyz".indexOf(axis) === i ? 50 : 10),
        );
        assert.equal(hit.normal.getComponent(i), sign);
      }
  }
});
test("A rail grabbed by its side can snap its end without cursor-on-host targeting", () => {
  const moving = beam("m", "x", 100, [180, 40, 0]),
    host = beam("h", "y", 400, [0, 0, 0]);
  const found = nearbyAttachments(moving, [70, 43, 3], [moving, host], 10)!;
  assert.deepEqual(found.best.p, [60, 40, 0]);
  assert.equal(found.best.label, "End → side");
  assert.equal(overlaps({ ...moving, p: found.best.p }, host), false);
  assert.ok(
    found.choices.some(
      (c) => c.axis === "x" && c.sign === -1 && c.p[0] === -60,
    ),
  );
});
test("Parallel side contacts and end contacts are available without rotating parts", () => {
  const moving = beam("m", "y", 100, [30, 40, 0]),
    host = beam("h", "y", 400, [0, 0, 0]);
  assert.equal(
    nearbyAttachments(moving, [25, 43, 0], [moving, host], 10)!.best.label,
    "Side → side",
  );
  const choices = attachments(moving, host, [0, 260, 0], 10, [moving, host]);
  assert.deepEqual(choices[0].p, [0, 250, 0]);
  assert.equal(choices[0].label, "End → end");
});
test("Snaps retain a connection through small movements and release on pull-away", () => {
  const m = beam("m", "x", 100, [120, 40, 0]),
    h = beam("h", "y", 400, [0, 0, 0]),
    parts = [m, h];
  const first = nearbyAttachments(m, [80, 40, 0], parts, 10)!;
  assert.ok(
    nearbyAttachments(m, [90, 40, 0], parts, 10, undefined, first.best.key),
  );
  assert.equal(
    nearbyAttachments(m, [100, 40, 0], parts, 10, undefined, first.best.key),
    null,
  );
});
test("Axis constraints and occupied destinations exclude invalid alternatives", () => {
  const m = beam("m", "x", 100, [120, 40, 0]),
    h = beam("h", "y", 400, [0, 0, 0]);
  const obstacle = beam("block", "x", 100, [60, 40, 0]);
  assert.ok(
    attachments(m, h, [65, 40, 0], 10, [m, h], "x").every(
      (c) => c.p[1] === 40 && c.p[2] === 0,
    ),
  );
  assert.ok(
    !attachments(m, h, [65, 40, 0], 10, [m, h, obstacle]).some(
      (c) => c.axis === "x" && c.sign === 1,
    ),
  );
  assert.equal(
    nearbyAttachments(m, [65, 40, 0], [m, { ...h, hidden: true }], 10),
    null,
  );
});

function frame(): Project {
  const host = beam("host", "x", 400, [0, 0, 0]),
    a = beam("a", "z", 100, [-30, 0, 60]),
    b = beam("b", "z", 100, [90, 0, 60]);
  const left: Bracket = {
    kind: "bracket",
    id: "left",
    label: "left",
    a: "host",
    face: "z",
    sign: 1,
    sa: 1,
    offset: -20,
    b: "a",
  };
  const right: Bracket = {
    kind: "bracket",
    id: "right",
    label: "right",
    a: "host",
    face: "z",
    sign: 1,
    sa: -1,
    offset: 80,
    b: "b",
  };
  return {
    format: "glowframes",
    version: 1,
    units: "mm",
    name: "test",
    presets: [100],
    fastenersPerSide: 1,
    parts: [host, a, b, left, right],
  };
}
test("Facing brackets cannot slide into each other despite valid rail junctions", () => {
  const p = frame();
  assert.deepEqual(clearanceConflicts(p.parts), []);
  const blocked = moveParts(p, ["b"], [-60, 0, 0]);
  assert.match(blocked.error!, /hardware overlaps/);
  assert.equal(blocked.project, p);
  assert.equal(moveParts(p, ["b"], [-10, 0, 0]).error, undefined);
});
test("Overlapping bracket choices are excluded and existing collisions are reported", () => {
  const p = frame();
  (p.parts[2] as Rail).p[0] = 30;
  const right = p.parts.pop() as Bracket;
  assert.equal(bracketInterference(right, p.parts)?.id, "left");
  assert.ok(
    !bracketCandidates(p.parts).some(
      (c) => c.a === "host" && c.b === "b" && c.sa === -1 && c.face === "z" && c.sign === 1,
    ),
  );
  p.parts.push(right);
  assert.ok(issues(p.parts).some((c) => c.text.includes("hardware overlaps")));
});
