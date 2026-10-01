import * as T from "three";
import type { BuildStep, MountPoint } from "./assembly";
import type { Project, Vec } from "./model";
import { ai, rail } from "./model";
import {
  ease,
  insertionAt,
  motionDuration,
  rotationQuaternion,
  tablePose,
  turnBounds,
} from "./guideMotion";

type Moving = {
  object: T.Object3D;
  end: T.Vector3;
  start: T.Vector3;
  quaternion: T.Quaternion;
  mount?: MountPoint;
};
const vec = (v: Vec) => new T.Vector3(...v);
const axis = (i: number) =>
  new T.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);

/** A presentation of the build on a bench; never modifies the saved design. */
export class BenchScene {
  hardware = new T.Group();
  table = new T.Group();
  private moving: Moving[] = [];
  private box = new T.Box3();
  private contextBox = new T.Box3();
  private from = new T.Quaternion();
  private to = new T.Quaternion();
  private step: BuildStep | null = null;
  private elapsed = 0;
  private duration = 0;
  private detailCamera = new T.PerspectiveCamera(38, 1.45, 0.1, 20000);
  private inset: HTMLDivElement;
  private status: HTMLDivElement;
  constructor(
    private root: T.Group,
    private world: T.Group,
    private scene: T.Scene,
    host: HTMLElement,
  ) {
    root.add(this.hardware);
    scene.add(this.table);
    this.inset = document.createElement("div");
    this.inset.className = "hardware-inset";
    this.inset.hidden = true;
    this.inset.innerHTML = "<span>INSERTION CLOSE-UP</span><small></small>";
    host.append(this.inset);
    this.status = document.createElement("div");
    this.status.className = "bench-animation-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;
    host.append(this.status);
  }
  private clear(group: T.Group) {
    group.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          m.dispose(),
        );
      }
    });
    group.clear();
  }
  configure(step: BuildStep | null, project: Project, reset = true) {
    const elapsed = this.elapsed;
    this.clear(this.hardware);
    this.clear(this.table);
    this.moving = [];
    this.step = step;
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.updateMatrixWorld(true);
    this.inset.hidden = this.status.hidden = !step;
    if (!step) return;
    this.contextBox.setFromObject(this.world);
    this.box.makeEmpty();
    for (const object of this.world.children)
      if (!object.userData.guideContext)
        this.box.union(new T.Box3().setFromObject(object));
    if (this.box.isEmpty()) this.box.copy(this.contextBox);
    if (this.box.isEmpty())
      this.box.set(new T.Vector3(-250, 0, -150), new T.Vector3(250, 20, 150));
    this.to = rotationQuaternion(step.bench.rotation);
    this.from = rotationQuaternion(
      step.bench.fromRotation ?? step.bench.rotation,
    );
    this.duration = motionDuration(step.motion?.kind, step.mounts?.length ?? 0);
    const kind = step.motion?.kind;
    const mounts = step.mounts ?? [];
    if (kind === "nuts" || kind === "screws") {
      for (const mount of mounts) {
        const r = rail(project.parts, mount.railId);
        if (!r) continue;
        const normal = vec(mount.normal),
          long = axis(ai(r.axis)),
          cross = long.clone().cross(normal);
        const object = new T.Group();
        const mat = new T.MeshStandardMaterial({
          color: kind === "nuts" ? 0xbba572 : 0xd8dce0,
          roughness: 0.4,
          metalness: 0.55,
        });
        if (kind === "nuts") {
          object.quaternion.setFromRotationMatrix(
            new T.Matrix4().makeBasis(long, normal, cross),
          );
          object.add(new T.Mesh(new T.BoxGeometry(12, 3.8, 6), mat));
          const hole = new T.Mesh(
            new T.TorusGeometry(2.1, 0.65, 8, 20),
            new T.MeshStandardMaterial({ color: 0x61533a, roughness: 0.45 }),
          );
          hole.rotation.x = Math.PI / 2;
          hole.position.y = 2;
          object.add(hole);
        } else {
          object.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), normal);
          const head = new T.Mesh(
            new T.CylinderGeometry(3.8, 3.8, 2.5, 6),
            mat,
          );
          head.position.y = 6.6;
          const shank = new T.Mesh(
            new T.CylinderGeometry(2.4, 2.4, 7, 12),
            mat,
          );
          shank.position.y = 2.4;
          const socket = new T.Mesh(
            new T.CylinderGeometry(1.7, 1.7, 0.15, 6),
            new T.MeshStandardMaterial({ color: 0x303539 }),
          );
          socket.position.y = 7.91;
          object.add(head, shank, socket);
        }
        const end = vec(mount.p);
        const start =
          kind === "nuts"
            ? mount.insertion
              ? end.clone().add(vec(mount.insertion))
              : end
                  .clone()
                  .addScaledVector(
                    long,
                    -r.length / 2 -
                      24 -
                      (end.getComponent(ai(r.axis)) - r.p[ai(r.axis)]),
                  )
            : end.clone().addScaledVector(normal, 42);
        object.position.copy(start);
        this.hardware.add(object);
        this.moving.push({
          object,
          start,
          end,
          quaternion: object.quaternion.clone(),
          mount,
        });
        // Existing static hardware is replaced by the moving copy in this step.
        this.world.traverse((o) => {
          if (
            kind === "nuts" &&
            o.userData.id === mount.partId &&
            o.parent === this.world
          )
            o.visible = false;
          if (
            o.userData.hardware === "screw" &&
            o.userData.mountRailId === mount.railId &&
            o.userData.id === mount.partId
          )
            o.visible = false;
        });
        const path = new T.Line(
          new T.BufferGeometry().setFromPoints([start, end]),
          new T.LineDashedMaterial({
            color: 0xd8e2e8,
            dashSize: 4,
            gapSize: 3,
            transparent: true,
            opacity: 0.55,
          }),
        );
        path.computeLineDistances();
        this.hardware.add(path);
      }
    } else if (kind === "place") {
      const displacement = new T.Vector3(0, 65, 0).applyQuaternion(
        this.to.clone().invert(),
      );
      for (const id of step.motion!.partIds) {
        const object = this.world.children.find((o) => o.userData.id === id);
        if (!object) continue;
        const end = object.position.clone();
        this.moving.push({
          object,
          end,
          start: end.clone().add(displacement),
          quaternion: object.quaternion.clone(),
        });
      }
    }
    const size = this.box.getSize(new T.Vector3());
    const side = Math.max(600, size.length() + 240);
    const top = new T.Mesh(
      new T.BoxGeometry(side, 22, side),
      new T.MeshStandardMaterial({ color: 0x8a775d, roughness: 0.96 }),
    );
    top.position.y = -11;
    this.table.add(top);
    const rim = new T.LineSegments(
      new T.EdgesGeometry(top.geometry),
      new T.LineBasicMaterial({
        color: 0xc6b698,
        transparent: true,
        opacity: 0.6,
      }),
    );
    rim.position.copy(top.position);
    this.table.add(rim);
    // A few grain lines and a front edge make the work surface read as a table.
    for (let z = -side * 0.46; z < side * 0.48; z += side / 9) {
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(-side / 2, 0.05, z),
          new T.Vector3(side / 2, 0.05, z),
        ]),
        new T.LineBasicMaterial({
          color: 0xa99474,
          transparent: true,
          opacity: 0.16,
        }),
      );
      this.table.add(line);
    }
    this.elapsed = reset ? 0 : elapsed;
    this.sample();
  }
  replay() {
    this.elapsed = 0;
    this.sample();
  }
  update(dt: number, playing: boolean) {
    if (!this.step) return;
    if (playing && this.duration) {
      // Hold the seated result briefly, then repeat without stopping playback.
      this.elapsed =
        (this.elapsed + Math.max(0, Math.min(dt, 0.05))) %
        (this.duration + 0.8);
    }
    this.sample();
  }

  private sample() {
    if (!this.step) return;
    const kind = this.step.motion?.kind;
    const turn = kind === "turn" ? ease(this.elapsed / 3.1) : 1;
    this.root.quaternion.slerpQuaternions(this.from, this.to, turn);
    const lift =
      kind === "turn"
        ? Math.sin(Math.PI * turn) *
          Math.max(90, this.box.getSize(new T.Vector3()).length() * 0.17)
        : 0;
    this.root.position.copy(tablePose(this.box, this.root.quaternion, lift));
    let action = 0;
    this.moving.forEach((m, i) => {
      const state =
        kind === "nuts" || kind === "screws"
          ? insertionAt(this.elapsed, i, kind)
          : {
              progress: ease((this.elapsed - 0.2) / 2.1),
              turns: 0,
              visible: true,
              seated: this.elapsed >= 2.3,
            };
      m.object.position.lerpVectors(m.start, m.end, state.progress);
      m.object.quaternion.copy(m.quaternion);
      if (state.turns)
        m.object.quaternion.multiply(
          new T.Quaternion().setFromAxisAngle(
            new T.Vector3(0, 1, 0),
            state.turns * Math.PI * 2,
          ),
        );
      m.object.visible = state.visible;
      if (state.visible) action = i;
    });
    this.root.updateMatrixWorld(true);
    const moving = this.moving[action],
      mount = moving?.mount;
    const insetVisible = !!mount && (kind === "nuts" || kind === "screws");
    this.inset.hidden = !insetVisible;
    if (insetVisible) {
      const target = this.root.localToWorld(moving.object.position.clone());
      const normal = vec(mount.normal).applyQuaternion(this.root.quaternion);
      const offset = new T.Vector3(0.3, 0.4, 0.85).normalize();
      // Looking along the slot's outward normal makes the engagement visible.
      const cameraDirection = normal
        .clone()
        .multiplyScalar(1.4)
        .add(offset)
        .add(new T.Vector3(0, 0.55, 0))
        .normalize();
      this.detailCamera.position
        .copy(target)
        .addScaledVector(cameraDirection, kind === "nuts" ? 92 : 110);
      this.detailCamera.up.set(0, 1, 0);
      this.detailCamera.lookAt(target);
      this.inset.querySelector("small")!.textContent =
        `${kind === "nuts" ? "Slide T-nut" : "Insert & turn screw"} · ${action + 1} / ${this.moving.length}${mount.count > 1 ? ` · repeat at ${mount.count} holes` : ""}`;
    }
    const text =
      kind === "turn"
        ? this.elapsed >= this.duration
          ? "Set the joined frame down on the table before continuing."
          : "Hold both sides · lift · turn · lower onto the table"
        : kind === "place"
          ? "Support the moving part until its joint is secured"
          : kind === "nuts"
            ? "Open end → slide into slot → move to the shown position"
            : kind === "screws"
              ? "Align the screw → engage the nut → turn gently"
              : this.step.bench.label;
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.dataset.motion = kind ?? "none";
    this.status.dataset.progress = String(
      Math.min(1, this.duration ? this.elapsed / this.duration : 1),
    );
  }
  bounds(focus = false) {
    if (!this.step) return null;
    this.root.updateMatrixWorld(true);
    if (this.step.motion?.kind === "turn")
      return turnBounds(
        this.contextBox,
        this.from,
        this.to,
        this.box,
      ).expandByScalar(50);
    if (focus && this.step.mounts?.length) {
      const b = new T.Box3();
      this.step.mounts.forEach((m) =>
        b.expandByPoint(this.root.localToWorld(vec(m.p))),
      );
      return b.expandByScalar(this.step.motion?.kind === "nuts" ? 55 : 65);
    }
    const b = (focus ? this.box : this.contextBox)
      .clone()
      .applyMatrix4(this.root.matrixWorld);
    b.expandByScalar(50);
    return b;
  }
  renderInset(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    width: number,
    height: number,
  ) {
    if (this.inset.hidden || width < 350 || height < 280) {
      this.inset.style.display = "none";
      return;
    }
    this.inset.style.display = "";
    const w = Math.min(260, Math.floor(width * 0.34)),
      h = Math.round(w / 1.35),
      x = width - w - 14,
      y = 55;
    Object.assign(this.inset.style, {
      right: "14px",
      bottom: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    this.detailCamera.aspect = w / h;
    this.detailCamera.updateProjectionMatrix();
    const auto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.render(scene, this.detailCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.autoClear = auto;
  }
  dispose() {
    this.clear(this.hardware);
    this.clear(this.table);
    this.table.removeFromParent();
    this.hardware.removeFromParent();
    this.inset.remove();
    this.status.remove();
  }
}
