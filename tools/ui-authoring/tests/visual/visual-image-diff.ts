import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { VisualDiffBounds, VisualImageMetrics } from "./visual-contract.js";

export async function comparePngImages(beforePath: string, afterPath: string, diffPath: string): Promise<VisualImageMetrics> {
  const beforeSource = PNG.sync.read(await readFile(beforePath));
  const afterSource = PNG.sync.read(await readFile(afterPath));
  const width = Math.max(beforeSource.width, afterSource.width);
  const height = Math.max(beforeSource.height, afterSource.height);
  const before = normalizePng(beforeSource, width, height);
  const after = normalizePng(afterSource, width, height);
  const diff = new PNG({ width, height });
  const perceptualChangedPixels = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
    diffMask: true,
  });

  let exactChangedPixels = 0;
  let absoluteChannelDelta = 0;
  let squaredChannelDelta = 0;
  let maxChannelDelta = 0;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(before.data[offset + channel]! - after.data[offset + channel]!);
      if (delta > 0) pixelChanged = true;
      absoluteChannelDelta += delta;
      squaredChannelDelta += delta * delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (pixelChanged) exactChangedPixels += 1;
  }

  await writeFile(diffPath, PNG.sync.write(diff));
  const totalPixels = width * height;
  const channelCount = totalPixels * 4;
  const diffBounds = perceptualDiffBounds(diff);
  return {
    beforeWidth: beforeSource.width,
    beforeHeight: beforeSource.height,
    afterWidth: afterSource.width,
    afterHeight: afterSource.height,
    comparedWidth: width,
    comparedHeight: height,
    dimensionChanged: beforeSource.width !== afterSource.width || beforeSource.height !== afterSource.height,
    totalPixels,
    exactChangedPixels,
    exactChangedRatio: ratio(exactChangedPixels, totalPixels),
    perceptualChangedPixels,
    perceptualChangedRatio: ratio(perceptualChangedPixels, totalPixels),
    meanAbsoluteChannelDelta: ratio(absoluteChannelDelta, channelCount),
    rootMeanSquareChannelDelta: Math.sqrt(ratio(squaredChannelDelta, channelCount)),
    maxChannelDelta,
    ...(diffBounds ? { perceptualDiffBounds: diffBounds } : {}),
  };
}

function normalizePng(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) return source;
  const result = new PNG({ width, height });
  result.data.fill(0);
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    source.data.copy(result.data, y * width * 4, sourceStart, sourceStart + source.width * 4);
  }
  return result;
}

function perceptualDiffBounds(diff: PNG): VisualDiffBounds | undefined {
  let left = diff.width;
  let top = diff.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < diff.height; y += 1) {
    for (let x = 0; x < diff.width; x += 1) {
      const alpha = diff.data[(y * diff.width + x) * 4 + 3];
      if (!alpha) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}
