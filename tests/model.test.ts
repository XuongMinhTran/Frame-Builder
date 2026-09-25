import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exampleProject,
  emptyProject,
  newRail,
  bracketCandidates,
  bracketAt,
  bracketOk,
  bracketType,
  bill,
  parseProject,
  moveParts,
  removeParts,
  issues,
  connectedIds,
  csv,
  bounds,
} from "../src/model.ts";

test("Example has consistent geometry, hardware, bounds and round-trip persistence", () => {
  const p = exampleProject();
  assert.equal(p.parts.filter((x) => x.kind === "rail").length, 12);
  assert.equal(p.parts.filter((x) => x.kind === "bracket").length, 16);
  assert.deepEqual(bounds(p.parts).size, [600, 420, 400]);
  assert.deepEqual(issues(p.parts), []);
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  assert.equal(bill(p).find((r) => r.item === "Hex-socket screw")?.qty, 32);
  assert.equal(bill(p).find((r) => r.item === "T-nut")?.qty, 32);
});
test("An intermediate crossmember slides along its two receiving rails; incompatible movement is blocked", () => {
  const p = exampleProject(),
    r = p.parts.find((x) => x.label === "F11")!;
  const moved = moveParts(p, [r.id], [30, 0, 0]);
  assert.equal(moved.error, undefined);
  assert.notDeepEqual(moved.project, p);
  assert.equal(
    parseProject(JSON.stringify(moved.project)).parts.length,
    p.parts.length,
  );
  assert.ok(moveParts(p, [r.id], [0, 20, 0]).error);
  assert.ok(moveParts(p, [r.id], [0, 0, 20]).error);
  assert.ok(moveParts(p, [r.id], [900, 0, 0]).error);
});
test("Connected assembly can move rigidly", () => {
  const p = exampleProject(),
    ids = connectedIds(p.parts, [p.parts[0].id]);
  assert.equal(ids.length, p.parts.length);
  assert.equal(moveParts(p, ids, [0, 50, 0]).error, undefined);
});
test("Corner and intermediate T-junctions offer brackets on each open side", () => {
  const p = emptyProject(),
    a = newRail([], 600, "x", [0, 10, 0]);
  p.parts.push(a);
  const b = newRail(p.parts, 200, "z", [0, 10, 110]);
  p.parts.push(b);
  const cs = bracketCandidates(p.parts);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => bracketOk(c, p.parts) && c.b === b.id));
  b.p[0] = 290;
  assert.equal(bracketCandidates(p.parts).length, 1);
  b.p[2] = 0;
  assert.equal(bracketCandidates(p.parts).length, 0);
  assert.equal(
    issues(p.parts).filter((x) => x.text.includes("overlaps")).length,
    1,
  );
});
test("Independent T-nuts do not duplicate bracket fastener counts", () => {
  const p = exampleProject(),
    r = p.parts.find((x) => x.kind === "rail")!;
  p.parts.push({
    id: "nut1",
    label: "T01",
    kind: "nut",
    rail: r.id,
    face: "y",
    sign: 1,
    offset: 0,
  });
  assert.equal(
    bill(p)
      .filter((x) => x.item === "T-nut")
      .reduce((s, r) => s + r.qty, 0),
    33,
  );
  p.fastenersPerSide = 2;
  assert.equal(bill(p).find((x) => x.item === "Hex-socket screw")?.qty, 64);
});
test("Removing rails removes dependent brackets and mounting points", () => {
  const p = exampleProject(),
    id = p.parts[0].id;
  p.parts.push({
    id: "nut1",
    label: "T01",
    kind: "nut",
    rail: id,
    face: "y",
    sign: 1,
    offset: 0,
  });
  const removed = removeParts(p, [id]);
  assert.ok(
    !removed.parts.some(
      (p) =>
        p.id === "nut1" || (p.kind === "bracket" && (p.a === id || p.b === id)),
    ),
  );
  assert.doesNotThrow(() => parseProject(JSON.stringify(removed)));
});
test("Project reader rejects malformed, oversized, duplicate, and dangling data", () => {
  assert.throws(() => parseProject("{}"));
  assert.throws(() => parseProject("{invalid"));
  assert.throws(() => parseProject(" ".repeat(5_000_001)));
  const p = exampleProject();
  p.parts.push(p.parts[0]);
  assert.throws(() => parseProject(JSON.stringify(p)));
  const q = exampleProject();
  q.parts.push({
    id: "n",
    label: "T01",
    kind: "nut",
    rail: "absent",
    face: "x",
    sign: 1,
    offset: 0,
  });
  assert.throws(() => parseProject(JSON.stringify(q)));
});
test("Locked selections cannot move; CSV quotes labels safely", () => {
  const p = exampleProject();
  p.parts[0].locked = true;
  assert.ok(moveParts(p, [p.parts[0].id], [1, 0, 0]).error);
  p.parts[0].label = 'A,"B"';
  assert.ok(csv(p).includes('A,""B""'));
  assert.equal(p.parts[0].locked, true);
});

