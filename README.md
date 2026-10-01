# gLOWframes

A 3D planner for 20 × 20 mm T-slot frames. Lay out frames, brackets and T-nuts, try arrangements quickly, and export a parts list and a printable build sheet.

The whole app is the single file `index.html`. It runs entirely in the browser: no server, account, database or internet connection is needed once the page has loaded.

## Put it on GitHub Pages

1. Upload everything in this folder to the root of your repository (drag it into **Add file → Upload files**, then **Commit changes**).
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then **Save**.
3. After a minute the site is live at `https://<your-username>.github.io/<repository-name>/`.

You can also just double-click `index.html` to use it offline.

## Using it

| To | Do |
| --- | --- |
| Add a part | Drag a frame, bracket or T-nut from the shelf into the view (or click it, then click in the view) |
| Turn a frame / bracket | **R** (works while dragging) |
| Select / add to selection | Click / Shift+click · drag on empty space to box-select |
| Move | Drag a part, or its coloured arrows · drag up the screen to lift |
| Move along one axis | **X**, **Y** or **Z** (press again to release) |
| Nudge | Arrow keys (uses the step size) · **[** and **]** change the step |
| Ignore snapping | Hold **Alt** while dragging |
| Look / fly | Hold right mouse and drag · **W A S D**, **Q/E** down/up, **Shift** faster |
| Views | **0** perspective · **7** top · **1** front · **3** right · **F** / **Home** zoom to selection / everything |
| Undo / redo | **Ctrl+Z** / **Ctrl+Y** |

**Brackets** sit on the frame face under the cursor and slide along it like a T-nut. When a bracket's upright leg rests against a second frame (or you slide a frame against it) the two are joined, and the joined frame can only move where the bracket can follow. Select a bracket to rotate it (R) or let go of a frame (Properties panel, or right-click it in the Outliner).

**Saving:** File → Save downloads a `.glowframe` file; File → Open loads one. Your latest work is also kept in the browser in case the tab closes, but that is not a backup. An example project is in `examples/`.

**Outputs:** Image (PNG of the view), Parts list (CSV) and Build sheet (a printable page with the view, dimensions, frame positions, bracket positions and hardware counts; open it and choose Print / Save as PDF).

### View controls

Drag the **view cube** in the upper-right corner to orbit the frame. Click a face for an aligned view, or an edge or corner for an angled view. The cube also accepts arrow keys when focused; Enter returns to an isometric view.

Use the camera dropdown or **View** menu to choose **Drone** (WASD moves, Q/E moves down/up, right-drag looks around) or **Orbit · Blender** (middle/right-drag rotates around the target; Shift with that drag pans; the wheel zooms). Drone is the default on every new session, including Build guide. Switching workspace tabs never forces Orbit; it is available when you explicitly select it. A reminder stays in the viewport.

### Fit check and model files

The **Frame** tab keeps the original frame shelf and hardware tools. **Fit check** adds boxes, cylinders, spheres and imported **STL/OBJ** models. Change their dimensions, position, rotation, color and opacity in the panel, or drag them and their colored arrows in the view. Imported files are centered automatically. Choose source units before importing; STL files do not record units. Limits: 10 MB per imported file, 100,000 triangles across all imported models, and 100 fit-check objects per project.

Fit-check objects are saved inside `.glowframe` files, work with undo/redo, and stay out of hardware counts and assembly steps. Bounding-box overlap notices are approximate; inspect the actual surfaces visually. The browser may run out of recovery storage for large projects; a persistent reminder then asks you to save a project file. Project files can be up to 25 MB.

**File → Export frame (STL)** exports visible frame parts and hardware as a binary mesh in millimeters. **Export frame + fit objects (STL)** also includes visible shapes and imported models. Rulers, guides and selection handles are excluded. STL does not retain editable frame connections, labels, colors or separate part metadata; keep a `.glowframe` copy. Exported hardware uses the viewport's simplified geometry, and separate overlapping meshes are not boolean-unioned into a manufacturing solid.

