import * as T from "three";
import type { Vec } from "./model";

export class ViewCube {
  private scene = new T.Scene();
  private camera = new T.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
  private cube: T.Mesh;
  private el: HTMLDivElement;
  private textures: T.CanvasTexture[] = [];
  constructor(
    host: HTMLElement,
    orbit: (dx: number, dy: number) => void,
    face: (v: Vec) => void,
  ) {
    const materials = ["RIGHT", "LEFT", "TOP", "BOTTOM", "FRONT", "BACK"].map(
      (name, i) => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g = c.getContext("2d")!;
        g.fillStyle = [
          "#bbcfdd",
          "#bbcfdd",
          "#dae5df",
          "#dae5df",
          "#d9dddf",
          "#d9dddf",
        ][i];
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = "#586773";
        g.lineWidth = 8;
        g.strokeRect(4, 4, 248, 248);
        g.fillStyle = "#27333a";
        g.font = "bold 37px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(name, 128, 128);
        const texture = new T.CanvasTexture(c);
        texture.colorSpace = T.SRGBColorSpace;
        this.textures.push(texture);
        return new T.MeshBasicMaterial({ map: texture });
      },
    );
    this.cube = new T.Mesh(new T.BoxGeometry(1.65, 1.65, 1.65), materials);
    this.scene.add(this.cube);
    this.el = document.createElement("div");
    this.el.className = "view-cube";
    this.el.title = "Drag to orbit · click a face, edge or corner to orient";
    this.el.setAttribute(
      "aria-label",
      "View cube. Drag to orbit, click a face to orient.",
    );
    this.el.tabIndex = 0;
    let drag: { x: number; y: number; distance: number } | null = null;
    this.el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, distance: 0 };
    };
    this.el.onpointermove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.distance += Math.hypot(dx, dy);
      if (drag.distance > 3) orbit(dx, dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    this.el.onpointerup = (e) => {
      if (drag && drag.distance < 4) {
        const r = this.el.getBoundingClientRect(),
          ray = new T.Raycaster();
        ray.setFromCamera(
          new T.Vector2(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            1 - ((e.clientY - r.top) / r.height) * 2,
          ),
          this.camera,
        );
        const hit = ray.intersectObject(this.cube)[0];
        if (hit)
          face(
            hit.point
              .toArray()
              .map((n) => (Math.abs(n) > 0.57 ? Math.sign(n) : 0)) as Vec,
          );
      }
      drag = null;
      if (this.el.hasPointerCapture(e.pointerId))
        this.el.releasePointerCapture(e.pointerId);
    };
    this.el.onlostpointercapture = this.el.onpointercancel = () => {
      drag = null;
    };
    this.el.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        orbit(
          e.key === "ArrowLeft" ? -40 : e.key === "ArrowRight" ? 40 : 0,
          e.key === "ArrowUp" ? -40 : e.key === "ArrowDown" ? 40 : 0,
        );
      }
      if (e.key === "Home" || e.key === "Enter") face([1, 0.8, 1.1]);
    };
    host.append(this.el);
  }
  render(
    renderer: T.WebGLRenderer,
    camera: T.Camera,
    width: number,
    height: number,
  ) {
    this.camera.position.copy(
      camera.getWorldDirection(new T.Vector3()).multiplyScalar(-5),
    );
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.updateMatrixWorld();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(width - 138, height - 138, 124, 124);
    renderer.setScissor(width - 138, height - 138, 124, 124);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.autoClear = auto;
  }
  dispose() {
    this.el.remove();
    this.cube.geometry.dispose();
    (this.cube.material as T.Material[]).forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
