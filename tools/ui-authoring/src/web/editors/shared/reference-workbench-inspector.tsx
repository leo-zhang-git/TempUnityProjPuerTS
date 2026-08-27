import { ExternalLink, Pencil } from "lucide-react";
import type { ResolvedPreviewReference } from "../../../kernel/preview-reference-resolver.js";
import { walkResolvedPreviewInstances } from "../../../kernel/preview-reference-resolver.js";
import { findNode } from "../../../kernel/tree.js";
import type { UiReference } from "../../../schema/ui-prototype-schema.js";
import type { SelectionAddress } from "../../rendering/selection.js";
import { gameObjectDiagnosticLabel, gameObjectName } from "../../shared/game-object-label.js";
import type { ArtifactDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import styles from "./reference-workbench-inspector.module.css";

const webClasses = createWebClasses(styles);

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value || '""';
  if (value === undefined) return "继承";
  return JSON.stringify(value);
}

function componentFields(component: unknown): readonly [string, unknown][] {
  if (!component || typeof component !== "object" || Array.isArray(component)) return [["value", component]];
  return Object.entries(component).filter(([, value]) => typeof value !== "object" || value === null);
}

export function ReferenceNodeInspector({
  selection,
  resolved,
  artifacts,
  editable,
  onEditValue,
  onEditReference,
  onOpenArtifact,
}: {
  readonly selection: SelectionAddress;
  readonly resolved: ResolvedPreviewReference | undefined;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly editable: boolean;
  readonly onEditValue: () => void;
  readonly onEditReference: () => void;
  readonly onOpenArtifact: (artifactKey: string, selectedId?: string) => void;
}) {
  const instance = resolved?.tree
    ? walkResolvedPreviewInstances(resolved.tree).find(
        (entry) => entry.artifactKey === selection.ownerArtifactKey && samePath(entry.instancePath, selection.instancePath),
      )
    : undefined;
  const effectiveNode = instance ? findNode(instance.source, selection.nodeId) : undefined;
  const baselineSource = artifacts.get(selection.ownerArtifactKey)?.resolvedSource;
  const baselineNode = baselineSource ? findNode(baselineSource, selection.nodeId) : undefined;
  const provenance = (resolved?.provenance ?? []).filter(
    (entry) => entry.kind === "value" && entry.instanceKey === instance?.instanceKey && entry.nodeId === selection.nodeId,
  );
  if (!instance || !effectiveNode) return <p className={webClasses("empty-inspector")}>解析后的预览中没有当前所选节点。</p>;
  const referenceOwned = provenance.some((entry) => entry.kind === "value" && entry.layer.startsWith("reference."));
  return (
    <div className={webClasses("reference-node-inspector")}>
      <div className={webClasses("inspector-summary")}>
        <strong title={gameObjectDiagnosticLabel(effectiveNode)}>{gameObjectName(effectiveNode)}</strong>
        <code>{instance.instanceKey}</code>
        <small>{referenceOwned ? "Reference 覆写 + Source 基线" : "Source 基线"}</small>
        <div>
          <button type="button" onClick={() => onOpenArtifact(selection.ownerArtifactKey, selection.nodeId)}>
            <ExternalLink size={11} /> 所属 Artifact
          </button>
          <button
            type="button"
            disabled={!editable}
            onClick={onEditValue}
            title={editable ? "编辑 Reference 中的 Binder 值" : "切换到编辑预览后修改"}
          >
            <Pencil size={11} /> 值
          </button>
          <button type="button" onClick={onEditReference}>
            Reference
          </button>
        </div>
      </div>
      <section className={webClasses("inspector-block")}>
        <h3>生效状态</h3>
        <ul className={webClasses("state-list")}>
          <li className={webClasses("state-row")}>
            <header>
              <strong>GameObject</strong>
              <span className={webClasses(`owner-badge ${referenceOwned ? "" : "is-source"}`)}>{referenceOwned ? "混合" : "Source"}</span>
            </header>
            <dl>
              <dt>Active</dt>
              <dd>{displayValue(effectiveNode.active ?? true)}</dd>
              <dt>基线</dt>
              <dd>{displayValue(baselineNode?.active ?? true)}</dd>
            </dl>
          </li>
          {Object.entries(effectiveNode.components ?? {}).map(([componentType, component]) => (
            <li className={webClasses("state-row")} key={componentType}>
              <header>
                <strong>{componentType}</strong>
                <span
                  className={webClasses(
                    `owner-badge ${provenance.some((entry) => entry.kind === "value" && entry.capability !== "active") ? "" : "is-source"}`,
                  )}
                >
                  {provenance.some((entry) => entry.kind === "value" && entry.capability !== "active") ? "生效" : "Source"}
                </span>
              </header>
              <dl>
                {componentFields(component).map(([field, value]) => (
                  <FragmentField key={field} field={field} value={value} />
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
      <section className={webClasses("inspector-block")}>
        <h3>Reference 值</h3>
        {provenance.length === 0 ? (
          <p className={webClasses("empty-inspector")}>没有影响此节点的 Reference 值覆写。</p>
        ) : (
          <ul className={webClasses("state-list")}>
            {provenance.map((entry, index) =>
              entry.kind === "value" ? (
                <li className={webClasses("state-row")} key={`${entry.layer}:${entry.bindingField}:${entry.capability}:${index}`}>
                  <header>
                    <strong>
                      {entry.bindingField}.{entry.capability}
                    </strong>
                    <span className={webClasses("owner-badge")}>{entry.layer}</span>
                  </header>
                  <div className={webClasses("value-change")}>
                    <code>{displayValue(entry.baselineValue)}</code>
                    <span>→</span>
                    <code>{displayValue(entry.value)}</code>
                  </div>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function FragmentField({ field, value }: { readonly field: string; readonly value: unknown }) {
  return (
    <>
      <dt>{field}</dt>
      <dd title={displayValue(value)}>{displayValue(value)}</dd>
    </>
  );
}

interface SemanticChange {
  readonly path: string;
  readonly title: string;
  readonly detail: string;
}

function countValues(values: UiReference["values"]): number {
  return Object.values(values ?? {}).reduce((total, patch) => total + Object.keys(patch).length, 0);
}

function semanticChanges(reference: UiReference, resolved: ResolvedPreviewReference | undefined): readonly SemanticChange[] {
  const changes: SemanticChange[] = [];
  const subjectValues = countValues(reference.values);
  if (subjectValues > 0) changes.push({ path: "/values", title: "主体值", detail: `${subjectValues} 项能力覆写` });
  if (reference.statePreviewContexts) {
    const stateOverrides = Object.values(reference.statePreviewContexts).reduce((total, context) => total + Object.keys(context).length, 0);
    changes.push({
      path: "/statePreviewContexts",
      title: "状态预览上下文",
      detail: `${Object.keys(reference.statePreviewContexts).length} 个 StateRoot · ${stateOverrides} 项上游状态覆写`,
    });
  }
  if (reference.context) {
    changes.push({
      path: "/context",
      title: "上下文",
      detail: `${reference.subjectArtifactKey} 挂载到 ${reference.context.parentArtifactKey}`,
    });
    const contextValues = countValues(reference.context.values);
    if (contextValues > 0) changes.push({ path: "/context/values", title: "上下文值", detail: `${contextValues} 项能力覆写` });
  }
  for (const [index, entry] of (reference.instanceValues ?? []).entries()) {
    const preset = "referenceKey" in entry ? ` · 预设 ${entry.referenceKey}` : "";
    changes.push({
      path: `/instanceValues/${index}`,
      title: "实例证据",
      detail: `${JSON.stringify(entry.owner)}${preset} · ${countValues(entry.values)} 项覆写`,
    });
  }
  for (const [index, collection] of (reference.collections ?? []).entries()) {
    const items = collection.groups.reduce((total, group) => total + ("items" in group ? group.items.length : group.count), 0);
    changes.push({
      path: `/collections/${index}`,
      title: `集合 · ${collection.key}`,
      detail: `${collection.groups.length} 组 · ${items} 个生成项`,
    });
  }
  for (const [index, mount] of (reference.mounts ?? []).entries()) {
    changes.push({ path: `/mounts/${index}`, title: `挂载 · ${mount.key}`, detail: `${mount.artifactKey} 位于 ${mount.targetBinding}` });
  }
  if (reference.viewport)
    changes.push({ path: "/viewport", title: "预览尺寸", detail: `${reference.viewport[0]} x ${reference.viewport[1]}` });
  if (reference.backdrop) changes.push({ path: "/backdrop", title: "背景", detail: `${reference.backdrop.images.length} 张图片` });
  if (reference.description) changes.push({ path: "/description", title: "描述", detail: reference.description });
  for (const entry of resolved?.provenance ?? []) {
    if (entry.kind !== "generated") continue;
    changes.push({
      path: `resolved:${entry.instanceKey}`,
      title: `已生成 · ${entry.artifactKey}`,
      detail: `${entry.layer} · ${entry.bindingField}`,
    });
  }
  return changes;
}

export function ReferenceChangesInspector({
  reference,
  resolved,
  onEditReference,
}: {
  readonly reference: UiReference;
  readonly resolved: ResolvedPreviewReference | undefined;
  readonly onEditReference: () => void;
}) {
  const changes = semanticChanges(reference, resolved);
  return (
    <div className={webClasses("reference-changes-inspector")}>
      <div className={webClasses("inspector-summary")}>
        <strong>Reference 覆写</strong>
        <small>叠加在 Unity Artifact 图上的语义差异</small>
      </div>
      <section className={webClasses("inspector-block")}>
        <h3>{changes.length} 项改动</h3>
        {changes.length === 0 ? (
          <p className={webClasses("empty-inspector")}>此 Reference 仅指定主体 Artifact。</p>
        ) : (
          <ul className={webClasses("change-list")}>
            {changes.map((change) => (
              <li className={webClasses("change-row")} key={change.path}>
                <header>
                  <strong>{change.title}</strong>
                  {!change.path.startsWith("resolved:") ? (
                    <button type="button" onClick={onEditReference} title="在 Reference Inspector 中编辑">
                      <Pencil size={10} />
                    </button>
                  ) : null}
                </header>
                <code>{change.path}</code>
                <small title={change.detail}>{change.detail}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