test("A bracket on one frame sits at the cursor and slides along it", () => {
  const p = emptyProject();
  const a = newRail(p.parts, 400, "x", [0, 10, 0]);
  p.parts.push(a);
  const r = bracketAt(p.parts, a, "y", 1, [53, 20, 0], { step: 10, join: true });
  assert.ok(r.bracket);
  const br = r.bracket!;
  assert.equal(br.b, "");
  assert.equal(br.offset, 40); // leg middle at the cursor, snapped to the step
  p.parts.push(br);
  assert.ok(issues(p.parts).some((i) => i.text.includes("holds only")));
  // Slides like a T-nut, but never off the end.
  assert.ok(!moveParts(p, [br.id], [100, 0, 0]).error);
  assert.ok(moveParts(p, [br.id], [300, 0, 0]).error);
  // Near the end the cursor spot is pulled back onto the frame.
  const end = bracketAt(p.parts, a, "y", 1, [199, 20, 0], { orient: 0 }).bracket!;
  assert.equal(end.offset, 170);
  // Face can't be the frame's own axis.
  assert.ok(bracketAt(p.parts, a, "x", 1, [0, 0, 0], {}).error);
  // Survives save and load.
  assert.equal((parseProject(JSON.stringify(p)).parts[1] as any).offset, 40);
});

test("Near a second frame the bracket snaps into a joint and follows it", () => {
  const p = emptyProject();
  const a = newRail(p.parts, 400, "x", [0, 10, 0]);
  p.parts.push(a);
  const b = newRail(p.parts, 200, "z", [50, 10, 110]);
  p.parts.push(b);
  // Cursor a little to the right of b on a's +z face.
  const r = bracketAt(p.parts, a, "z", 1, [80, 10, 10], { join: true });
  assert.equal(r.bracket?.b, b.id);
  assert.equal(r.bracket?.sa, 1);
  assert.equal(r.bracket?.offset, 60);
  // Without joining it just sits at the cursor.
  assert.equal(bracketAt(p.parts, a, "z", 1, [80, 10, 10], { join: false }).bracket?.b, "");
  // Rotated the other way, it snaps to b's other side.
  assert.equal(bracketAt(p.parts, a, "z", 1, [20, 10, 10], { join: true, orient: 2 }).bracket?.offset, 40);
  p.parts.push(r.bracket!);
  // Sliding b along a carries the bracket with it.
  const moved = moveParts(p, [b.id], [100, 0, 0]);
  assert.ok(!moved.error);
  const f = moved.project.parts.find((x) => x.kind === "bracket")!;
  assert.ok(bracketOk(f as any, moved.project.parts));
  // Lifting b off a is blocked by the bracket.
  assert.ok(moveParts(p, [b.id], [0, 0, 5]).error);
  // Removing b leaves the bracket on a, no longer joining.
  const left = removeParts(p, [b.id]).parts.find((x) => x.kind === "bracket") as any;
  assert.equal(left.b, "");
  assert.equal(left.offset, 60);
});

test("A frame lying across another takes the near-corner bracket", () => {
  const p = emptyProject();
  const low = newRail(p.parts, 400, "x", [0, 10, 0]);
  p.parts.push(low);
  const high = newRail(p.parts, 400, "z", [0, 30, 0]);
  p.parts.push(high);
  const cs = bracketCandidates(p.parts);
  // Two on top of the lower frame; under the upper one would hit the floor.
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.a === low.id && bracketType(c, p.parts) === "stacked"));
  p.parts.push({ ...cs[0], id: "s", label: "B01" });
  assert.ok(bill(p).some((r) => r.item.includes("holes near corner")));
  assert.ok(moveParts(p, [high.id], [0, 10, 0]).error);
  assert.ok(!moveParts(p, [high.id], [0, 0, 50]).error);
});

