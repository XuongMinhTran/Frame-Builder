import {
  ai,
  bounds,
  bracketFrame,
  holeOffset,
  issues,
  partPosition,
  rail,
  round,
} from "./model.ts";
import type { Bracket, Project, Rail, Vec } from "./model.ts";

export type MountPoint = {
  railId: string;
  partId: string;
  face: string;
  offset: number;
  count: number;
  forLabel: string;
  p: Vec;
  /** Outward screw axis in the saved model's coordinates. */
  normal: Vec;
  /** Displacement from the final nut position to just outside its loading end. */
  insertion?: Vec;
};
export type BuildStep = {
  id: string;
  phase:
    | "Prepare"
    | "Layout"
    | "Preload"
    | "Position"
    | "Connect"
    | "Check"
    | "Tighten"
    | "Reorient"
    | "Support";
  level?: string;
  title: string;
  text: string;
  check: string;
  active: string[];
  installed: string[];
  /** Completed screw legs, including the leg being animated in this step. */
  fastened: string[];
  hardware?: string;
  mounts?: MountPoint[];
  bench: {
    /** Euler XYZ degrees; renderer grounds the transformed workpiece on the table. */
    rotation: Vec;
    fromRotation?: Vec;
    label: string;
    supportIds: string[];
    /** Only parts on the bench now, including this step's moving part. */
    workIds: string[];
  };
  support: { resting: string; hold: string; secure: string };
  motion?: { kind: "nuts" | "screws" | "place" | "turn"; partIds: string[] };
};

/** One location per bracket leg; repeated fasteners use the user's hardware count,
 * not fabricated hole spacing. Independent mounting points stay separate. */
export function mountingPoints(p: Project): MountPoint[] {
  const out: MountPoint[] = [];
  for (const part of p.parts) {
    if (part.kind === "nut") {
      const r = rail(p.parts, part.rail);
      if (!r) continue;
      const normal: Vec = [0, 0, 0];
      normal[ai(part.face)] = part.sign;
      out.push({
        railId: r.id,
        partId: part.id,
        face: `${part.sign > 0 ? "+" : "−"}${part.face.toUpperCase()}`,
        offset: round(part.offset + r.length / 2),
        count: 1,
        forLabel: part.label,
        p: partPosition(part, p.parts),
        normal,
      });
    }
    if (part.kind !== "bracket") continue;
    const f = bracketFrame(part, p.parts);
    if (!f) continue;
    for (const side of [0, 1]) {
      const r = rail(p.parts, side ? part.b : part.a);
      if (!r) continue;
      const along = side ? f.v : f.u,
        normal = side ? f.u : f.v;
      const at: Vec = [...f.origin],
        outward: Vec = [0, 0, 0];
      at[along[0]] += along[1] * holeOffset(part, p.parts);
      at[normal[0]] -= normal[1] * 2.4;
      outward[normal[0]] = normal[1];
      out.push({
        railId: r.id,
        partId: part.id,
        face: `${normal[1] > 0 ? "+" : "−"}${"XYZ"[normal[0]]}`,
        offset: round(at[ai(r.axis)] - r.p[ai(r.axis)] + r.length / 2),
        count: p.fastenersPerSide,
        forLabel: part.label,
        p: at,
        normal: outward,
      });
    }
  }
  return out;
}

