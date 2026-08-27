import { useMemo } from "react";
import { artifactInitialSize } from "../../../../kernel/artifact-size.js";
import { type EvaluatedNode, type EvaluatedRect, evaluateLocalLayout, type LayoutIntrinsicProvider } from "../../../../kernel/layout.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import { useWebLayoutIntrinsic } from "../../../rendering/intrinsic/intrinsic.js";

export interface InspectorLayoutPresentation {
  readonly rects: ReadonlyMap<string, EvaluatedRect>;
  readonly parents: ReadonlyMap<string, EvaluatedRect>;
  readonly intrinsic: LayoutIntrinsicProvider;
}

export function useInspectorLayout(source: UiConcreteSource): InspectorLayoutPresentation {
  const intrinsic = useWebLayoutIntrinsic(source);
  return useMemo(() => {
    const rects = new Map<string, EvaluatedRect>();
    const parents = new Map<string, EvaluatedRect>();
    const initialSize = artifactInitialSize(source);
    const rootParent: EvaluatedRect = { x: 0, y: 0, width: initialSize[0], height: initialSize[1], rotation: 0, scaleX: 1, scaleY: 1 };
    const visit = (current: EvaluatedNode, parent: EvaluatedRect): void => {
      rects.set(current.node.id, current.rect);
      parents.set(current.node.id, parent);
      for (const child of current.children) visit(child, current.rect);
    };
    visit(evaluateLocalLayout(source, initialSize, { intrinsic: intrinsic.provider }), rootParent);
    return { rects, parents, intrinsic: intrinsic.provider };
  }, [source, intrinsic]);
}
