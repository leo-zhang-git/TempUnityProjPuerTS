import type { TSchema } from "@sinclair/typebox";
import type { ComponentFieldDefinition } from "../components/component-module.js";
import type { InspectorControl, UnityPropertyCodec } from "./component-contract.js";
import { componentRegistry, isInspectorFieldEntry } from "./component-registry.js";

interface UnityComponentManifestField {
  readonly property: string;
  readonly path: string;
  readonly codec: UnityPropertyCodec;
  readonly enumValues?: Readonly<Record<string, number>>;
  readonly capability?: string;
}

interface UnityComponentManifestEntry {
  readonly key: string;
  readonly unityType: string;
  readonly exactType: boolean;
  readonly useSiteAddable: boolean;
  readonly capability?: string;
  readonly fields: readonly UnityComponentManifestField[];
}

export interface UnityComponentManifest {
  readonly components: readonly UnityComponentManifestEntry[];
}

const codecByControl: Readonly<Partial<Record<InspectorControl, UnityPropertyCodec>>> = {
  text: "string",
  multiline: "string",
  number: "float",
  optionalNumber: "optionalFloat",
  boolean: "boolean",
  enum: "enum",
  segmented: "enum",
  vector2: "vector2",
  vector4: "vector4",
  color: "color",
  imageAsset: "asset",
  fontAsset: "asset",
  animationClipAsset: "asset",
  animationClipList: "assetArray",
  animatorControllerAsset: "asset",
  nodeReference: "nodeReference",
  nodeReferenceList: "nodeReferenceArray",
  artifactReference: "artifactReference",
};

function pascal(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function inferredCodec(
  field: ComponentFieldDefinition,
  control: InspectorControl | undefined,
  componentCapability: string | undefined,
): UnityPropertyCodec {
  if (field.unity?.codec) return field.unity.codec;
  const schema = field.schema as TSchema & { readonly type?: string };
  if (schema.type === "integer") return "integer";
  const codec = control ? codecByControl[control] : undefined;
  if (codec) return codec;
  if (field.unity?.capability || componentCapability) return "string";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "integer") return "integer";
  if (schema.type === "number") return "float";
  if (schema.type === "string") return "string";
  throw new Error("Unity field requires a codec or capability");
}

export const componentManifest: UnityComponentManifest = {
  components: Object.values(componentRegistry).flatMap((module) => {
    if (!module.unity) return [];
    const fields = Object.entries(module.fields).map(([property, field]) => {
      const inspector = module.inspector.find((entry) => isInspectorFieldEntry(entry) && entry.property === property);
      const control = inspector && isInspectorFieldEntry(inspector) ? inspector.control : undefined;
      const path = field.unity?.path ?? (module.unity!.pathConvention === "exact" ? property : `m_${pascal(property)}`);
      const enumValues =
        field.unity?.enumValues ??
        (inspector && isInspectorFieldEntry(inspector) && inspector.options
          ? Object.fromEntries(inspector.options.map((option, index) => [option.value, index]))
          : undefined);
      const codec =
        inspector && isInspectorFieldEntry(inspector) && inspector.numericKind === "integer"
          ? ("integer" as const)
          : inferredCodec(field, control, module.unity!.capability);
      return {
        property,
        path,
        codec,
        ...(enumValues ? { enumValues } : {}),
        ...(field.unity?.capability ? { capability: field.unity.capability } : {}),
      };
    });
    return [
      {
        key: module.key,
        unityType: module.unity.type,
        exactType: module.unity.exactType === true,
        useSiteAddable: module.useSiteAddable === true,
        ...(module.unity.capability ? { capability: module.unity.capability } : {}),
        fields,
      },
    ];
  }),
};
