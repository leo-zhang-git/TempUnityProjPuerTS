export type Affine2D = readonly [number, number, number, number, number, number];

export interface AffineBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const EPSILON = 0.000001;

function cssNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function multiplyAffine(left: Affine2D, right: Affine2D): Affine2D {
  const [la, lb, lc, ld, le, lf] = left;
  const [ra, rb, rc, rd, re, rf] = right;
  return [la * ra + lc * rb, lb * ra + ld * rb, la * rc + lc * rd, lb * rc + ld * rd, la * re + lc * rf + le, lb * re + ld * rf + lf];
}

export function affineCssTransform(matrix: Affine2D): string {
  return `matrix(${matrix.map(cssNumber).join(", ")})`;
}

function transformAffinePoint(matrix: Affine2D, point: readonly [number, number]): readonly [number, number] {
  return [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4], matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]];
}

export function transformAffineVector(matrix: Affine2D, vector: readonly [number, number]): readonly [number, number] {
  return [matrix[0] * vector[0] + matrix[2] * vector[1], matrix[1] * vector[0] + matrix[3] * vector[1]];
}

export function invertAffine(matrix: Affine2D): Affine2D | undefined {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < EPSILON) return undefined;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

export function pointInAffineRect(matrix: Affine2D, width: number, height: number, point: readonly [number, number]): boolean {
  const inverse = invertAffine(matrix);
  if (!inverse) return false;
  const local = transformAffinePoint(inverse, point);
  return local[0] >= 0 && local[0] <= width && local[1] >= 0 && local[1] <= height;
}

export function affineRectCorners(matrix: Affine2D, width: number, height: number): readonly (readonly [number, number])[] {
  return [
    transformAffinePoint(matrix, [0, 0]),
    transformAffinePoint(matrix, [width, 0]),
    transformAffinePoint(matrix, [width, height]),
    transformAffinePoint(matrix, [0, height]),
  ];
}

export function affineRectBounds(matrix: Affine2D, width: number, height: number): AffineBounds {
  const corners = affineRectCorners(matrix, width, height);
  const left = Math.min(...corners.map((point) => point[0]));
  const top = Math.min(...corners.map((point) => point[1]));
  const right = Math.max(...corners.map((point) => point[0]));
  const bottom = Math.max(...corners.map((point) => point[1]));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function affineLinearScale(matrix: Affine2D): readonly [number, number] {
  return [Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])];
}
