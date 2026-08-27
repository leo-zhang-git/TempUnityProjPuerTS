import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { comparePngImages } from "../visual/visual-image-diff.js";

test("visual image diff reports identical images without changed pixels", async () => {
  await withImages(async (directory) => {
    const before = join(directory, "before.png");
    const after = join(directory, "after.png");
    const diff = join(directory, "diff.png");
    await writePng(before, 2, 2, () => [10, 20, 30, 255]);
    await writePng(after, 2, 2, () => [10, 20, 30, 255]);

    const metrics = await comparePngImages(before, after, diff);

    assert.equal(metrics.dimensionChanged, false);
    assert.equal(metrics.exactChangedPixels, 0);
    assert.equal(metrics.perceptualChangedPixels, 0);
    assert.equal(metrics.meanAbsoluteChannelDelta, 0);
    assert.equal(metrics.perceptualDiffBounds, undefined);
  });
});

test("visual image diff reports exact, perceptual, and bounded changes", async () => {
  await withImages(async (directory) => {
    const before = join(directory, "before.png");
    const after = join(directory, "after.png");
    const diff = join(directory, "diff.png");
    await writePng(before, 3, 2, () => [0, 0, 0, 255]);
    await writePng(after, 3, 2, (x, y) => (x === 1 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));

    const metrics = await comparePngImages(before, after, diff);

    assert.equal(metrics.exactChangedPixels, 1);
    assert.equal(metrics.perceptualChangedPixels, 1);
    assert.equal(metrics.exactChangedRatio, 1 / 6);
    assert.equal(metrics.maxChannelDelta, 255);
    assert.deepEqual(metrics.perceptualDiffBounds, { x: 1, y: 0, width: 1, height: 1 });
  });
});

test("visual image diff compares different dimensions on a shared transparent canvas", async () => {
  await withImages(async (directory) => {
    const before = join(directory, "before.png");
    const after = join(directory, "after.png");
    const diff = join(directory, "diff.png");
    await writePng(before, 2, 2, () => [0, 0, 0, 255]);
    await writePng(after, 3, 2, () => [0, 0, 0, 255]);

    const metrics = await comparePngImages(before, after, diff);

    assert.equal(metrics.dimensionChanged, true);
    assert.equal(metrics.comparedWidth, 3);
    assert.equal(metrics.comparedHeight, 2);
    assert.equal(metrics.exactChangedPixels, 2);
  });
});

async function withImages(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "ui-authoring-visual-diff-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writePng(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Promise<void> {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) image.data[offset + channel] = color[channel]!;
    }
  }
  await writeFile(path, PNG.sync.write(image));
}