### Physical rulers

Click **Ruler** in the toolbar or Fit check. The ruler has millimeter ticks, a zero point, and a round extension handle. Drag its body to move it, drag the end to extend it, or enter an exact length. Use the colored arrows or X/Y/Z constraints to move along an axis. The panel can align it to X, Y or Z or apply any rotation. Hold Alt while dragging to ignore snapping. The **Distance** tool still measures between two picked points.

### Build guide

**Build guide** shows the current workpiece on a table. Working parts keep their natural colors, and other assembled parts become slightly transparent. Unfinished parts remain faintly visible as a full-frame reference, while only the current workpiece determines its position on the table. **Focus step** moves closer to the current action; **Whole frame** shows the current bench workpiece. Drone controls and the view cube remain available. The guide only changes the presentation; your saved frame geometry is unchanged.

T-nuts visibly slide through an open rail end, deepest position first, while screws approach their holes and rotate after reaching the nut. Rails move into position, and reorientation steps lift, turn and set the workpiece back on the table. A close-up shows the small hardware clearly. Animations repeat continuously, briefly holding the finished position between loops. Use **Pause** to freeze the action, **Play** to resume, or **Replay** to restart immediately. Reduced-motion preferences disable autoplay. No human hands are modeled.

The sequence starts by laying out the bottom level on the table, using rail lengths and positions such as “600 mm back rail” instead of assuming labels on the real pieces. Nuts are loaded for the current level before closing its corners. Each corner is fastened before moving to the next; uprights are then attached one at a time. The next level is laid out and assembled flat separately, with receiving brackets pre-fitted while accessible, before joining it to the lower assembly. Unjoined sections move separately. Disconnected assemblies are built separately.

Pieces rest directly on the tabletop. The guide does not add clamps, blocks, backing boards or human hands. Each step explains what to rest, hold and fasten, including when a helper may be needed. The 0 mm marker is an on-screen measurement reference, not a sticker to put on the piece. These are geometry-based assembly suggestions; check fit and access against your actual hardware. For brackets with multiple fasteners per leg, the animation demonstrates the representative location; repeat at the bracket's actual holes.

**Export printable guide** uses the same level-by-level sequence and descriptions by length and position. The separate construction sheet retains the editable design's part names. Keep final tightening until the frame is square, and follow the hardware manufacturer's torque specification.

Hardware counts assume one screw and T-nut per bracket leg by default (change it under the parts list). Brackets whose flat leg runs across a frame, or that join a frame lying across another, are counted as the bracket with holes near the corner. The planner checks geometry and fit only; it does not check strength.

## Changing the app

The editable source is in `source/`. With [Node.js](https://nodejs.org) 22 or newer:

```sh
cd source
npm ci            # once
npm run dev       # live-reloading preview while editing
npm test          # model tests
npm run release   # rebuild ../index.html from the source
```

Commit the updated `index.html` and the site updates.

| Path | Contents |
| --- | --- |
| `index.html` | The built app (generated; don't edit by hand) |
| `examples/` | Example project |
| `source/src/model.ts` | Frames, brackets, joints, movement rules, parts list, file format |
| `source/src/viewport.ts` | 3D view, placement and dragging |
| `source/src/main.tsx` | Menus, panels, shelf, exports |
| `source/src/style.css` | Look and layout |
| `source/src/assembly.ts` | Tabletop assembly sequence, support instructions and mounting positions |
| `source/src/benchScene.ts` | Tabletop presentation and hardware close-up |
| `source/src/guideMotion.ts` | Insertion timing and table-safe turning geometry |
| `source/src/references.ts` | Fit-check objects, mesh import, transforms and validation |
| `source/src/viewCube.ts` | Interactive orientation cube |
| `source/src/features/` | Fit-check and build-guide panels |
| `source/tests/` | Tests |
