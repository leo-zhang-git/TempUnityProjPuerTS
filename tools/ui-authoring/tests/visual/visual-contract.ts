export const VISUAL_BATCH_FORMAT = "ui-authoring-visual-batch";
export const VISUAL_REPORT_FORMAT = "ui-authoring-visual-report";
export const VISUAL_FORMAT_VERSION = 1;

export interface VisualViewport {
  readonly width: number;
  readonly height: number;
}

export type VisualAction =
  | { readonly kind: "clickButton"; readonly name: string; readonly exact?: boolean }
  | { readonly kind: "clickTitle"; readonly title: string }
  | { readonly kind: "clickSelector"; readonly selector: string; readonly first?: boolean }
  | { readonly kind: "waitForSelector"; readonly selector: string }
  | { readonly kind: "waitForText"; readonly text: string; readonly exact?: boolean };

export interface VisualCaptureTarget {
  readonly kind: "page" | "selector";
  readonly label: string;
  readonly selector?: string;
}

type VisualWorkspace = "project" | "inspectorFixture";

export interface VisualCaseDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly route: string;
  readonly viewport: VisualViewport;
  readonly actions: readonly VisualAction[];
  readonly target: VisualCaptureTarget;
  readonly workspace?: VisualWorkspace;
  readonly componentType?: string;
  readonly stateId?: string;
}

export interface VisualCapturedCase {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly route: string;
  readonly viewport: VisualViewport;
  readonly target: VisualCaptureTarget;
  readonly workspace?: VisualWorkspace;
  readonly componentType?: string;
  readonly stateId?: string;
  readonly status: "captured" | "failed";
  readonly image?: string;
  readonly imageSha256?: string;
  readonly durationMs: number;
  readonly consoleMessages: readonly string[];
  readonly error?: string;
}

export interface VisualBatchManifest {
  readonly format: typeof VISUAL_BATCH_FORMAT;
  readonly version: typeof VISUAL_FORMAT_VERSION;
  readonly name: string;
  readonly createdAt: string;
  readonly sourceInputSha256: string;
  readonly sourceInputFiles: number;
  readonly toolInputSha256: string;
  readonly gitRevision?: string;
  readonly toolDirty: boolean;
  readonly cases: readonly VisualCapturedCase[];
}

export interface VisualDiffBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisualImageMetrics {
  readonly beforeWidth: number;
  readonly beforeHeight: number;
  readonly afterWidth: number;
  readonly afterHeight: number;
  readonly comparedWidth: number;
  readonly comparedHeight: number;
  readonly dimensionChanged: boolean;
  readonly totalPixels: number;
  readonly exactChangedPixels: number;
  readonly exactChangedRatio: number;
  readonly perceptualChangedPixels: number;
  readonly perceptualChangedRatio: number;
  readonly meanAbsoluteChannelDelta: number;
  readonly rootMeanSquareChannelDelta: number;
  readonly maxChannelDelta: number;
  readonly perceptualDiffBounds?: VisualDiffBounds;
}

export interface VisualComparedCase {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly viewport: VisualViewport;
  readonly target: VisualCaptureTarget;
  readonly workspace?: VisualWorkspace;
  readonly componentType?: string;
  readonly stateId?: string;
  readonly status: "identical" | "exact-only" | "changed" | "missing-before" | "missing-after" | "capture-failed";
  readonly beforeImage?: string;
  readonly afterImage?: string;
  readonly diffImage?: string;
  readonly metrics?: VisualImageMetrics;
  readonly message?: string;
}

export interface VisualComparisonReport {
  readonly format: typeof VISUAL_REPORT_FORMAT;
  readonly version: typeof VISUAL_FORMAT_VERSION;
  readonly createdAt: string;
  readonly beforeBatch: string;
  readonly afterBatch: string;
  readonly sourceInputsChanged: boolean;
  readonly toolInputsChanged: boolean;
  readonly summary: {
    readonly totalCases: number;
    readonly identicalCases: number;
    readonly exactOnlyCases: number;
    readonly changedCases: number;
    readonly incompleteCases: number;
    readonly totalPixels: number;
    readonly exactChangedPixels: number;
    readonly exactChangedRatio: number;
    readonly perceptualChangedPixels: number;
    readonly perceptualChangedRatio: number;
  };
  readonly cases: readonly VisualComparedCase[];
}
