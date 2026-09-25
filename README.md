# gLOWframes

A local-file-based 3D planner for 20 × 20 mm T-slot frames. Built with React, TypeScript, and Three.js. No application server, account, external font, analytics service, or database is required.

The standard tray contains 20.0, 30.0 and 38.0 cm frames. Use **Other length…** on the parts shelf to add a custom frame length in centimetres. Dimensions and project coordinates are stored in millimetres.

## Run locally

Install Node.js 22.18 or later, then run these commands in this folder:

```sh
npm ci
npm run dev
```

Open the local address printed in the terminal. `npm run build` produces the static website in `dist/`. `npm run preview` serves that production build locally. Opening `index.html` by double-clicking is not supported; serve it over HTTP.

## GitHub Pages

Push this folder's contents to the repository root. In repository settings, choose **Pages → Source → GitHub Actions**. The included workflow tests and builds the app, then publishes `dist/` on a push to `main`, or when run manually. The relative asset base supports a repository subpath such as `/glowframes/`.

The workflow is provided but has not been connected to or run in a GitHub repository.

## Working with an assembly

- The initial example is a 600 × 420 × 400 mm detector support. Use **New** for an empty assembly or a fresh example.
- Drag a frame, bracket, or T-nut from the parts shelf under the viewport into the viewport. Alternatively, click it and then click a placement point. Tick **Keep placing** to drop several in a row.
- The **Points** X / Y / Z buttons set the direction of new frames. **R** cycles X, Y, and Z. Y is vertical.
- Attachment snapping aligns a new or unconnected frame's end to the side of a receiving frame. Place a bracket at the resulting junction to establish the connection.
- A bracket goes on whichever frame face is under the cursor and sits where you point, like a T-nut. R turns it 90° on the face (four positions, also while dragging); the turned-across positions use the bracket with holes near the corner. Near a second frame it snaps into a joint (hold Alt to stop that); dragging it later slides it along its frame, in and out of joints. A joined bracket follows the frame it holds, and that frame can only move where the bracket can go with it. Right-click › "Let go of …" to release the second frame.
- A connected crossmember automatically slides along its permitted direction. Drag a selected part's coloured arrows, or press X / Y / Z, to move along one axis.
- Position fields refer to frame centers. T-nut offsets are measured from the negative-axis end of their receiving frame.
- The step selector controls placement, movement, and nudging. The magnet toggles step snapping; the link icon separately toggles attachment snapping. Hold Alt to bypass movement increments temporarily.
- The bracket calculator defaults to one screw and one T-nut per side. Project settings can change this count. Independent T-nuts do not imply screws for unspecified equipment.

## Editing and navigation

| Action                     | Control                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| Look                       | Right-drag (rotate at the camera)                                        |
| Camera movement            | W/A/S/D with the pointer over the viewport, or after focusing it         |
| Down / up                  | Q / E                                                                    |
| Faster movement            | Hold Shift while moving                                                  |
| Pan                        | Shift + right-drag or middle-drag                                        |
| Zoom                       | Scroll, or viewport + / − buttons                                        |
| Select / Measure           | V / M                                                                    |
| Select several             | Shift-click, or drag on empty space to box-select                        |
| Select connected assembly  | Double-click a row, or Select connected                                  |
| Axis constraint            | X, Y, Z; press again to return to the plane                              |
| Nudge                      | Arrow keys; uses the current step and axis                               |
| Previous / next step       | [ / ]                                                                    |
| Duplicate                  | Ctrl/Command+D                                                           |
| Undo / redo                | Ctrl/Command+Z / Ctrl/Command+Shift+Z                                    |
| Frame selection / all      | F / Home                                                                 |
| Hide / show all            | H / Shift+H                                                              |
| Views                      | 0 perspective · 7 top · 1 front · 3 right                                |
| Cancel / delete            | Escape / Delete                                                          |

Grouping, locking, alignment, and even spacing are in the Edit menu; right-click a part in the Outliner for the common ones. Alignment and distribution apply to frame centers. Existing bracket constraints can block these operations. Delete a bracket or use **Detach** to release a frame.

## Project files and exports

- **Save** downloads a `.glowframe` JSON file. **Open** reads it entirely in the browser. To keep a named variant, edit the project title and save another copy.
- Browser recovery restores the most recent assembly on this browser and origin. It is not a substitute for project files. Undo history does not persist across reloads.
- **Image** exports a PNG of the viewport. Enable dimensions and identifiers before exporting to include them.
- **Parts list** exports a CSV containing frame lengths, brackets, fasteners, and mounting points.
- **Construction sheet** downloads a self-contained HTML document with an annotated assembly image, overall dimensions, materials, frame coordinates, bracket junction offsets, and T-nut locations. Open it and choose **Print / Save PDF**.

The example project is also supplied in `examples/detector-support.glowframe`.

## Scope and physical assumptions

This version uses a fixed 20 × 20 mm outer envelope and an illustrative T-slot profile. It supports perpendicular, coplanar, side-to-end bracket joints. The geometry and fastener illustration are not a manufacturer's CAD model. Exact groove, thread, screw, and bracket specifications must be matched to the physical hardware.

Selection and beam attachment use solid outer boxes, including across grooves and end bores. Grab anywhere on a beam and bring an end or side near another beam to snap their faces together. The contact faces are highlighted. Tab / Shift+Tab cycles alternatives; the preview arrows also work after release. Pull away to release a snap, or hold Alt to temporarily disable attachment and step snapping. Beam orientation is preserved. Face contact does not automatically add a bracket.

Frame intersections and floating frames are allowed during free exploration. Automatic attachment excludes overlapping frame destinations. Bracket placement, dragging and numeric edits check bracket bodies, triangular supports and illustrated screw heads for interference with other brackets and frame envelopes. Existing hardware collisions are reported in Assembly checks rather than rearranged automatically. These checks do not cover internal thread engagement, unmodelled hardware, deflection, loading, or structural stability.

The 3D view uses perspective projection for WASD navigation. Top, front, and right views use orthographic projection; starting camera movement or right-mouse look switches back to perspective. Camera movement stops when focus leaves the workspace and does not intercept typing or Ctrl/Command shortcuts. Save files contain geometry and relationships; display preferences and camera position are session controls. The first version targets laptop and desktop use, with a practical minimum width of 1024 pixels. It does not include a mobile editor, multi-user collaboration, automatic structural design, or an offline installation cache.

## Validation

```sh
npm test
npm run build
```

Model tests cover the example assembly, material counts, intermediate sliding, blocked movement, rigid assembly movement, bracket compatibility, dependent hardware removal, malformed input, and CSV escaping. Browser checks covered placement, direct sliding, numeric edits, local file save/open, and PNG/CSV/construction-sheet downloads.

## Files

- `src/model.ts` — geometry relationships, constraints, materials, file validation.
- `src/viewport.ts` — Three.js scene and pointer interactions.
- `src/main.tsx` — workspace controls, properties, persistence, exports.
- `src/style.css` — desktop/laptop layout.
- `tests/model.test.ts` — model regression tests.

The production build contains all runtime dependencies; there are no runtime CDN requests.
