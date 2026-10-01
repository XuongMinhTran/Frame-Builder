import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Vec } from "./model.ts";

export const ease = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
export const rotationQuaternion = (rotation: Vec) =>
  new Quaternion().setFromEuler(
    new Euler(...(rotation.map((n) => (n * Math.PI) / 180) as Vec)),
  );

/** Rotate about the workpiece center, lift clear of the table, then lower onto the table.
 * Recomputing the lower extent throughout the turn prevents table penetration. */
export function tablePose(box: Box3, rotation: Quaternion, lift = 0) {
  const transformed = box
    .clone()
    .applyMatrix4(new Matrix4().makeRotationFromQuaternion(rotation));
  const center = transformed.getCenter(new Vector3());
  return new Vector3(
    -center.x,
    -transformed.min.y + Math.max(0, lift),
    -center.z,
  );
}

/** Frame the entire lift and turn so a long assembly stays in view. */
export function turnBounds(
  box: Box3,
  from: Quaternion,
  to: Quaternion,
  groundBox: Box3 = box,
) {
  const bounds = new Box3();
  const diagonal = box.getSize(new Vector3()).length();
  const height = Math.max(90, groundBox.getSize(new Vector3()).length() * 0.17);
  const slices = 64;
  for (let i = 0; i <= slices; i++) {
    const t = i / slices;
    const rotation = new Quaternion().slerpQuaternions(from, to, t);
    const position = tablePose(
      groundBox,
      rotation,
      Math.sin(Math.PI * t) * height,
    );
    bounds.union(
      box
        .clone()
        .applyMatrix4(
          new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)),
        ),
    );
  }
  // Cover extrema between samples, including the changing support height.
  return bounds.expandByScalar(((2 * diagonal + height) * Math.PI) / slices);
}

export function insertionAt(
  seconds: number,
  index: number,
  kind: "nuts" | "screws",
) {
  const duration = kind === "nuts" ? 2.1 : 2.4;
  const t = Math.max(
    0,
    Math.min(1, (seconds - 0.45 - index * (duration + 0.4)) / duration),
  );
  if (kind === "nuts")
    return {
      progress: ease(t),
      turns: 0,
      visible: seconds >= 0.45 + index * (duration + 0.4),
      seated: t >= 1,
    };
  // Approach the hole first; spin only once the screw is engaging its nut.
  const progress =
    t < 0.45 ? ease(t / 0.45) * 0.93 : 0.93 + ease((t - 0.45) / 0.55) * 0.07;
  return {
    progress,
    turns: Math.max(0, (t - 0.45) / 0.55) * 3,
    visible: seconds >= 0.45 + index * (duration + 0.4),
    seated: t >= 1,
  };
}

export const motionDuration = (kind: string | undefined, count: number) =>
  kind === "nuts"
    ? 0.85 + Math.max(1, count) * 2.5
    : kind === "screws"
      ? 0.85 + Math.max(1, count) * 2.8
      : kind === "turn"
        ? 3.4
        : kind === "place"
          ? 2.8
          : 0;
