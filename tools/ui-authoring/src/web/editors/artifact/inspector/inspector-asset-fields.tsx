import { FileType2, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import type { AuthoringAssetKind } from "../../../../schema/asset-catalog.js";
import { assetUrl } from "../../../shared/api/client.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import { ASSET_DRAG_TYPE, readAssetDragData } from "../assets/asset-browser.js";
import artifactStyles from "./artifact-inspector.module.css";
import type { AssetPickerRequest } from "./inspector-types.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);

function assetKindLabel(kind: AuthoringAssetKind): string {
  if (kind === "image") return "Sprite";
  if (kind === "font") return "Font";
  if (kind === "animationClip") return "Animation Clip";
  return "Animator Controller";
}

export function AssetField({
  kind,
  value,
  onChange,
  onOpen,
  mixed = false,
}: {
  readonly kind: AuthoringAssetKind;
  readonly value?: string | undefined;
  readonly onChange: (value: string | undefined) => void;
  readonly onOpen: () => void;
  readonly mixed?: boolean | undefined;
}) {
  return (
    <div
      className={webClasses("asset-field")}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const asset = readAssetDragData(event.dataTransfer);
        if (asset?.kind !== kind) return;
        event.preventDefault();
        onChange(asset.path);
      }}
    >
      <button className={webClasses("asset-field-main")} type="button" onClick={onOpen} title={value ?? `选择 ${assetKindLabel(kind)}`}>
        <span className={webClasses("asset-field-preview")}>
          {value && kind === "image" ? (
            <img src={assetUrl(value)} alt="" />
          ) : kind === "image" ? (
            <ImageIcon size={15} />
          ) : (
            <FileType2 size={15} />
          )}
        </span>
        <span>{mixed ? "混合" : (value ?? "无")}</span>
      </button>
      {value ? (
        <button className={webClasses("asset-field-clear")} type="button" onClick={() => onChange(undefined)} title="清除">
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

export function AnimationClipListField({
  value,
  onChange,
  openAssetPicker,
}: {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
}) {
  const replace = (index: number, path: string): void => onChange(value.map((entry, entryIndex) => (entryIndex === index ? path : entry)));
  const remove = (index: number): void => onChange(value.filter((_, entryIndex) => entryIndex !== index));
  return (
    <div className={webClasses("animation-clip-list")}>
      {value.map((path, index) => (
        <div className={webClasses("animation-clip-row")} key={`${index}:${path}`}>
          <AssetField
            kind="animationClip"
            value={path}
            onChange={(next) => (next ? replace(index, next) : remove(index))}
            onOpen={() =>
              openAssetPicker({
                kind: "animationClip",
                title: `Clip ${index + 1}`,
                selectedPath: path,
                onChoose: (next) => replace(index, next),
              })
            }
          />
          <button type="button" onClick={() => remove(index)} title="移除 Clip">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        className={webClasses("animation-clip-add")}
        type="button"
        onClick={() =>
          openAssetPicker({ kind: "animationClip", title: "添加 Animation Clip", onChoose: (path) => onChange([...value, path]) })
        }
        title="添加 Clip"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
