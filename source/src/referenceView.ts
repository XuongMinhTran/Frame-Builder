import * as T from "three";
import { referenceGeometry } from "./references";
import type { ReferenceObject } from "./references";

export function referenceView(r: ReferenceObject, selected: boolean) {
  const group = new T.Group();
  group.position.fromArray(r.p);
  group.rotation.set(
    ...(r.rotation.map(T.MathUtils.degToRad) as [number, number, number]),
  );
  const mesh = new T.Mesh(
    referenceGeometry(r),
    new T.MeshStandardMaterial({
      color: r.color,
      transparent: r.opacity < 1,
      opacity: r.opacity,
      depthWrite: r.opacity === 1,
      side: T.DoubleSide,
      roughness: 0.65,
    }),
  );
  group.add(mesh);
  if (selected)
    group.add(
      new T.LineSegments(
        new T.EdgesGeometry(mesh.geometry, 30),
        new T.LineBasicMaterial({
          color: 0xffd485,
          transparent: true,
          opacity: 0.7,
        }),
      ),
    );
  if (r.kind === "ruler") {
    const length = r.size[0],
      c = document.createElement("canvas");
    c.width = 4096;
    c.height = 192;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = r.color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = ctx.fillStyle = "#352b18";
    ctx.lineWidth = 2;
    ctx.font = "bold 65px sans-serif";
    ctx.textAlign = "center";
    const minor =
      length <= 500 ? 1 : length <= 2500 ? 5 : length <= 10000 ? 20 : 100;
    const major =
      length <= 100
        ? 10
        : length <= 1000
          ? 50
          : length <= 5000
            ? 250
            : length <= 10000
              ? 500
              : 5000;
    for (let mm = 0; mm <= length; mm += minor) {
      const x = (mm / length) * c.width,
        big = mm % major === 0;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, big ? 74 : mm % (minor * 5) === 0 ? 52 : 30);
      ctx.stroke();
      if (big && mm < length - major / 3)
        ctx.fillText(String(mm), Math.max(35, x), 150);
    }
    const texture = new T.CanvasTexture(c);
    texture.colorSpace = T.SRGBColorSpace;
    const markings = new T.Mesh(
      new T.PlaneGeometry(length, r.size[2]),
      new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }),
    );
    markings.rotation.x = -Math.PI / 2;
    markings.position.set(length / 2, r.size[1] / 2 + 0.05, 0);
    group.add(markings);
    if (selected) {
      const handle = new T.Mesh(
        new T.SphereGeometry(7, 16, 12),
        new T.MeshBasicMaterial({ color: 0xffe9af, depthTest: false }),
      );
      handle.position.x = length;
      handle.renderOrder = 30;
      handle.userData.extendRuler = true;
      group.add(handle);
    }
  }
  group.traverse((o) => {
    o.userData.referenceId = r.id;
  });
  return group;
}
