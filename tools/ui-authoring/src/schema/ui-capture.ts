import type { UiReference } from "./ui-prototype-schema.js";
import type { UiSource } from "./ui-source-schema.js";

type CaptureDocumentKind = "Artifact" | "Reference";

export interface CaptureArtifactOverlay {
  readonly path: string;
  readonly source: UiSource;
}

export interface CaptureClip {
  readonly nodeId: string;
  readonly instancePath?: readonly string[];
}

export interface CapturePreview {
  readonly states?: Readonly<Record<string, string>>;
  readonly inputs?: Readonly<Record<string, string | number>>;
}

export interface CaptureRequest {
  readonly path: string;
  readonly overlays?: readonly CaptureArtifactOverlay[];
  readonly deletedPaths?: readonly string[];
  readonly reference?: UiReference;
  readonly viewport?: readonly [number, number];
  readonly scale?: 1 | 2;
  readonly clip?: CaptureClip;
  readonly preview?: CapturePreview;
  readonly background?: string;
  readonly draft?: boolean;
  readonly includeDebug?: boolean;
  readonly output?: string;
  readonly displayMode?: "unityBaseline";
}

export interface CaptureManifest {
  readonly document: {
    readonly kind: CaptureDocumentKind;
    readonly key: string;
    readonly path: string;
  };
  readonly output: string;
  readonly viewport: readonly [number, number];
  readonly scale?: 2;
  readonly draft?: true;
  readonly background?: string;
  readonly clip?: CaptureClip;
  readonly preview?: CapturePreview;
  readonly displayMode?: "unityBaseline";
}

export interface CaptureResult {
  readonly manifest: CaptureManifest;
  readonly manifestPath: string;
}

interface CaptureSessionArtifact {
  readonly path: string;
  readonly source: UiSource;
}

interface CaptureSessionReference {
  readonly path: string;
  readonly reference: UiReference;
}

export interface CaptureSession {
  readonly id: string;
  readonly document: CaptureManifest["document"];
  readonly viewport: readonly [number, number];
  readonly background: string;
  readonly includeDebug: boolean;
  readonly clip?: CaptureClip;
  readonly preview?: CapturePreview;
  readonly source?: UiSource;
  readonly reference?: UiReference;
  readonly references?: readonly CaptureSessionReference[];
  readonly artifacts: readonly CaptureSessionArtifact[];
  readonly displayMode?: "unityBaseline";
}
