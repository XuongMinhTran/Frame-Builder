import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";

export function railProfile() {
  // Diagonal webs separate the four slots; rectangular pockets intersect here.
  const face = [
    [-10, -10],
    [-3, -10],
    [-3, -8],
    [-6, -8],
    [-6, -7.5],
    [-2.5, -4],
    [2.5, -4],
    [6, -7.5],
    [6, -8],
    [3, -8],
    [3, -10],
  ];
  const points: Vector2[] = [];
  for (let side = 0; side < 4; side++) {
    for (const [x, y] of face) {
      // Exact quarter turns keep meeting surfaces aligned.
      const rotated = [
        [x, y],
        [-y, x],
        [-x, -y],
        [y, -x],
      ][side];
      points.push(new Vector2(...rotated));
    }
  }
  const shape = new Shape(points);
  shape.closePath();
  const hole = new Path();
  hole.absarc(0, 0, 2.5, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

export function createRailGeometry(length: number) {
  const geometry = new ExtrudeGeometry(railProfile(), {
    depth: length,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -length / 2);
  return geometry;
}

export function createBracketGeometry() {
  const shape = new Shape([
    new Vector2(0, 0),
    new Vector2(30, 0),
    new Vector2(30, 2.8),
    new Vector2(2.8, 2.8),
    new Vector2(2.8, 30),
    new Vector2(0, 30),
  ]);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 16,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -8);
  return geometry;
}
