import { Box3, Ray, Vector3 } from "three";
import { ai, axes, snap } from "./model.ts";
import type { Axis, Part, Rail, Vec } from "./model.ts";
import { railInterference } from "./clearance.ts";

export const halfSize = (r: Rail, i: number) =>
  i === ai(r.axis) ? r.length / 2 : 10;
export function railBox(r: Rail) {
  return new Box3(
    new Vector3(...r.p.map((v, i) => v - halfSize(r, i))),
    new Vector3(...r.p.map((v, i) => v + halfSize(r, i))),
  );
}
export function pickRail(ray: Ray, r: Rail) {
  const point = ray.intersectBox(railBox(r), new Vector3());
  if (!point) return null;
  let face = 0,
    gap = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(
      Math.abs(point.getComponent(i) - r.p[i]) - halfSize(r, i),
    );
    if (d < gap) {
      gap = d;
      face = i;
    }
  }
  const normal = new Vector3().setComponent(
    face,
    Math.sign(point.getComponent(face) - r.p[face]) || 1,
  );
  return { point, normal, distance: ray.origin.distanceTo(point) };
}
export type Attachment = {
  key: string;
  host: Rail;
  axis: Axis;
  sign: number;
  p: Vec;
  score: number;
  label: string;
};
export function overlaps(a: Rail, b: Rail) {
  return axes.every(
    (_, i) =>
      Math.abs(a.p[i] - b.p[i]) < halfSize(a, i) + halfSize(b, i) - 0.001,
  );
}
// Use outer envelopes, never slot walls. Every candidate is a face-to-face
// contact; tangential coordinates retain the user's intended grab offset.
export function attachments(
  moving: Rail,
  host: Rail,
  desired: Vec,
  step: number,
  parts: Part[],
  constrainedAxis?: Axis,
): Attachment[] {
  const result: Attachment[] = [];
  for (let i = 0; i < 3; i++)
    for (const sign of [-1, 1]) {
      const p = [...desired] as Vec;
      p[i] = host.p[i] + sign * (halfSize(host, i) + halfSize(moving, i));
      for (let j = 0; j < 3; j++)
        if (j !== i) {
          const span = Math.abs(halfSize(host, j) - halfSize(moving, j));
          const lo = host.p[j] - span,
            hi = host.p[j] + span;
          const gridLo = step > 0 ? Math.ceil(lo / step) * step : lo;
          const gridHi = step > 0 ? Math.floor(hi / step) * step : hi;
          p[j] =
            gridLo <= gridHi
              ? Math.max(gridLo, Math.min(gridHi, snap(desired[j], step)))
              : Math.max(lo, Math.min(hi, desired[j]));
        }
      if (
        constrainedAxis &&
        p.some(
          (v, j) =>
            j !== ai(constrainedAxis) && Math.abs(v - moving.p[j]) > 0.001,
        )
      )
        continue;
      const placed = { ...moving, p };
      if (railInterference(placed, parts)) continue;
      if (
        parts.some(
          (r) =>
            r.kind === "rail" &&
            !r.hidden &&
            r.id !== moving.id &&
            r.id !== host.id &&
            overlaps(placed, r),
        )
      )
        continue;
      result.push({
        key: `${host.id}:${i}:${sign}`,
        host,
        axis: axes[i],
        sign,
        p,
        score: p.reduce((sum, v, j) => sum + (v - desired[j]) ** 2, 0),
        label: `${i === ai(moving.axis) ? "End" : "Side"} → ${i === ai(host.axis) ? "end" : "side"}`,
      });
    }
  return result.sort((a, b) => a.score - b.score);
}

export function nearbyAttachments(
  moving: Rail,
  desired: Vec,
  parts: Part[],
  step: number,
  axis?: Axis,
  heldKey?: string,
) {
  const all = parts.flatMap((p) =>
    p.kind === "rail" && !p.hidden && p.id !== moving.id
      ? attachments(moving, p, desired, step, parts, axis)
      : [],
  );
  all.sort((a, b) => a.score - b.score);
  const held = all.find((c) => c.key === heldKey && c.score <= 34 ** 2);
  const best = held || all.find((c) => c.score <= 22 ** 2);
  return best
    ? { best, choices: all.filter((c) => c.host.id === best.host.id) }
    : null;
}