test("A frame can slide past a corner as long as the bracket still holds", () => {
  const p = emptyProject();
  const long = newRail(p.parts, 400, "x", [0, 10, 0]);
  p.parts.push(long);
  const short = newRail(p.parts, 200, "z", [190, 10, 110]);
  p.parts.push(short);
  const cs = bracketCandidates(p.parts);
  assert.equal(cs.length, 1);
  p.parts.push({ ...cs[0], id: "k", label: "B01" });
  assert.ok(!moveParts(p, [long.id], [-20, 0, 0]).error);
  assert.ok(moveParts(p, [long.id], [-21, 0, 0]).error);
  assert.ok(!moveParts(p, [long.id], [50, 0, 0]).error);
});

test("Older files with two-frame brackets still open", () => {
  const p = exampleProject();
  const legacy = JSON.parse(JSON.stringify(p));
  for (const part of legacy.parts)
    if (part.kind === "bracket") {
      // Rewrite in the old format: sa along a, sb along b's axis.
      const a = p.parts.find((x) => x.id === part.a) as any,
        b = p.parts.find((x) => x.id === part.b) as any;
      assert.equal(part.face, b.axis);
      part.sb = part.sign;
      delete part.face;
      delete part.sign;
      delete part.offset;
      void a;
    }
  legacy.parts.push({ kind: "bracket", id: "loose", label: "B99", a: "", b: "", sa: 1, sb: 1, free: { p: [0, 0, 0], u: [0, 1], v: [1, 1] } });
  const back = parseProject(JSON.stringify(legacy));
  assert.deepEqual(back.parts.filter((x) => x.kind === "bracket"), p.parts.filter((x) => x.kind === "bracket"));
});

test("A bracket can be turned 90° on its face", async () => {
  const { ORIENTS } = await import("../src/model.ts");
  const p = emptyProject();
  const a = newRail(p.parts, 400, "x", [0, 110, 0]);
  p.parts.push(a);
  // Turned across the top face: needs the near-corner holes, sits at the edge.
  const r = bracketAt(p.parts, a, "y", 1, [30, 120, 0], { orient: 1, step: 10 });
  assert.ok(r.bracket?.across);
  assert.equal(bracketType(r.bracket!, p.parts), "stacked");
  assert.equal(r.bracket!.offset, 30);
  // An upright standing beside the frame, touching it, is joined by it.
  const up = newRail(p.parts, 300, "y", [30, 150, -20]);
  p.parts.push(up);
  const j = bracketAt(p.parts, a, "y", 1, [40, 120, 0], { orient: 1, join: true });
  assert.equal(j.bracket?.b, up.id);
  assert.equal(j.bracket?.offset, 30);
  assert.equal(ORIENTS.length, 4);
  p.parts.push(j.bracket!);
  // The upright can slide up and down, but not along the frame.
  assert.ok(!moveParts(p, [up.id], [0, 20, 0]).error);
  assert.ok(!moveParts(p, [up.id], [10, 0, 0]).error); // bracket follows
  assert.ok(moveParts(p, [up.id], [0, 0, -5]).error);
});

test("Sliding a frame against a bracket's upright leg joins it", () => {
  const p = emptyProject();
  const a = newRail(p.parts, 380, "z", [0, 10, 0]);
  p.parts.push(a);
  const b = newRail(p.parts, 380, "x", [-150, 10, 300]);
  p.parts.push(b);
  // On a's -x side at its far end, flat leg running back along a.
  const br = bracketAt(p.parts, a, "x", -1, [-10, 10, 175], { orient: 2, step: 10 }).bracket!;
  assert.equal(br.offset, 190);
  p.parts.push(br);
  // b's side comes up against a's end: the bracket now holds b.
  const m = moveParts(p, [b.id], [0, 0, -100]);
  assert.equal((m.project.parts[2] as any).b, b.id);
  // Seen from either frame it is one joint, not two.
  const cs = bracketCandidates(m.project.parts);
  assert.ok(!cs.some((c) => c.a === b.id && c.b === a.id && c.face === "z" && c.sign === -1 && c.sa === -1));
});

test("Brackets can reach below the grid", () => {
  const p = emptyProject();
  const a = newRail(p.parts, 400, "x", [0, 10, 0]);
  p.parts.push(a);
  // On the side face, turned across with the flat leg running downward.
  const r = bracketAt(p.parts, a, "z", 1, [0, 10, 10], { orient: 3 });
  assert.ok(r.bracket, r.error);
  // All four turns are available on the top face too.
  for (const orient of [0, 1, 2, 3])
    assert.ok(bracketAt(p.parts, a, "y", 1, [0, 20, 0], { orient }).bracket);
});
