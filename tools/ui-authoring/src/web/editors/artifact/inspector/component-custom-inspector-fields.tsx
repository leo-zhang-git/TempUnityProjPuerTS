import { Plus, Trash2 } from "lucide-react";
import { type CrosshairEdge, type CrosshairPunch, DEFAULT_CROSSHAIR_PUNCH } from "../../../../components/crosshair.js";
import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-inspector.module.css";
import { MixedCheckbox, NumberInput, TupleField } from "./inspector-field-primitives.js";
import { CommitInput, NodeReferenceField } from "./inspector-reference-fields.js";
import type { InspectorContinuousEdit, InspectorUpdateMode } from "./inspector-types.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);

export function TemplateMapField({
  source,
  value,
  onChange,
}: {
  readonly source: UiConcreteSource;
  readonly value: Record<string, string>;
  readonly onChange: (value: Record<string, string>) => void;
}) {
  const add = (): void => {
    let key = "Template";
    let suffix = 2;
    while (key in value) key = `Template${suffix++}`;
    const target =
      walkNodes(source)
        .map((entry) => entry.node)
        .find((node) => node.components?.PrefabRef)?.id ?? "";
    onChange({ ...value, [key]: target });
  };
  return (
    <div className={webClasses("map-editor")}>
      <div className={webClasses("map-rows")}>
        {Object.entries(value).map(([key, target]) => (
          <div className={webClasses("map-row template-row")} key={key}>
            <CommitInput
              value={key}
              ariaLabel="模板名称"
              onCommit={(nextKey) => {
                if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nextKey) || (nextKey !== key && nextKey in value)) return false;
                if (nextKey === key) return true;
                const next: Record<string, string> = {};
                for (const [currentKey, currentValue] of Object.entries(value))
                  next[currentKey === key ? nextKey : currentKey] = currentValue;
                onChange(next);
                return true;
              }}
            />
            <NodeReferenceField
              source={source}
              value={target}
              filter="prefabRef"
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...value };
                delete next[key];
                onChange(next);
              }}
              title="删除模板"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className={webClasses("add-map-row")} type="button" onClick={add}>
        <Plus size={12} />
        添加模板
      </button>
    </div>
  );
}

export function CrosshairEdgesField({
  source,
  value,
  onChange,
  onSelectNode,
  onHoverNode,
}: {
  readonly source: UiConcreteSource;
  readonly value: readonly CrosshairEdge[];
  readonly onChange: (value: readonly CrosshairEdge[]) => void;
  readonly onSelectNode?: ((nodeId: string) => void) | undefined;
  readonly onHoverNode?: ((nodeId: string | undefined) => void) | undefined;
}) {
  const replace = (index: number, edge: CrosshairEdge): void =>
    onChange(value.map((current, currentIndex) => (currentIndex === index ? edge : current)));
  return (
    <div className={webClasses("crosshair-edge-editor")}>
      {value.map((edge, index) => (
        <div className={webClasses("crosshair-edge-row")} key={`${edge.target}:${index}`}>
          <NodeReferenceField
            source={source}
            value={edge.target}
            filter="any"
            onChange={(target) => replace(index, { ...edge, target })}
            onSelect={onSelectNode}
            onHover={onHoverNode}
          />
          <TupleField
            label=""
            value={edge.direction}
            labels={["X", "Y"]}
            onChange={(direction) => replace(index, { ...edge, direction: direction as [number, number] })}
          />
          <button type="button" onClick={() => onChange(value.filter((_, currentIndex) => currentIndex !== index))} title="删除边缘">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button className={webClasses("add-map-row")} type="button" onClick={() => onChange([...value, { target: "", direction: [1, 0] }])}>
        <Plus size={12} />
        添加边缘
      </button>
    </div>
  );
}

export function CrosshairPunchField({
  value,
  onChange,
  continuousEdit,
}: {
  readonly value: CrosshairPunch | undefined;
  readonly onChange: (value: CrosshairPunch, mode?: InspectorUpdateMode) => void;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  const punch = { ...DEFAULT_CROSSHAIR_PUNCH, ...value };
  const set = <TKey extends keyof CrosshairPunch>(key: TKey, next: CrosshairPunch[TKey], mode?: InspectorUpdateMode): void => {
    onChange({ ...punch, [key]: next }, mode);
  };
  return (
    <div className={webClasses("crosshair-punch-editor")}>
      <label>
        <span>Duration</span>
        <NumberInput
          continuousEdit={continuousEdit}
          value={punch.duration}
          minimum={0.0001}
          step={0.01}
          onChange={(next, mode) => set("duration", next, mode)}
        />
      </label>
      <label>
        <span>Vibrato</span>
        <NumberInput
          continuousEdit={continuousEdit}
          value={punch.vibrato}
          minimum={1}
          step={1}
          onChange={(next, mode) => set("vibrato", Math.round(next), mode)}
        />
      </label>
      <label>
        <span>Elasticity</span>
        <NumberInput
          continuousEdit={continuousEdit}
          value={punch.elasticity}
          minimum={0}
          maximum={1}
          step={0.05}
          onChange={(next, mode) => set("elasticity", next, mode)}
        />
      </label>
      <label>
        <span>Scale</span>
        <NumberInput
          continuousEdit={continuousEdit}
          value={punch.scale}
          minimum={-1}
          maximum={1}
          step={0.01}
          onChange={(next, mode) => set("scale", next, mode)}
        />
      </label>
      <label className={webClasses("crosshair-punch-toggle")}>
        <span>Rotation</span>
        <MixedCheckbox checked={punch.rotationEnabled} mixed={false} onChange={(next) => set("rotationEnabled", next)} />
      </label>
      <label>
        <span>Rotation Z</span>
        <NumberInput
          continuousEdit={continuousEdit}
          value={punch.rotationZ}
          minimum={-180}
          maximum={180}
          step={1}
          disabled={!punch.rotationEnabled}
          onChange={(next, mode) => set("rotationZ", next, mode)}
        />
      </label>
      <label>
        <span>Random Z</span>
        <NumberInput
          continuousEdit={continuousEdit}
          value={punch.randomRotationZ}
          minimum={0}
          maximum={180}
          step={1}
          disabled={!punch.rotationEnabled}
          onChange={(next, mode) => set("randomRotationZ", next, mode)}
        />
      </label>
    </div>
  );
}
