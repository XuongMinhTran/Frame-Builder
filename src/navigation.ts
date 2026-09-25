import { Camera, Quaternion, Vector3 } from "three";

export const flightKeys = new Set(["w", "a", "s", "d", "q", "e"]);

export function flightOffset(
  orientation: Quaternion,
  keys: ReadonlySet<string>,
  speed: number,
  seconds: number,
  fast = false,
) {
  const forward = new Vector3(0, 0, -1).applyQuaternion(orientation);
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const direction = forward
    .multiplyScalar(Number(keys.has("w")) - Number(keys.has("s")))
    .addScaledVector(right, Number(keys.has("d")) - Number(keys.has("a")))
    .addScaledVector(
      new Vector3(0, 1, 0),
      Number(keys.has("e")) - Number(keys.has("q")),
    );
  return direction
    .normalize()
    .multiplyScalar(
      speed * Math.min(0.05, Math.max(0, seconds)) * (fast ? 3 : 1),
    );
}

export function lookDirection(direction: Vector3, dx: number, dy: number) {
  const yaw = Math.atan2(-direction.x, -direction.z) - dx * 0.003;
  const pitch = Math.max(
    -Math.PI / 2 + 0.02,
    Math.min(
      Math.PI / 2 - 0.02,
      Math.asin(Math.max(-1, Math.min(1, direction.y))) - dy * 0.003,
    ),
  );
  return new Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}

/** Change viewing direction without moving the camera or orbiting the assembly. */
export function rotateCameraInPlace(
  camera: Camera,
  target: Vector3,
  dx: number,
  dy: number,
) {
  const distance = Math.max(10, camera.position.distanceTo(target));
  const direction = lookDirection(
    camera.getWorldDirection(new Vector3()),
    dx,
    dy,
  );
  target.copy(camera.position).addScaledVector(direction, distance);
  camera.lookAt(target);
}