/** Matches THREE.Euler's XYZ order; all assembly poses use quarter turns. */
function rotated(v: Vec, rotation: Vec): Vec {
  const [x, y, z] = rotation.map((r) => (r * Math.PI) / 180),
    sz = Math.sin(z),
    cz = Math.cos(z),
    sy = Math.sin(y),
    cy = Math.cos(y),
    sx = Math.sin(x),
    cx = Math.cos(x),
    u = [cz * v[0] - sz * v[1], sz * v[0] + cz * v[1], v[2]],
    w = [cy * u[0] + sy * u[2], u[1], -sy * u[0] + cy * u[2]];
  return [
    round(w[0]),
    round(cx * w[1] - sx * w[2]),
    round(sx * w[1] + cx * w[2]),
  ];
}
const directions: Vec[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const poses: Vec[] = [];
const seen = new Set<string>();
for (const x of [0, 90, -90, 180])
  for (const y of [0, 90, -90, 180])
    for (const z of [0, 90, -90, 180]) {
      const pose: Vec = [x, y, z],
        key = directions.map((v) => rotated(v, pose).join()).join(";");
      if (!seen.has(key)) {
        seen.add(key);
        poses.push(pose);
      }
    }
const samePose = (a: Vec, b: Vec) =>
  directions.every((v) =>
    rotated(v, a).every((n, i) => n === rotated(v, b)[i]),
  );

/** Choose a low workpiece with an accessible working face, then minimize turning.
 * Preload asks for a face pointing up; screws may also enter from the side.
 * This is a geometric support suggestion, not a center-of-mass or strength test. */
function benchPose(
  rs: Rail[],
  normal?: Vec,
  previous: Vec = [0, 0, 0],
  minNormalY = 0.99,
): Vec {
  const size = bounds(rs).size;
  let best: Vec = [0, 0, 0],
    score = Infinity;
  for (const pose of poses) {
    if (normal && rotated(normal, pose)[1] < minNormalY) continue;
    const extents = directions.map((_, i) =>
      directions.reduce(
        (n, v, j) => n + Math.abs(rotated(v, pose)[i]) * size[j],
        0,
      ),
    );
    const turn = directions.reduce(
      (n, v) =>
        n +
        rotated(v, pose).reduce(
          (s, x, i) => s + Math.abs(x - rotated(v, previous)[i]),
          0,
        ),
      0,
    );
    const candidate = extents[1] + turn * 0.05;
    if (candidate < score) {
      score = candidate;
      best = pose;
    }
  }
  return [...best];
}
const labelOrder = (a: Rail, b: Rail) =>
  a.label.localeCompare(b.label, undefined, { numeric: true });
const bottomOrder = (a: Rail, b: Rail) =>
  bounds([a]).min[1] - bounds([b]).min[1] ||
  Number(a.axis === "y") - Number(b.axis === "y") ||
  labelOrder(a, b);

/** Physical descriptions for the guide; saved editor names remain untouched. */
export function describeRail(p: Project, id: string): string {
  const r = rail(p.parts, id);
  if (!r) return "rail";
  const peers = p.parts.filter(
    (part): part is Rail =>
      part.kind === "rail" &&
      (r.axis === "y"
        ? part.axis === "y"
        : part.axis !== "y" && Math.abs(part.p[1] - r.p[1]) < 0.1),
  );
  const box = bounds(peers),
    center = box.min.map((v, i) => (v + box.max[i]) / 2);
  const side = (i: number, low: string, high: string) =>
    r.p[i] < center[i] - 1 ? low : r.p[i] > center[i] + 1 ? high : "middle";
  const position =
    r.axis === "x"
      ? side(2, "back", "front")
      : r.axis === "z"
        ? side(0, "left", "right")
        : `${side(2, "back", "front")} ${side(0, "left", "right")}`;
  return `${r.length} mm ${position} ${r.axis === "y" ? "upright" : "rail"}`;
}

export function buildPlan(p: Project): BuildStep[] {
  const rails = p.parts.filter((r): r is Rail => r.kind === "rail");
  if (!rails.length) return [];
  const brackets = p.parts.filter((r): r is Bracket => r.kind === "bracket");
  const mounts = mountingPoints(p).map((m) => ({
    ...m,
    forLabel:
      p.parts.find((part) => part.id === m.partId)?.kind === "nut"
        ? "Separate mounting point"
        : "Corner bracket",
  }));
  const installed = new Set<string>(),
    fastened = new Set<string>(),
    loaded = new Set<string>();
  const steps: BuildStep[] = [];
  let work = new Set<string>(),
    rotation: Vec = [0, 0, 0],
    level = "Preparation",
    serial = 0;
  const name = (id: string) => describeRail(p, id);
  const support = (
    hold = "Hold the two pieces together while starting each screw.",
  ) => ({
    resting: "Rest the flat frame pieces directly on the table.",
    hold,
    secure:
      "Snug both legs of each joint before letting go. Leave final tightening until the frame is square.",
  });
  const bench = (label: string): BuildStep["bench"] => ({
    rotation: [...rotation],
    label,
    supportIds: [...work].filter((id) => rail(p.parts, id)),
    workIds: [...work],
  });
  const add = (s: Omit<BuildStep, "installed" | "fastened" | "level">) =>
    steps.push({
      ...s,
      level,
      installed: [...installed],
      fastened: [...fastened],
    });
  const checks = issues(p.parts);
  add({
    id: "prepare",
    phase: "Prepare",
    title: "Clear the table and sort by length",
    text: "Lay out and build one level at a time, starting at the bottom. Match pieces by their measured length and position in the picture. The pieces do not need names or stickers.",
    check: checks.length
      ? `Review ${checks.length} model issues in Frame before building.`
      : "Check the available rail lengths, brackets, T-nuts and screws against the model.",
    active: [],
    bench: bench("A clear, flat table"),
    support: {
      ...support(
        "Keep the current pieces within reach; leave the next level aside.",
      ),
      secure:
        "Have the brackets, nuts, screws and matching driver within reach.",
    },
  });

  const preload = (r: Rail) => {
    if (loaded.has(r.id)) return;
    loaded.add(r.id);
    const previousWork = work,
      previousRotation = rotation;
    work = new Set([r.id]);
    const nuts = p.parts
      .filter((n) => n.kind === "nut" && n.rail === r.id)
      .map((n) => n.id);
    nuts.forEach((id) => work.add(id));
    const faces = new Map<string, MountPoint[]>();
    mounts
      .filter((m) => m.railId === r.id)
      .forEach((m) => faces.set(m.face, [...(faces.get(m.face) ?? []), m]));
    let index = 0;
    for (const [face, list] of faces) {
      const points = list
        .sort((a, b) => b.offset - a.offset)
        .map((m) => {
          const insertion: Vec = [0, 0, 0];
          insertion[ai(r.axis)] = -m.offset - 24;
          return { ...m, insertion };
        });
      rotation = benchPose([r], points[0].normal);
      add({
        id: index++ ? `preload-${r.id}-${face}` : `preload-${r.id}`,
        phase: "Preload",
        title: `Load nuts · ${name(r.id)}`,
        text: `Take the ${name(r.id)} from the layout and lay it flat with the shown slot facing up. Slide the nuts in through the end shown as 0 mm on screen, farthest position first. This is a measurement reference, not a label you need to attach.`,
        hardware: `${points.reduce((n, m) => n + m.count, 0)} T-nuts`,
        check:
          "Keep the threads facing out. Keep the nuts in their slots when returning the piece to its position in the layout.",
        active: [...work],
        mounts: points,
        bench: bench(`${r.length} mm rail flat on the table · slot ${face} up`),
        support: {
          ...support(
            "Hold the rail steady on the table while sliding the nuts.",
          ),
          secure:
            "Keep a finger over the open end when moving the rail so the nuts stay inside.",
        },
        motion: {
          kind: "nuts",
          partIds: [...new Set(points.map((m) => m.partId))],
        },
      });
    }
    work = previousWork;
    rotation = previousRotation;
  };
  const addRail = (r: Rail) => {
    work.add(r.id);
    installed.add(r.id);
    for (const n of p.parts.filter(
      (n) => n.kind === "nut" && n.rail === r.id,
    )) {
      work.add(n.id);
      installed.add(n.id);
    }
  };
  const turnTo = (next: Vec, title: string) => {
    if (samePose(next, rotation)) return;
    const fromRotation: Vec = [...rotation];
    rotation = [...next];
    add({
      id: `turn-${++serial}`,
      phase: "Reorient",
      title,
      text: "Check that the joined pieces cannot slide apart. Hold both sides, lift just clear of the table, turn the frame as shown, and set it back down. Keep hold of any newly added piece; use a helper if you cannot hold it and reach the joint together.",
      check:
        "Set the work down steadily before continuing. Do not lift a collection of loose pieces as one frame.",
      active: [...work],
      bench: {
        ...bench("Turn the joined frame, then rest it on the table"),
        fromRotation,
      },
      support: support(
        "Hold both sides throughout the turn; keep the weight close to the table.",
      ),
      motion: { kind: "turn", partIds: [...work] },
    });
  };
  const connect = (selected: MountPoint[], prefit = false) => {
    const jobs = selected.filter(
      (m) => !fastened.has(`${m.partId}:${m.railId}`),
    );
    // Finish both legs of a corner together whenever reachable. Never require
    // an unfastened floor to be carried merely to access a side-facing screw.
    while (jobs.length) {
      const first =
        jobs.find((m) => rotated(m.normal, rotation)[1] >= -0.05) ?? jobs[0];
      if (rotated(first.normal, rotation)[1] < -0.05)
        turnTo(
          benchPose(
            rails.filter((r) => work.has(r.id)),
            first.normal,
            rotation,
            -0.05,
          ),
          "Turn the joined level to reach its underside",
        );
      const index = jobs.indexOf(first);
      jobs.splice(index, 1);
      const b = brackets.find((b) => b.id === first.partId)!;
      work.add(b.id);
      installed.add(b.id);
      fastened.add(`${b.id}:${first.railId}`);
      const other = b.a === first.railId ? b.b : b.a;
      const open = !!other && !work.has(other);
      add({
        id: `connect-${b.id}-${first.railId}`,
        phase: "Connect",
        title: `${open ? "Pre-fit a bracket" : "Fasten the corner"} · ${name(first.railId)}`,
        text: `${open ? `Fit this bracket while the level is flat on the table; its other leg will receive the ${name(other)} later.` : `Hold the ${name(first.railId)} against ${other ? "the " + name(other) : "the bracket"}, with the bracket flush at this corner.`} Line up the preloaded nut in the ${name(first.railId)}, start the screw by hand, then turn it until snug.`,
        hardware: `${first.count} screw${first.count === 1 ? "" : "s"} · ${first.count} preloaded T-nut${first.count === 1 ? "" : "s"}`,
        check:
          open || prefit
            ? "Leave the receiving leg clear. The bracket must stay in position when you move the level."
            : other && !fastened.has(`${b.id}:${other}`)
              ? "Keep the corner together while fastening the other bracket leg."
              : "Check both legs sit flush and the joined pieces stay steady before letting go.",
        active: [b.id],
        mounts: [first],
        bench: bench(`Working on the ${name(first.railId)}`),
        support: support(
          open
            ? "Hold the bracket against the rail while starting the screw."
            : "Hold the new piece against its neighbor until both bracket legs are snug.",
        ),
        motion: { kind: "screws", partIds: [b.id] },
      });
    }
  };
  const adjacent = (id: string) =>
    brackets.flatMap((b) =>
      b.a === id && b.b ? [b.b] : b.b === id ? [b.a] : [],
    );
  const connectedGroups = (floor: Rail[]) => {
    const groups: string[][] = [],
      left = new Set(floor.map((r) => r.id));
    for (const r of floor) {
      if (!left.delete(r.id)) continue;
      const group = [r.id];
      for (let i = 0; i < group.length; i++)
        for (const id of adjacent(group[i]))
          if (left.delete(id)) group.push(id);
      groups.push(group);
    }
    return groups;
  };
  const belongsTo = (id: string, group: string[]) =>
    group.includes(id) ||
    p.parts.some(
      (part) =>
        part.id === id &&
        (part.kind === "nut"
          ? group.includes(part.rail)
          : part.kind === "bracket" &&
            (group.includes(part.a) || group.includes(part.b))),
    );
  const remaining = new Set(rails.map((r) => r.id)),
    components: Rail[][] = [];
  for (const seed of [...rails].sort(bottomOrder)) {
    if (!remaining.delete(seed.id)) continue;
    const queue = [seed.id],
      component: Rail[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      component.push(rail(p.parts, id)!);
      for (const next of adjacent(id))
        if (remaining.delete(next)) queue.push(next);
    }
    components.push(component);
  }
  for (const [ci, component] of components.entries()) {
    let assembly = new Set<string>();
    const floors: Rail[][] = [];
    for (const r of component.filter((r) => r.axis !== "y").sort(bottomOrder)) {
      const floor = floors.find((f) => Math.abs(f[0].p[1] - r.p[1]) < 0.1);
      if (floor) floor.push(r);
      else floors.push([r]);
    }
    const pendingUprights = component
      .filter((r) => r.axis === "y")
      .sort(bottomOrder);
    const readyMounts = () =>
      mounts.filter(
        (m) =>
          work.has(m.railId) &&
          brackets.some(
            (b) =>
              b.id === m.partId && work.has(b.a) && (!b.b || work.has(b.b)),
          ),
      );
    const addUpright = (r: Rail) => {
      work = new Set(assembly);
      rotation = [0, 0, 0];
      const alone = !assembly.size;
      if (alone) rotation = benchPose([r]);
      level = "Uprights";
      add({
        id: `layout-${r.id}`,
        phase: "Layout",
        title: `Choose the ${name(r.id)}`,
        text: "Measure the next piece and compare its position with the picture. Work on one upright at a time.",
        check: "Keep the next upright aside until this one is attached.",
        active: [r.id],
        bench: {
          ...bench("Choose this piece by length"),
          rotation: benchPose([r]),
          workIds: [r.id],
          supportIds: [r.id],
        },
        support: {
          ...support(),
          secure: "Leave this piece flat until you are ready to attach it.",
        },
      });
      preload(r);
      addRail(r);
      add({
        id: `position-${r.id}`,
        phase: "Position",
        title: alone ? `Lay the ${name(r.id)} flat` : `Add the ${name(r.id)}`,
        text: alone
          ? "Lay this separate piece flat on the table as shown."
          : "Keep the lower level on the table. Seat this upright against its prepared bracket and hold it in place while fitting the joint. Use a helper if you need another hand to reach the screw.",
        check: alone
          ? "This piece has no joined base; leave it lying flat."
          : "Keep holding this piece until its bracket is attached on both legs and the upright stays steady.",
        active: [r.id],
        bench: bench(
          alone
            ? "Loose piece flat on the table"
            : "Lower level on the table · hold the new upright",
        ),
        support: support(),
        motion: { kind: "place", partIds: [r.id] },
      });
      connect(readyMounts());
      assembly = new Set(work);
    };
    for (const [fi, floor] of floors.entries()) {
      level = `${components.length > 1 ? `Assembly ${ci + 1} · ` : ""}Level ${fi + 1}${fi === 0 ? " · bottom" : ""}`;
      work = new Set(floor.map((r) => r.id));
      rotation = [0, 0, 0];
      const lengths = new Map<number, number>();
      floor.forEach((r) =>
        lengths.set(r.length, (lengths.get(r.length) ?? 0) + 1),
      );
      add({
        id: `layout-floor-${ci}-${fi}`,
        phase: "Layout",
        title: `Lay out level ${fi + 1} on the table`,
        text: `${fi ? "Set the lower assembly aside for now. " : ""}Arrange ${[...lengths].map(([length, count]) => `${count} × ${length} mm`).join(" and ")} pieces in the positions shown. Lay the whole level flat first, with the rail ends meeting as pictured. Leave the other levels aside.`,
        check:
          "Compare the lengths and corner arrangement before inserting hardware. Front, back, left and right refer to this layout, not labels on the pieces.",
        active: [...work],
        bench: bench(
          `Level ${fi + 1} laid out flat · match lengths and positions`,
        ),
        support: {
          ...support(
            "Nudge the loose pieces into place on the table; nothing needs to be held in the air.",
          ),
          secure: "Leave the corners unfastened until the nuts are loaded.",
        },
      });
      floor.forEach(preload);
      work = new Set();
      floor.forEach(addRail);
      add({
        id: `position-floor-${ci}-${fi}`,
        phase: "Position",
        title: `Bring level ${fi + 1}'s corners together`,
        text: "Return the loaded pieces to the same layout. Bring the ends together on the table, keeping each nut near its bracket position.",
        check:
          "Keep all pieces flat. Finish one corner before moving to the next.",
        active: [...work],
        bench: bench(`Level ${fi + 1} flat on the table`),
        support: support(),
        motion: { kind: "place", partIds: [...work] },
      });
      connect(readyMounts());
      // Only turn a joined section; unrelated pieces in this level remain on
      // the table. Prefit the receiving brackets before joining the next level.
      const completeFloor = new Set(work),
        groups = connectedGroups(floor);
      for (const group of groups) {
        work = new Set([...completeFloor].filter((id) => belongsTo(id, group)));
        connect(
          mounts.filter(
            (m) =>
              work.has(m.railId) &&
              brackets.some(
                (b) =>
                  b.id === m.partId &&
                  (!b.b || !work.has(b.a) || !work.has(b.b)),
              ),
          ),
          true,
        );
        turnTo([0, 0, 0], "Return this section to its layout orientation");
        work.forEach((id) => completeFloor.add(id));
      }
      work = completeFloor;
      add({
        id: `level-check-${ci}-${fi}`,
        phase: "Check",
        title: `Check level ${fi + 1} before building upward`,
        text: "Check that the corners meet neatly and compare the diagonals of rectangular sections. Snug the joined corners so the level holds its shape. Keep final tightening for the last pass.",
        check:
          "A level with unjoined pieces must be moved one piece at a time; only lift connected pieces together.",
        active: floor.map((r) => r.id),
        bench: bench(`Level ${fi + 1} complete on the table`),
        support: support(),
      });
      const floorWork = new Set(work);
      if (assembly.size) {
        work = new Set([...assembly, ...floorWork]);
        rotation = [0, 0, 0];
        // Components joined only through uprights can have an open level. Those
        // rails are placed and fastened separately instead of floated as a unit.
        work = new Set(assembly);
        for (const group of groups) {
          const moving = [...floorWork].filter((id) => belongsTo(id, group));
          moving.forEach((id) => work.add(id));
          add({
            id: `join-level-${ci}-${fi}-${groups.indexOf(group)}`,
            phase: "Position",
            title:
              groups.length === 1
                ? `Place the assembled level ${fi + 1}`
                : `Add the next section of level ${fi + 1}`,
            text: "Bring this joined section to the uprights as shown. Hold it at the intended height while fitting its prepared brackets. Have a helper hold the other end if you cannot hold it steady and reach the screws together.",
            check:
              "Finish these joining screws before picking up another section or releasing the frame.",
            active: moving,
            bench: bench(`Join level ${fi + 1} to the lower assembly`),
            support: support(
              "Hold both ends of the new section until the joining brackets are secure.",
            ),
            motion: { kind: "place", partIds: moving },
          });
          connect(readyMounts());
        }
      }
      assembly = new Set(work);
      // Add only the uprights that start at this floor before advancing upward.
      const nextHeight = floors[fi + 1]?.[0].p[1] ?? Infinity;
      for (const r of [...pendingUprights])
        if (
          bounds([r]).min[1] < nextHeight &&
          adjacent(r.id).some((id) => assembly.has(id))
        ) {
          pendingUprights.splice(pendingUprights.indexOf(r), 1);
          addUpright(r);
        }
    }
    for (const r of pendingUprights) addUpright(r);
    work = new Set(assembly);
    if (component.length > 1 && floors.length)
      turnTo([0, 0, 0], "Return the joined frame to its working orientation");
    level = `Assembly ${ci + 1}`;
    if (ci < components.length - 1)
      add({
        id: `set-aside-${ci}`,
        phase: "Check",
        title: "Set this completed assembly aside",
        text: "Leave this assembly resting steadily and clear the table for the next separate assembly.",
        check: "Separate assemblies are not joined in this model.",
        active: [...work],
        bench: bench("Clear the table for the next assembly"),
        support: support(),
      });
  }
  level = "Final checks";
  if (components.length > 1) {
    work = new Set(installed);
    rotation = [0, 0, 0];
  }
  const finalBench = bench("Completed frame resting on the table");
  add({
    id: "square",
    phase: "Check",
    title: "Check all levels before final tightening",
    text: "Compare the diagonals of rectangular levels and check the uprights. Adjust the joints while they can still move, then check the equipment fits.",
    check: "Check actual fit and screw access against your hardware.",
    active: [...work],
    bench: finalBench,
    support: support(),
  });
  add({
    id: "tighten",
    phase: "Tighten",
    title: "Tighten each level in turn",
    text: "Work around the bottom level, then upward, tightening a little at a time and rechecking square. Follow the hardware manufacturer's torque specification.",
    check:
      "Inspect every joint and check the frame rests steadily before using it.",
    active: brackets.map((b) => b.id),
    bench: finalBench,
    support: support(),
  });
  return steps;
}
