import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { flightKeys, flightOffset, rotateCameraInPlace } from "./navigation";
import { createRailGeometry, createBracketGeometry } from "./geometry";
import {
  attachments,
  nearbyAttachments,
  pickRail,
  halfSize,
} from "./attachment";
import type { Attachment } from "./attachment";
import { bracketInterference, newClearanceError } from "./clearance";
import {
  ai,
  axes,
  bounds,
  bracketAt,
  ORIENTS,
  orientOf,
  joinTouching,
  round,
  clone,
  expandedSelection,
  bracketFrame,
  holeOffset,
  moveParts,
  newRail,
  nextLabel,
  partPosition,
  rail,
  snap,
  uid,
} from "./model";
import type { Axis, Bracket, Nut, Part, Project, Rail, Vec } from "./model";

export type Placement =
  | { kind: "rail"; length: number; axis: Axis }
  | { kind: "bracket"; orient?: number }
  | { kind: "nut" }
  | null;
export type ViewConfig = {
  project: Project;
  selection: string[];
  placement: Placement;
  step: number;
  snapEnabled: boolean;
  attach: boolean;
  labels: boolean;
  dimensions: boolean;
  grid: boolean;
  tool: "select" | "measure";
  moveAxis: Axis | "plane";
};
export type ViewCallbacks = {
  select: (ids: string[]) => void;
  commit: (p: Project) => void;
  message: (s: string) => void;
  placed: () => void;
  measure: (n: number | null) => void;
  navigating: () => void;
};
function gradientBackground() {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#5a5d62");
  grad.addColorStop(1, "#2f3134");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
function textSprite(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 40px Tahoma, Verdana, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(text, 32, 34);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(
    new T.SpriteMaterial({ map: t, depthTest: false }),
  );
  sprite.scale.setScalar(0.6);
  return sprite;
}
const unit = (i: number) =>
  new T.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
const v3 = (p: Vec) => new T.Vector3(...p);
const dataVec = (v: T.Vector3) => v.toArray() as Vec;
type Drag = {
  start: Vec;
  base: Project;
  ids: string[];
  plane: T.Plane;
  axis?: Axis;
  from: [number, number];
  preview: Project;
  moved: boolean;
  /** Free drags decide on their first movement whether they go up/down. */
  decide?: boolean;
  /** Orientation chosen with R while dragging a bracket. */
  orient?: number;
};

export class Viewport {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera: T.OrthographicCamera | T.PerspectiveCamera;
  controls: OrbitControls;
  world = new T.Group();
  ghost = new T.Group();
  helpers = new T.Group();
  gridGroup = new T.Group();
  gizmo = new T.Group();
  ray = new T.Raycaster();
  mouse = new T.Vector2();
  cfg: ViewConfig;
  cb: ViewCallbacks;
  private cache = new Map<number, T.BufferGeometry>();
  private edgeCache = new Map<number, T.BufferGeometry>();
  private host: HTMLElement;
  private overlay: HTMLDivElement;
  private labels: { el: HTMLElement; p: T.Vector3 }[] = [];
  private drag: Drag | null = null;
  private candidate: Part | null = null;
  private frame = 0;
  private resize: ResizeObserver;
  private boxStart: [number, number] | null = null;
  private box: HTMLDivElement;
  private measureStart: T.Vector3 | null = null;
  private measurement = new T.Group();
  private lastPointer: PointerEvent | null = null;
  private scale = 680;
  private triadScene = new T.Scene();
  private triadCamera = new T.OrthographicCamera(-1.55, 1.55, 1.55, -1.55, 0.1, 10);
  private keys = new Set<string>();
  private fastFlight = false;
  private hovering = false;
  private looking: {
    x: number;
    y: number;
    pointer: number;
    button: number;
  } | null = null;
  private previousTime = performance.now();
  private contacts = new T.Group();
  private attachmentBar: HTMLDivElement;
  private choices: Attachment[] = [];
  private contact: Attachment | null = null;
  private cyclePointer: [number, number] | null = null;
  private review: { base: Project; id: string; project: Project } | null = null;
  private mat = new T.MeshStandardMaterial({
    color: 0xb6bfc4,
    metalness: 0.35,
    roughness: 0.65,
  });
  private bracketMat = new T.MeshStandardMaterial({
    color: 0x929b9f,
    metalness: 0.6,
    roughness: 0.43,
  });
  private selectedBracketMat = new T.MeshStandardMaterial({
    color: 0xe3bd76,
    metalness: 0.4,
    roughness: 0.42,
  });
  private screwMat = new T.MeshStandardMaterial({
    color: 0xd8dce0,
    metalness: 0.8,
    roughness: 0.27,
  });
  private nutMat = new T.MeshStandardMaterial({
    color: 0xbca472,
    metalness: 0.7,
    roughness: 0.33,
  });
  private selectedMat = new T.MeshStandardMaterial({
    color: 0xe3bd76,
    metalness: 0.4,
    roughness: 0.42,
  });
  private ghostMat = new T.MeshStandardMaterial({
    color: 0x6bbfb0,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  constructor(host: HTMLElement, cfg: ViewConfig, cb: ViewCallbacks) {
    this.host = host;
    this.cfg = cfg;
    this.cb = cb;
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      // Keep thin groove walls stable when a zoomed orthographic view becomes
      // a distant, narrow-field perspective view during camera navigation.
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x3d3f42);
    this.scene.background = gradientBackground();
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "3D frame workspace");
    host.append(this.renderer.domElement);
    this.camera = new T.PerspectiveCamera(45, 1, 0.5, 30000);
    this.camera.position.set(900, 740, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 175, 0);
    this.controls.enableDamping = false;
    this.controls.enableRotate = false;
    this.controls.dampingFactor = 0.15;
    this.controls.zoomSpeed = 1.2;
    this.controls.minZoom = 0.08;
    this.controls.maxZoom = 20;
    this.controls.mouseButtons = {
      LEFT: T.MOUSE.ROTATE,
      MIDDLE: T.MOUSE.PAN,
      RIGHT: T.MOUSE.PAN,
    };
    this.controls.update();
    this.scene.add(new T.HemisphereLight(0xe9f3ff, 0x41434b, 2));
    const light = new T.DirectionalLight(0xfff5e6, 3);
    light.position.set(400, 900, 600);
    this.scene.add(light);
    const rim = new T.DirectionalLight(0xd2e5ff, 1.4);
    rim.position.set(-600, 300, -400);
    this.scene.add(rim);
    const grid = new T.GridHelper(2400, 120, 0x55585c, 0x4a4d51);
    grid.position.y = -0.3;
    this.gridGroup.add(grid);
    const major = new T.GridHelper(2400, 24, 0x606368, 0x575a5e);
    major.position.y = -0.2;
    this.gridGroup.add(major);
    for (const [axis, color] of [
      [0, 0xa4605c],
      [2, 0x5c7fa4],
    ] as const) {
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([
          unit(axis).multiplyScalar(-1200),
          unit(axis).multiplyScalar(1200),
        ]),
        new T.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
      );
      this.gridGroup.add(line);
    }
    this.scene.add(
      this.world,
      this.ghost,
      this.helpers,
      this.gridGroup,
      this.gizmo,
      this.measurement,
      this.contacts,
    );
    const colors = ["#e0716b", "#8fc45f", "#6fa2de"];
    for (let i = 0; i < 3; i++) {
      const dir = unit(i);
      this.triadScene.add(
        new T.ArrowHelper(dir, new T.Vector3(), 1, colors[i], 0.28, 0.14),
      );
      const label = textSprite("XYZ"[i], colors[i]);
      label.position.copy(dir.multiplyScalar(1.3));
      this.triadScene.add(label);
    }
    this.overlay = document.createElement("div");
    this.overlay.className = "scene-labels";
    host.append(this.overlay);
    this.box = document.createElement("div");
    this.box.className = "selection-box";
    this.box.hidden = true;
    host.append(this.box);
    this.attachmentBar = document.createElement("div");
    this.attachmentBar.className = "attachment-choices";
    this.attachmentBar.setAttribute("role", "group");
    this.attachmentBar.setAttribute("aria-label", "Attachment alternatives");
    this.attachmentBar.hidden = true;
    host.append(this.attachmentBar);
    window.addEventListener("keydown", this.attachmentKey, true);
    this.resize = new ResizeObserver(() => this.size());
    this.resize.observe(host);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.down, true);
    canvas.addEventListener("pointermove", this.move, true);
    canvas.addEventListener("pointerup", this.up, true);
    canvas.addEventListener("pointercancel", this.cancel, true);
    canvas.addEventListener("lostpointercapture", this.stopLook);
    canvas.addEventListener("pointerenter", this.enter);
    canvas.addEventListener("pointerleave", this.leave);
    window.addEventListener("keydown", this.navigationDown);
    window.addEventListener("keyup", this.navigationUp);
    window.addEventListener("blur", this.stopNavigation);
    window.addEventListener("focusin", this.focusChanged);
    document.addEventListener("visibilitychange", this.stopNavigation);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    host.addEventListener("dragover", this.dragover);
    host.addEventListener("drop", this.drop);
    this.update(cfg);
    this.size();
    this.animate();
  }
  private size = () => {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    if (this.camera instanceof T.OrthographicCamera) {
      this.camera.left = (-this.scale * w) / h / 2;
      this.camera.right = (this.scale * w) / h / 2;
      this.camera.top = this.scale / 2;
      this.camera.bottom = -this.scale / 2;
    } else this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    this.moveCamera((now - this.previousTime) / 1000);
    this.previousTime = now;
    if (!this.looking) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderTriad(h);
    for (const l of this.labels) {
      const p = l.p.clone().project(this.camera);
      l.el.style.transform = `translate(${((p.x + 1) * w) / 2}px,${((-p.y + 1) * h) / 2}px) translate(-50%,-50%)`;
      l.el.hidden = p.z > 1 || p.z < -1;
    }
    // Keep the move arrows the same size on screen (about 90 px long).
    let perPixel: number;
    if (this.camera instanceof T.PerspectiveCamera) {
      const d = this.camera.position.distanceTo(this.gizmo.position);
      perPixel =
        (2 * d * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2))) /
        this.camera.zoom /
        Math.max(1, h);
    } else
      perPixel =
        (this.camera.top - this.camera.bottom) /
        this.camera.zoom /
        Math.max(1, h);
    this.gizmo.scale.setScalar((90 * perPixel) / 60);
  };
  private renderTriad(h: number) {
    const size = 96;
    const dir = this.camera.getWorldDirection(new T.Vector3());
    this.triadCamera.position.copy(dir.multiplyScalar(-4));
    this.triadCamera.quaternion.copy(this.camera.quaternion);
    this.triadCamera.updateMatrixWorld();
    const r = this.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    r.setScissorTest(true);
    r.setViewport(6, 6, size, size);
    r.setScissor(6, 6, size, size);
    r.clearDepth();
    const bg = this.triadScene.background;
    r.render(this.triadScene, this.triadCamera);
    this.triadScene.background = bg;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.host.clientWidth, h);
    r.autoClear = auto;
  }
  private enter = () => {
    this.hovering = true;
  };
  private leave = () => {
    this.hovering = false;
    if (!this.looking) this.keys.clear();
  };
  private focusChanged = () => {
    if (document.activeElement !== this.renderer.domElement)
      this.stopNavigation();
  };
  private stopLook = () => {
    const look = this.looking;
    this.looking = null;
    if (look && this.renderer.domElement.hasPointerCapture(look.pointer))
      this.renderer.domElement.releasePointerCapture(look.pointer);
    this.controls.enabled = !this.drag && !this.boxStart;
    this.controls.enableDamping = false;
    this.host.classList.remove("camera-look");
  };
  private stopNavigation = () => {
    this.keys.clear();
    this.fastFlight = false;
    this.stopLook();
  };
  private navigationDown = (e: KeyboardEvent) => {
    if (
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.key === "Escape" ||
      document.querySelector('[role="dialog"]') ||
      (e.target as HTMLElement)?.closest(
        'input,textarea,select,[contenteditable="true"]',
      )
    ) {
      this.stopNavigation();
      return;
    }
    if (
      (!this.hovering && document.activeElement !== this.renderer.domElement) ||
      this.drag ||
      this.boxStart
    )
      return;
    this.fastFlight = e.shiftKey;
    const key = e.key.toLowerCase();
    if (!flightKeys.has(key)) return;
    e.preventDefault();
    this.usePerspective();
    const starting = !this.keys.has(key);
    this.keys.add(key);
    // Register short taps even when keyup arrives between animation frames.
    if (starting) this.moveCamera(1 / 60);
  };
  private navigationUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
    this.fastFlight = e.shiftKey;
  };
  private moveCamera(seconds: number) {
    if (!this.keys.size || this.drag || this.boxStart) return;
    const offset = flightOffset(
      this.camera.quaternion,
      this.keys,
      Math.max(100, this.scale * 0.7),
      seconds,
      this.fastFlight,
    );
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    if (this.cfg.placement) this.refreshPlacement();
  }
  private usePerspective() {
    if (this.camera instanceof T.PerspectiveCamera) return;
    const old = this.camera;
    const distance = Math.max(
      0.5,
      old.position.distanceTo(this.controls.target),
    );
    const fov = T.MathUtils.radToDeg(
      2 * Math.atan(this.scale / old.zoom / (2 * distance)),
    );
    this.camera = new T.PerspectiveCamera(
      T.MathUtils.clamp(fov, 1, 150),
      this.host.clientWidth / this.host.clientHeight,
      0.5,
      30000,
    );
    this.camera.position.copy(old.position);
    this.camera.quaternion.copy(old.quaternion);
    this.controls.object = this.camera;
    this.controls.update();
    this.cb.navigating();
  }
  update(cfg: ViewConfig) {
    if (
      this.review &&
      (cfg.project !== this.review.project ||
        !cfg.selection.includes(this.review.id))
    )
      this.resetAttachment();
    if (!cfg.attach || (this.cfg.placement !== cfg.placement && !this.review))
      this.resetAttachment();
    const placementChanged = cfg.placement !== this.cfg.placement;
    this.cfg = cfg;
    this.gridGroup.visible = cfg.grid;
    this.rebuild(cfg.project);
    if (!cfg.placement) {
      this.clearGroup(this.ghost);
      this.candidate = null;
    }
    this.host.dataset.tool = cfg.placement ? "place" : cfg.tool;
    if (cfg.placement && placementChanged) this.refreshPlacement();
  }
  private clearGroup(g: T.Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((o) => {
        if (
          o instanceof T.LineSegments ||
          o instanceof T.Mesh ||
          o instanceof T.Line
        ) {
          if (
            ![...this.cache.values(), ...this.edgeCache.values()].includes(
              o.geometry,
            )
          )
            o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => {
            if (
              ![
                this.mat,
                this.bracketMat,
                this.selectedBracketMat,
                this.screwMat,
                this.nutMat,
                this.selectedMat,
                this.ghostMat,
              ].includes(m as T.MeshStandardMaterial)
            )
              m.dispose();
          });
        }
      });
    }
  }
  private railGeometry(length: number) {
    if (this.cache.has(length)) return this.cache.get(length)!;
    const geom = createRailGeometry(length);
    this.cache.set(length, geom);
    this.edgeCache.set(length, new T.EdgesGeometry(geom, 30));
    return geom;
  }
  private meshPart(part: Part, parts: Part[], ghost = false) {
    const group = new T.Group();
    group.userData.id = part.id;
    const selected = this.cfg.selection.includes(part.id);
    const material = ghost
      ? this.ghostMat
      : selected
        ? part.kind === "bracket"
          ? this.selectedBracketMat
          : this.selectedMat
        : part.kind === "rail"
          ? this.mat
          : part.kind === "nut"
            ? this.nutMat
            : this.bracketMat;
    if (part.kind === "rail") {
      const mesh = new T.Mesh(this.railGeometry(part.length), material);
      if (part.axis === "x") mesh.rotation.y = Math.PI / 2;
      if (part.axis === "y") mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      const edges = new T.LineSegments(
        this.edgeCache.get(part.length),
        new T.LineBasicMaterial({
          color: selected ? 0xd49d48 : 0x242c31,
          transparent: true,
          opacity: ghost ? 0.1 : 0.23,
        }),
      );
      edges.rotation.copy(mesh.rotation);
      group.add(edges);
      group.position.fromArray(part.p);
    } else if (part.kind === "nut") {
      const r = rail(parts, part.rail);
      if (!r) return group;
      const normal = unit(ai(part.face)).multiplyScalar(part.sign),
        long = unit(ai(r.axis)),
        cross = new T.Vector3().crossVectors(long, normal);
      const basis = new T.Matrix4().makeBasis(long, normal, cross);
      group.quaternion.setFromRotationMatrix(basis);
      group.position.fromArray(partPosition(part, parts));
      const geom = new T.BoxGeometry(12, 3.8, 6);
      group.add(new T.Mesh(geom, material));
      const ring = new T.Mesh(
        new T.TorusGeometry(2.1, 0.7, 8, 16),
        ghost
          ? material
          : new T.MeshStandardMaterial({
              color: 0x756348,
              metalness: 0.6,
              roughness: 0.4,
            }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 2;
      group.add(ring);
    } else {
      const f = bracketFrame(part, parts);
      if (!f) return group;
      const u = unit(f.u[0]).multiplyScalar(f.u[1]),
        v = unit(f.v[0]).multiplyScalar(f.v[1]),
        w = new T.Vector3().crossVectors(u, v);
      const basis = new T.Matrix4().makeBasis(u, v, w);
      group.quaternion.setFromRotationMatrix(basis);
      group.position.copy(v3(f.origin));
      group.add(new T.Mesh(createBracketGeometry(), material));
      const shape = new T.Shape();
      shape.moveTo(2.8, 2.8);
      shape.lineTo(27, 2.8);
      shape.lineTo(2.8, 27);
      shape.closePath();
      for (const z of [-8, 6]) {
        const g = new T.ExtrudeGeometry(shape, {
          depth: 2,
          bevelEnabled: false,
        });
        g.translate(0, 0, z);
        group.add(new T.Mesh(g, material));
      }
      // Each attachment point: screw head, shank through the leg, and the
      // T-nut it threads into, sitting in the frame's slot under the leg.
      const h = holeOffset(part, parts);
      const local = (world: number) =>
        world === f.u[0] ? "x" : world === f.v[0] ? "y" : "z";
      const partner = part.b ? rail(parts, part.b) : undefined;
      const host = rail(parts, part.a)!;
      const legs: { along: "x" | "y"; slot: "x" | "y" | "z" }[] = [
        { along: "x", slot: local(ai(host.axis)) },
      ];
      if (partner) legs.push({ along: "y", slot: local(ai(partner.axis)) });
      for (const leg of legs) {
        const across = leg.along === "x" ? "y" : "x";
        const at = (h: number, out: number) => {
          const v = new T.Vector3();
          v[leg.along] = h;
          v[across] = out;
          return v;
        };
        const head = new T.Mesh(
          new T.CylinderGeometry(3.8, 3.8, 2.5, 6),
          ghost ? material : this.screwMat,
        );
        head.position.copy(at(h, 4.2));
        const shank = new T.Mesh(
          new T.CylinderGeometry(2.4, 2.4, 7, 10),
          ghost ? material : this.screwMat,
        );
        shank.position.copy(at(h, 0));
        const nut = new T.Mesh(
          new T.BoxGeometry(
            leg.slot === "x" ? 12 : across === "x" ? 3.8 : 6,
            leg.slot === "y" ? 12 : across === "y" ? 3.8 : 6,
            leg.slot === "z" ? 12 : 6,
          ),
          ghost ? material : this.nutMat,
        );
        nut.position.copy(at(h, -2.4));
        if (across === "x") {
          head.rotation.z = Math.PI / 2;
          shank.rotation.z = Math.PI / 2;
        }
        group.add(head, shank, nut);
      }
    }
    group.traverse((o) => {
      o.userData.id = part.id;
    });
    return group;
  }
  private label(text: string, p: T.Vector3, kind = "part-label") {
    const el = document.createElement("span");
    el.className = kind;
    el.textContent = text;
    this.overlay.append(el);
    this.labels.push({ el, p });
  }
  private rebuild(project: Project) {
    this.clearGroup(this.world);
    this.clearGroup(this.helpers);
    this.clearGroup(this.gizmo);
    this.overlay.replaceChildren();
    this.labels = [];
    for (const part of project.parts) {
      if (part.hidden) continue;
      this.world.add(
        this.meshPart(
          part,
          project.parts,
          !!this.drag?.moved && this.drag.ids.includes(part.id),
        ),
      );
      if (this.cfg.labels && part.kind === "rail")
        this.label(
          part.label,
          v3(partPosition(part, project.parts)).add(new T.Vector3(0, 15, 0)),
        );
    }
    const selected = project.parts.filter(
      (p) => this.cfg.selection.includes(p.id) && !p.hidden,
    );
    for (const p of selected) {
      if (p.kind === "rail") {
        const b = new T.Box3().setFromCenterAndSize(
          v3(p.p),
          new T.Vector3(...axes.map((a) => (a === p.axis ? p.length + 2 : 22))),
        );
        this.helpers.add(new T.Box3Helper(b, 0xe1b168));
      }
    }
    if (this.cfg.dimensions) {
      const b = bounds(project.parts);
      if (b.size.some((v) => v > 0)) {
        const o = new T.Vector3(b.min[0] - 35, b.min[1], b.max[2] + 45);
        for (let i = 0; i < 3; i++) {
          const start = o.clone(),
            end = o.clone().addScaledVector(unit(i), b.size[i]);
          this.dimension(start, end, `${b.size[i]} mm`);
        }
      }
    }
    if (
      selected.length === 1 &&
      selected[0].kind === "rail" &&
      !this.cfg.dimensions
    ) {
      const p = selected[0],
        i = ai(p.axis),
        a = v3(p.p).addScaledVector(unit(i), -p.length / 2),
        b = v3(p.p).addScaledVector(unit(i), p.length / 2);
      const offset = unit(i === 1 ? 0 : 1).multiplyScalar(24);
      this.dimension(a.add(offset), b.add(offset), `${p.length} mm`);
    }
    if (selected.length && !this.cfg.placement && this.cfg.tool === "select") {
      const center = new T.Vector3();
      selected.forEach((p) => center.add(v3(partPosition(p, project.parts))));
      center.divideScalar(selected.length);
      this.gizmo.position.copy(center);
      for (let i = 0; i < 3; i++) {
        const color = [0xe0716b, 0x8fc45f, 0x6fa2de][i];
        // Drawn on top of everything so the arrows never hide in a frame.
        const mat = new T.MeshBasicMaterial({ color, depthTest: false });
        const arrow = new T.Group();
        const shaft = new T.Mesh(new T.CylinderGeometry(1.4, 1.4, 48, 8), mat);
        shaft.position.y = 24;
        const tip = new T.Mesh(new T.ConeGeometry(5, 13, 14), mat);
        tip.position.y = 54;
        arrow.add(shaft, tip);
        arrow.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), unit(i));
        arrow.renderOrder = 20;
        arrow.traverse((o) => {
          o.userData.axis = axes[i];
          o.renderOrder = 20;
        });
        this.gizmo.add(arrow);
        const target = new T.Mesh(
          new T.CylinderGeometry(9, 9, 65, 8),
          new T.MeshBasicMaterial({ visible: false }),
        );
        target.position.copy(unit(i).multiplyScalar(32.5));
        target.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), unit(i));
        target.userData.axis = axes[i];
        this.gizmo.add(target);
      }
    }
  }
  private dimension(a: T.Vector3, b: T.Vector3, text: string) {
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints([a, b]),
      new T.LineBasicMaterial({
        color: 0xa9b4bd,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.helpers.add(line);
    for (const p of [a, b]) {
      const d = new T.Mesh(
        new T.SphereGeometry(2, 6, 6),
        new T.MeshBasicMaterial({ color: 0xa9b4bd, depthTest: false }),
      );
      d.position.copy(p);
      this.helpers.add(d);
    }
    this.label(text, a.clone().lerp(b, 0.5), "dimension-label");
  }
  private setRay(e: { clientX: number; clientY: number }) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.mouse, this.camera);
  }
  private hits(detailed = false) {
    const physical = this.ray
      .intersectObjects(this.world.children, true)
      .filter((h) => h.object instanceof T.Mesh);
    if (detailed) return physical;
    const parts = this.drag?.preview.parts || this.cfg.project.parts;
    const result = physical.filter((h) => !rail(parts, h.object.userData.id));
    for (const p of parts) {
      if (p.kind !== "rail" || p.hidden) continue;
      const hit = pickRail(this.ray.ray, p);
      const object = this.world.children.find((o) => o.userData.id === p.id);
      if (hit && object)
        result.push({
          distance: hit.distance,
          point: hit.point,
          object,
          normal: hit.normal,
          face: { normal: hit.normal, a: 0, b: 0, c: 0, materialIndex: 0 },
        });
    }
    return result.sort((a, b) => a.distance - b.distance);
  }
  private planePoint(plane: T.Plane) {
    return this.ray.ray.intersectPlane(plane, new T.Vector3());
  }
  private cameraPlane(p: T.Vector3) {
    const normal = this.camera.getWorldDirection(new T.Vector3());
    return new T.Plane().setFromNormalAndCoplanarPoint(normal, p);
  }
  private movePlane(p: T.Vector3, axis?: Axis) {
    if (axis) {
      const a = unit(ai(axis)),
        dir = this.camera.getWorldDirection(new T.Vector3()),
        normal = dir.clone().addScaledVector(a, -dir.dot(a));
      if (normal.length() < 0.01) normal.copy(unit((ai(axis) + 1) % 3));
      return new T.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), p);
    }
    const dir = this.camera.getWorldDirection(new T.Vector3());
    return Math.abs(dir.y) > 0.2
      ? new T.Plane(new T.Vector3(0, 1, 0), -p.y)
      : this.cameraPlane(p);
  }
  private resetAttachment() {
    this.choices = [];
    this.contact = null;
    this.review = null;
    this.cyclePointer = null;
    this.clearGroup(this.contacts);
    if (this.attachmentBar) this.attachmentBar.hidden = true;
  }
  private showAttachment(
    moving: Rail,
    choices: Attachment[],
    selected: Attachment,
  ) {
    this.choices = choices;
    this.contact = selected;
    this.clearGroup(this.contacts);
    for (const [r, sign] of [
      [selected.host, selected.sign],
      [moving, -selected.sign],
    ] as const) {
      const i = ai(selected.axis);
      const lo = axes.map((_, j) =>
        Math.max(
          moving.p[j] - halfSize(moving, j),
          selected.host.p[j] - halfSize(selected.host, j),
        ),
      );
      const hi = axes.map((_, j) =>
        Math.min(
          moving.p[j] + halfSize(moving, j),
          selected.host.p[j] + halfSize(selected.host, j),
        ),
      );
      const size = axes.map((_, j) =>
        j === i ? 0.12 : Math.min(hi[j] - lo[j], 36),
      ) as Vec;
      const face = new T.Mesh(
        new T.BoxGeometry(...size),
        new T.MeshBasicMaterial({
          color: 0x78c8b6,
          transparent: true,
          opacity: 0.45,
          depthTest: false,
          depthWrite: false,
        }),
      );
      face.position.fromArray(r.p);
      for (let j = 0; j < 3; j++)
        if (j !== i) face.position.setComponent(j, (lo[j] + hi[j]) / 2);
      face.position.setComponent(i, r.p[i] + sign * (halfSize(r, i) + 0.12));
      this.contacts.add(face);
    }
    this.attachmentBar.replaceChildren();
    for (const direction of [-1, 0, 1]) {
      if (!direction) {
        const text = document.createElement("span");
        text.textContent = `${selected.label} · ${choices.findIndex((c) => c.key === selected.key) + 1}/${choices.length}`;
        this.attachmentBar.append(text);
      } else {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = direction < 0 ? "‹" : "›";
        button.title =
          direction < 0
            ? "Previous attachment (Shift+Tab)"
            : "Next attachment (Tab)";
        button.setAttribute(
          "aria-label",
          direction < 0 ? "Previous attachment" : "Next attachment",
        );
        button.disabled = choices.length < 2;
        button.onpointerdown = (e) => e.stopPropagation();
        button.onclick = () => this.cycleAttachment(direction);
        this.attachmentBar.append(button);
      }
    }
    this.attachmentBar.hidden = false;
  }
  private attachmentKey = (e: KeyboardEvent) => {
    if (
      e.key !== "Tab" ||
      !this.contact ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      document.querySelector('[role="dialog"]') ||
      (e.target as HTMLElement)?.closest(
        'input,textarea,select,[contenteditable="true"]',
      )
    )
      return;
    if (
      !this.drag &&
      !this.cfg.placement &&
      document.activeElement !== this.renderer.domElement &&
      !this.attachmentBar.contains(document.activeElement)
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.cycleAttachment(e.shiftKey ? -1 : 1);
  };
  private cycleAttachment(direction: number) {
    if (!this.contact || this.choices.length < 2) return;
    const index = this.choices.findIndex((c) => c.key === this.contact!.key);
    const next =
      this.choices[
        (index + direction + this.choices.length) % this.choices.length
      ];
    this.contact = next;
    if (this.lastPointer)
      this.cyclePointer = [this.lastPointer.clientX, this.lastPointer.clientY];
    if (
      this.cfg.placement?.kind === "rail" &&
      this.candidate?.kind === "rail"
    ) {
      this.candidate = { ...this.candidate, p: [...next.p] };
      this.clearGroup(this.ghost);
      this.ghost.add(
        this.meshPart(this.candidate, this.cfg.project.parts, true),
      );
      this.showAttachment(this.candidate, this.choices, next);
    } else {
      const base = this.drag?.base || this.review?.base,
        id = this.drag?.ids[0] || this.review?.id;
      const moving = base && id && rail(base.parts, id);
      if (!moving || !base || !id) return;
      const result = moveParts(
        base,
        [id],
        next.p.map((v, i) => v - moving.p[i]) as Vec,
      );
      if (result.error) {
        this.cb.message(result.error);
        return;
      }
      if (this.drag) this.drag.preview = result.project;
      else if (this.review) {
        this.review.project = result.project;
        this.cb.commit(result.project);
      }
      this.rebuild(result.project);
      this.showAttachment(rail(result.project.parts, id)!, this.choices, next);
    }
    this.renderer.domElement.focus({ preventScroll: true });
  }
  private placementAt(e: PointerEvent | DragEvent) {
    this.setRay(e);
    const place = this.cfg.placement;
    if (!place) return;
    this.candidate = null;
    this.clearGroup(this.ghost);
    const hits = this.hits(place.kind === "nut");
    const railHit =
      place.kind === "bracket"
        ? hits.find((h) => rail(this.cfg.project.parts, h.object.userData.id))
        : undefined;
    const hit = hits[0],
      near =
        hit?.point || this.planePoint(this.movePlane(new T.Vector3(0, 10, 0)));
    const step = this.cfg.snapEnabled && !e.altKey ? this.cfg.step : 0;
    if (place.kind === "rail") {
      let p: Vec = near ? dataVec(near) : [0, 10, 0];
      p = p.map((v) => snap(v, step)) as Vec;
      if (!hit) {
        const groundHeight = place.axis === "y" ? place.length / 2 : 10;
        p[1] =
          Math.abs(this.camera.getWorldDirection(new T.Vector3()).y) > 0.2
            ? groundHeight
            : Math.max(groundHeight, p[1]);
      }
      let selected: Attachment | undefined;
      let choices: Attachment[] = [];
      if (this.cfg.attach && !e.altKey && hit) {
        const host = rail(this.cfg.project.parts, hit.object.userData.id);
        if (host) {
          const moving = newRail(
            this.cfg.project.parts,
            place.length,
            place.axis,
            p,
          );
          choices = attachments(
            moving,
            host,
            dataVec(hit.point),
            step,
            this.cfg.project.parts,
          );
          const normal = hit.normal || hit.face?.normal;
          selected =
            choices.find((c) => c.key === this.contact?.key) ||
            choices.find(
              (c) => normal && normal.getComponent(ai(c.axis)) * c.sign > 0.9,
            ) ||
            choices[0];
          if (selected) p = [...selected.p];
        }
      }
      this.candidate = newRail(
        this.cfg.project.parts,
        place.length,
        place.axis,
        p,
      );
      if (selected)
        this.showAttachment(this.candidate as Rail, choices, selected);
      else this.resetAttachment();
    } else if (place.kind === "nut") {
      const r = hit && rail(this.cfg.project.parts, hit.object.userData.id);
      if (r) {
        const { face, sign } = this.faceAt(r, hit.point);
        this.candidate = {
          kind: "nut",
          id: uid(),
          label: nextLabel(this.cfg.project.parts, "nut"),
          rail: r.id,
          face,
          sign,
          offset: Math.max(
            -r.length / 2 + 5,
            Math.min(
              r.length / 2 - 5,
              snap(hit.point.getComponent(ai(r.axis)) - r.p[ai(r.axis)], step),
            ),
          ),
        };
        this.highlightSlot(r, face, sign);
      }
    } else {
      // A bracket goes on whichever frame face is under the cursor.
      const r =
        railHit && rail(this.cfg.project.parts, railHit.object.userData.id);
      if (r) {
        const { face, sign } = this.faceAt(r, railHit!.point);
        const res = bracketAt(
          this.cfg.project.parts,
          r,
          face,
          sign,
          dataVec(railHit!.point),
          { orient: place.orient, step, join: this.cfg.attach && !e.altKey },
        );
        if (res.bracket) {
          this.candidate = res.bracket;
          this.highlightSlot(r, face, sign);
          this.cb.message(
            res.bracket.b
              ? `Joins ${r.label} + ${rail(this.cfg.project.parts, res.bracket.b)?.label} · R rotate · Alt: don't join`
              : `On ${r.label} · R rotate · drop it against another frame to join them`,
          );
        } else this.cb.message(res.error);
      }
    }
    if (this.candidate)
      this.ghost.add(
        this.meshPart(this.candidate, this.cfg.project.parts, true),
      );
    this.host.classList.toggle("valid-placement", !!this.candidate);
  }
  /** The face of frame r nearest to a point on it. */
  private faceAt(r: Rail, point: T.Vector3) {
    const radial = point.clone().sub(v3(r.p));
    const face = axes
      .filter((a) => a !== r.axis)
      .sort(
        (a, b) =>
          Math.abs(radial.getComponent(ai(b))) -
          Math.abs(radial.getComponent(ai(a))),
      )[0];
    return { face, sign: Math.sign(radial.getComponent(ai(face))) || 1 };
  }
  /** Orientation (0-3) of the bracket being previewed, for rotating it. */
  candidateOrient() {
    return this.candidate?.kind === "bracket" ? orientOf(this.candidate) : undefined;
  }
  /** R while dragging a placed bracket turns it 90° in place. */
  rotateDraggedBracket() {
    const d = this.drag;
    if (!d || d.ids.length !== 1) return false;
    const br = d.base.parts.find((p) => p.id === d.ids[0]);
    if (br?.kind !== "bracket") return false;
    const shown = d.preview.parts.find((p) => p.id === br.id) as Bracket;
    d.orient = ((d.orient ?? orientOf(shown)) + 1) % ORIENTS.length;
    d.moved = true;
    if (this.lastPointer) this.move(this.lastPointer);
    return true;
  }
  /** Drop a part dragged in from the shelf at the pointer. */
  dropAt(e: PointerEvent) {
    this.lastPointer = e;
    this.placementAt(e);
    this.place();
  }
  private highlightSlot(r: Rail, face: Axis, sign: number) {
    const size = axes.map((a) =>
      a === r.axis ? r.length : a === face ? 1 : 5,
    ) as Vec;
    const strip = new T.Mesh(
      new T.BoxGeometry(...size),
      new T.MeshBasicMaterial({
        color: 0x78c8b6,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
      }),
    );
    strip.position.fromArray(r.p);
    strip.position.setComponent(ai(face), r.p[ai(face)] + sign * 10.5);
    this.ghost.add(strip);
  }
  private place() {
    if (!this.candidate) {
      this.cb.message(
        this.cfg.placement?.kind === "bracket"
          ? "Point at a frame face to put the bracket on"
          : "Point to a frame slot",
      );
      return;
    }
    const p = clone(this.cfg.project);
    p.parts.push(this.candidate);
    joinTouching(p.parts);
    const clearance = newClearanceError(this.cfg.project.parts, p.parts);
    if (clearance) {
      this.cb.message(clearance);
      return;
    }
    if (this.candidate.kind === "rail" && this.contact)
      this.review = { base: p, id: this.candidate.id, project: p };
    this.cb.commit(p);
    this.cb.select([this.candidate.id]);
    this.cb.message(`${this.candidate.label} placed`);
    this.cb.placed();
    this.candidate = null;
    this.clearGroup(this.ghost);
  }
  private startLook(e: PointerEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
    this.renderer.domElement.focus();
    this.usePerspective();
    this.controls.enabled = false;
    this.looking = {
      x: e.clientX,
      y: e.clientY,
      pointer: e.pointerId,
      button: e.button,
    };
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.host.classList.add("camera-look");
    this.clearGroup(this.ghost);
  }
  private down = (e: PointerEvent) => {
    if (e.button === 2 && !e.shiftKey && !this.drag && !this.boxStart) {
      this.startLook(e);
      return;
    }
    if (this.looking) {
      e.stopImmediatePropagation();
      return;
    }
    if (e.button !== 0) return;
    this.lastPointer = e;
    this.setRay(e);
    this.renderer.domElement.focus();
    if (this.cfg.placement) {
      e.stopImmediatePropagation();
      this.placementAt(e);
      this.place();
      return;
    }
    this.resetAttachment();
    if (this.cfg.tool === "measure") {
      e.stopImmediatePropagation();
      const point =
        this.hits()[0]?.point ||
        this.planePoint(new T.Plane(new T.Vector3(0, 1, 0), 0));
      if (point) {
        if (!this.measureStart) {
          this.measureStart = point;
          this.cb.message("Select a second point");
        } else {
          this.clearGroup(this.measurement);
          this.measurement.add(
            new T.Line(
              new T.BufferGeometry().setFromPoints([this.measureStart, point]),
              new T.LineBasicMaterial({ color: 0xe6c887, depthTest: false }),
            ),
          );
          this.cb.measure(this.measureStart.distanceTo(point));
          this.measureStart = null;
        }
      }
      return;
    }
    const gizmoHit = this.ray.intersectObjects(this.gizmo.children, true)[0];
    const hit = this.hits()[0];
    if (!hit && !gizmoHit) {
      e.stopImmediatePropagation();
      this.boxStart = [e.clientX, e.clientY];
      this.box.hidden = false;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (!hit && !gizmoHit) {
      e.stopImmediatePropagation();
      this.cb.select([]);
      return;
    }
    e.stopImmediatePropagation();
    const id = gizmoHit ? this.cfg.selection[0] : hit.object.userData.id;
    let ids = this.cfg.selection;
    if (!gizmoHit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        ids = ids.includes(id)
          ? ids.filter((x) => x !== id)
          : expandedSelection(this.cfg.project.parts, [...ids, id]);
        this.cb.select(ids);
        return;
      } else if (!ids.includes(id)) {
        ids = expandedSelection(this.cfg.project.parts, [id]);
        this.cb.select(ids);
      }
    }
    const p = this.cfg.project.parts.find((p) => p.id === id);
    if (!p || p.locked) {
      if (p?.locked) this.cb.message(`${p.label} is locked`);
      return;
    }
    let axis: Axis | undefined =
      gizmoHit?.object.userData.axis ||
      (p.kind === "nut"
        ? rail(this.cfg.project.parts, p.rail)?.axis
        : p.kind === "bracket"
          ? rail(this.cfg.project.parts, p.a)?.axis
        : this.cfg.moveAxis === "plane"
          ? undefined
          : this.cfg.moveAxis);
    if (!axis) {
      const allowed = axes.filter((_, i) => {
        const d: Vec = [0, 0, 0];
        d[i] = 0.5;
        return (
          !moveParts(this.cfg.project, ids, d).error ||
          !moveParts(this.cfg.project, ids, d.map((v) => -v) as Vec).error
        );
      });
      if (allowed.length === 1) axis = allowed[0];
    }
    const plane = this.movePlane(
      v3(partPosition(p, this.cfg.project.parts)),
      axis,
    );
    const point = this.planePoint(plane);
    if (!point) return;
    this.drag = {
      start: dataVec(point),
      base: clone(this.cfg.project),
      ids,
      plane,
      axis,
      from: [e.clientX, e.clientY],
      preview: this.cfg.project,
      moved: false,
      decide: !axis && Math.abs(plane.normal.y) > 0.99,
    };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private move = (e: PointerEvent) => {
    if (this.looking) {
      e.stopImmediatePropagation();
      rotateCameraInPlace(
        this.camera,
        this.controls.target,
        e.clientX - this.looking.x,
        e.clientY - this.looking.y,
      );
      this.looking.x = e.clientX;
      this.looking.y = e.clientY;
      return;
    }
    this.lastPointer = e;
    if (this.boxStart) {
      const r = this.host.getBoundingClientRect(),
        [x, y] = this.boxStart;
      Object.assign(this.box.style, {
        left: `${Math.min(x, e.clientX) - r.left}px`,
        top: `${Math.min(y, e.clientY) - r.top}px`,
        width: `${Math.abs(e.clientX - x)}px`,
        height: `${Math.abs(e.clientY - y)}px`,
      });
      return;
    }
    if (this.cfg.placement) {
      this.placementAt(e);
      return;
    }
    if (!this.drag) return;
    this.setRay(e);
    const drag = this.drag,
      point = this.planePoint(drag.plane);
    if (!point) return;
    if (
      Math.hypot(e.clientX - drag.from[0], e.clientY - drag.from[1]) < 3 &&
      !drag.moved
    )
      return;
    drag.moved = true;
    if (drag.decide) {
      // A drag that starts out going up or down the screen, along a vertical
      // edge, moves the part vertically; anything else slides on the floor.
      drag.decide = false;
      const origin = v3(drag.start),
        a = origin.clone().project(this.camera),
        rect = this.renderer.domElement.getBoundingClientRect();
      // Screen movement per 100 mm along each axis.
      const screen = [0, 1, 2].map((i) => {
        const b = origin.clone().addScaledVector(unit(i), 100).project(this.camera);
        return new T.Vector2(
          ((b.x - a.x) * rect.width) / 2,
          (-(b.y - a.y) * rect.height) / 2,
        );
      });
      const m = new T.Vector2(
        e.clientX - drag.from[0],
        e.clientY - drag.from[1],
      ).normalize();
      const score = screen.map((v) => Math.abs(v.dot(m)));
      const up = screen[1];
      if (
        up.length() > 20 &&
        Math.abs(up.clone().normalize().dot(m)) > 0.8 &&
        score[1] > Math.max(score[0], score[2])
      ) {
        drag.axis = "y";
        drag.plane = this.movePlane(origin, "y");
        this.setRay({ clientX: drag.from[0], clientY: drag.from[1] });
        const start = this.planePoint(drag.plane);
        this.setRay(e);
        const now = this.planePoint(drag.plane);
        if (start && now) {
          drag.start = dataVec(start);
          point.copy(now);
        }
      }
    }
    const step = this.cfg.snapEnabled && !e.altKey ? this.cfg.step : 0;
    let delta = point
      .toArray()
      .map((v, i) =>
        drag.axis && i !== ai(drag.axis) ? 0 : snap(v - drag.start[i], step),
      ) as Vec;
    const moving =
      drag.ids.length === 1 ? rail(drag.base.parts, drag.ids[0]) : undefined;
    if (
      this.cfg.attach &&
      !e.altKey &&
      moving &&
      !drag.base.parts.some(
        (p) =>
          p.kind === "bracket" &&
          !!p.b &&
          (p.a === moving.id || p.b === moving.id),
      )
    ) {
      const desired = moving.p.map((v, i) => v + delta[i]) as Vec;
      let found = nearbyAttachments(
        moving,
        desired,
        drag.base.parts,
        step,
        drag.axis,
        this.contact?.key,
      );
      if (
        this.cyclePointer &&
        this.contact &&
        Math.hypot(
          e.clientX - this.cyclePointer[0],
          e.clientY - this.cyclePointer[1],
        ) < 70
      ) {
        const choices = attachments(
          moving,
          this.contact.host,
          desired,
          step,
          drag.base.parts,
          drag.axis,
        );
        const best = choices.find((c) => c.key === this.contact!.key);
        if (best) found = { best, choices };
      } else this.cyclePointer = null;
      if (found) {
        delta = found.best.p.map((v, i) => v - moving.p[i]) as Vec;
        this.choices = found.choices;
        this.contact = found.best;
      } else this.resetAttachment();
    } else this.resetAttachment();
    const bracket =
      drag.ids.length === 1
        ? drag.base.parts.find(
            (p): p is Bracket => p.id === drag.ids[0] && p.kind === "bracket",
          )
        : undefined;
    const host = bracket && rail(drag.base.parts, bracket.a);
    const f = bracket && bracketFrame(bracket, drag.base.parts);
    if (bracket && host && f) {
      // Slide the bracket along its frame; it joins (or leaves) a second
      // frame as it passes one, like a T-nut in the slot.
      const ia = ai(host.axis),
        point: Vec = [...f.origin];
      point[ia] =
        (f.u[0] === ia ? f.origin[ia] + bracket.sa * 15 : f.origin[ia]) + delta[ia];
      const res = bracketAt(drag.base.parts, host, bracket.face, bracket.sign, point, {
        orient: drag.orient ?? orientOf(bracket),
        step,
        join: this.cfg.attach && !e.altKey,
        id: bracket.id,
        label: bracket.label,
      });
      if (!res.bracket) {
        this.cb.message(res.error);
        return;
      }
      const next = clone(drag.base);
      const i = next.parts.findIndex((p) => p.id === bracket.id);
      next.parts[i] = { ...res.bracket, locked: bracket.locked, hidden: bracket.hidden, group: bracket.group };
      if (!bracket.group) delete (next.parts[i] as Bracket).group;
      if (!bracket.locked) delete next.parts[i].locked;
      if (!bracket.hidden) delete next.parts[i].hidden;
      drag.preview = next;
      this.rebuild(next);
      this.cb.message(
        res.bracket.b
          ? `Joins ${host.label} + ${rail(next.parts, res.bracket.b)?.label}`
          : `On ${host.label} · ${round(res.bracket.offset + host.length / 2)} mm from its end`,
      );
      return;
    }
    const result = moveParts(drag.base, drag.ids, delta);
    if (result.error) {
      this.cb.message(result.error);
      return;
    }
    drag.preview = result.project;
    this.rebuild(result.project);
    if (this.contact && moving)
      this.showAttachment(
        rail(result.project.parts, moving.id)!,
        this.choices,
        this.contact,
      );
    this.cb.message(
      this.contact
        ? `${this.contact.label} · Tab: alternatives · Alt: free move`
        : `Δ X ${delta[0]}   Y ${delta[1]}   Z ${delta[2]} mm`,
    );
  };
  private up = (e: PointerEvent) => {
    if (this.looking && e.button === this.looking.button) {
      e.stopImmediatePropagation();
      this.stopLook();
      return;
    }
    if (this.boxStart) {
      const [x, y] = this.boxStart,
        r = this.host.getBoundingClientRect();
      const selected = this.cfg.project.parts
        .filter((p) => {
          if (p.hidden) return false;
          const screen = v3(partPosition(p, this.cfg.project.parts)).project(
            this.camera,
          );
          const px = ((screen.x + 1) * r.width) / 2 + r.left,
            py = ((-screen.y + 1) * r.height) / 2 + r.top;
          return (
            px >= Math.min(x, e.clientX) &&
            px <= Math.max(x, e.clientX) &&
            py >= Math.min(y, e.clientY) &&
            py <= Math.max(y, e.clientY)
          );
        })
        .map((p) => p.id);
      this.cb.select(
        expandedSelection(
          this.cfg.project.parts,
          e.shiftKey
            ? [...new Set([...this.cfg.selection, ...selected])]
            : selected,
        ),
      );
      this.boxStart = null;
      this.box.hidden = true;
      this.controls.enabled = true;
      return;
    }
    if (this.drag) {
      e.stopImmediatePropagation();
      const d = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      if (d.moved) {
        if (this.contact)
          this.review = { base: d.base, id: d.ids[0], project: d.preview };
        this.cb.commit(d.preview);
        const was = d.base.parts.find((p) => p.id === d.ids[0]),
          now = d.preview.parts.find((p) => p.id === d.ids[0]);
        const joined = d.preview.parts.filter(
          (p): p is Bracket =>
            p.kind === "bracket" &&
            !!p.b &&
            !d.ids.includes(p.id) &&
            d.base.parts.some((q) => q.id === p.id && q.kind === "bracket" && !q.b),
        );
        this.cb.message(
          was?.kind === "bracket" && now?.kind === "bracket" && was.b !== now.b
            ? now.b
              ? `${now.label} joined to ${rail(d.preview.parts, now.b)?.label}`
              : `${now.label} no longer joins ${rail(d.base.parts, was.b)?.label}`
            : joined.length
              ? `${joined.map((j) => j.label).join(", ")} now join${joined.length > 1 ? "" : "s"} ${joined.map((j) => `${rail(d.preview.parts, j.a)?.label} + ${rail(d.preview.parts, j.b)?.label}`).join(", ")}`
              : "Position updated",
        );
      }
      this.rebuild(d.moved ? d.preview : this.cfg.project);
    }
  };
  private cancel = () => {
    this.resetAttachment();
    this.stopNavigation();
    if (this.drag) {
      this.drag = null;
      this.controls.enabled = true;
      this.rebuild(this.cfg.project);
    }
    this.boxStart = null;
    this.box.hidden = true;
  };
  cancelOperation() {
    this.cancel();
    this.clearGroup(this.ghost);
    this.measureStart = null;
    this.clearGroup(this.measurement);
  }
  private dragover = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    this.placementAt(e);
  };
  private drop = (e: DragEvent) => {
    e.preventDefault();
    this.placementAt(e);
    this.place();
  };
  refreshPlacement() {
    if (this.lastPointer && this.cfg.placement)
      this.placementAt(this.lastPointer);
  }
  fit(selection = false) {
    const parts = this.cfg.project.parts.filter(
      (p) => !p.hidden && (!selection || this.cfg.selection.includes(p.id)),
    );
    const b = bounds(parts);
    if (parts.length && !parts.some((p) => p.kind === "rail")) {
      const ps = parts.map((p) => partPosition(p, this.cfg.project.parts));
      for (let i = 0; i < 3; i++) {
        b.min[i] = Math.min(...ps.map((p) => p[i])) - 35;
        b.max[i] = Math.max(...ps.map((p) => p[i])) + 35;
        b.size[i] = b.max[i] - b.min[i];
      }
    }
    const center = new T.Vector3(
      ...(b.min.map((v, i) => (v + b.max[i]) / 2) as Vec),
    );
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.controls.target.copy(center);
    this.scale = parts.length
      ? Math.max(150, new T.Vector3(...b.size).length() * 1.1)
      : 800;
    let distance = 1800;
    if (this.camera instanceof T.PerspectiveCamera) {
      // Fit is an explicit camera reset. Do not carry an orthographic zoom's
      // narrow lens into a fit that could put the assembly beyond the far plane.
      this.camera.fov = 45;
      const vertical = T.MathUtils.degToRad(this.camera.fov);
      const horizontal =
        2 *
        Math.atan(
          (Math.tan(vertical / 2) * this.host.clientWidth) /
            this.host.clientHeight,
        );
      distance = this.scale / 2 / Math.sin(Math.min(vertical, horizontal) / 2);
    }
    this.camera.position.copy(
      center.clone().addScaledVector(direction, distance),
    );
    this.camera.zoom = 1;
    this.size();
    this.controls.update();
  }
  view(view: "perspective" | "top" | "front" | "right") {
    this.stopNavigation();
    if (view === "perspective") this.usePerspective();
    else if (this.camera instanceof T.PerspectiveCamera) {
      const old = this.camera;
      this.scale =
        (2 *
          old.position.distanceTo(this.controls.target) *
          Math.tan(T.MathUtils.degToRad(old.fov / 2))) /
        old.zoom;
      this.camera = new T.OrthographicCamera(-500, 500, 400, -400, 0.1, 30000);
      this.camera.position.copy(old.position);
      this.camera.quaternion.copy(old.quaternion);
      this.controls.object = this.camera;
      this.size();
    }
    const center = this.controls.target;
    const distance = this.camera.position.distanceTo(center);
    const offsets = {
      perspective: [1, 0.8, 1.1],
      top: [0, 1, 0.00001],
      front: [0, 0, 1],
      right: [1, 0, 0],
    };
    this.camera.position
      .copy(center)
      .add(
        new T.Vector3(...(offsets[view] as Vec))
          .normalize()
          .multiplyScalar(distance),
      );
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }
  zoom(factor: number) {
    this.camera.zoom = Math.max(0.08, Math.min(20, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
  }
  image() {
    const gizmoVisible = this.gizmo.visible;
    this.gizmo.visible = false;
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement("canvas");
    canvas.width = this.renderer.domElement.width;
    canvas.height = this.renderer.domElement.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(this.renderer.domElement, 0, 0);
    const ratio = canvas.width / this.host.clientWidth;
    ctx.font = `${11 * ratio}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const l of this.labels) {
      const p = l.p.clone().project(this.camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = ((p.x + 1) * canvas.width) / 2,
        y = ((-p.y + 1) * canvas.height) / 2;
      const text = l.el.textContent || "",
        width = ctx.measureText(text).width;
      ctx.fillStyle = "#292f35";
      ctx.fillRect(
        x - width / 2 - 5 * ratio,
        y - 9 * ratio,
        width + 10 * ratio,
        18 * ratio,
      );
      ctx.fillStyle = "#d3dae1";
      ctx.fillText(text, x, y);
    }
    this.gizmo.visible = gizmoVisible;
    return canvas.toDataURL("image/png");
  }
  dispose() {
    window.removeEventListener("keydown", this.attachmentKey, true);
    this.clearGroup(this.contacts);
    this.stopNavigation();
    window.removeEventListener("keydown", this.navigationDown);
    window.removeEventListener("keyup", this.navigationUp);
    window.removeEventListener("blur", this.stopNavigation);
    window.removeEventListener("focusin", this.focusChanged);
    document.removeEventListener("visibilitychange", this.stopNavigation);
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.clearGroup(this.world);
    this.clearGroup(this.ghost);
    this.clearGroup(this.helpers);
    this.clearGroup(this.gizmo);
    this.clearGroup(this.measurement);
    this.cache.forEach((g) => g.dispose());
    this.edgeCache.forEach((g) => g.dispose());
    [
      this.mat,
      this.bracketMat,
      this.selectedBracketMat,
      this.screwMat,
      this.nutMat,
      this.selectedMat,
      this.ghostMat,
    ].forEach((m) => m.dispose());
    this.renderer.dispose();
    this.host.replaceChildren();
    this.host.removeEventListener("dragover", this.dragover);
    this.host.removeEventListener("drop", this.drop);
  }
}
