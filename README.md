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
| `source/tests/` | Tests |
