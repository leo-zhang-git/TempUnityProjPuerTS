import { type Static, Type } from "@sinclair/typebox";

const ArtifactKeySchema = Type.String({ pattern: "^[A-Z][A-Za-z0-9]*$" });
const IdentifierSchema = Type.String({ pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$" });
const ReferenceAssetPathSchema = Type.String({ pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+\\.(?:png|jpe?g|webp)$" });
const PositiveSizeSchema = Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]);

const ArtifactUseSiteSchema = Type.Object(
  {
    rootArtifactKey: ArtifactKeySchema,
    instancePath: Type.Optional(Type.Array(IdentifierSchema, { default: [] })),
  },
  { additionalProperties: false },
);

const GraphTargetSchema = Type.Object(
  {
    rootArtifactKey: ArtifactKeySchema,
    instancePath: Type.Optional(Type.Array(IdentifierSchema, { default: [] })),
    nodeId: IdentifierSchema,
    componentType: IdentifierSchema,
  },
  { additionalProperties: false },
);

const PreviewValuesSchema = Type.Record(IdentifierSchema, Type.Record(IdentifierSchema, Type.Unknown(), { minProperties: 1 }), {
  minProperties: 1,
});

const StatePreviewContextsSchema = Type.Record(IdentifierSchema, Type.Record(IdentifierSchema, IdentifierSchema, { minProperties: 1 }), {
  minProperties: 1,
});

const SubjectOwnerScopeSchema = Type.Object({ kind: Type.Literal("subject") }, { additionalProperties: false });
const ContextOwnerScopeSchema = Type.Object({ kind: Type.Literal("context") }, { additionalProperties: false });
const ArtifactOwnerScopeSchema = Type.Object(
  {
    kind: Type.Literal("artifact"),
    root: Type.Union([Type.Literal("subject"), Type.Literal("context")]),
    instancePath: Type.Array(IdentifierSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
const MountOwnerScopeSchema = Type.Object(
  {
    kind: Type.Literal("mount"),
    mountKey: IdentifierSchema,
    instancePath: Type.Optional(Type.Array(IdentifierSchema, { minItems: 1 })),
  },
  { additionalProperties: false },
);

const PreviewReferenceOwnerScopeSchema = Type.Union([
  SubjectOwnerScopeSchema,
  ContextOwnerScopeSchema,
  ArtifactOwnerScopeSchema,
  MountOwnerScopeSchema,
]);
const InstancePresetOwnerScopeSchema = Type.Union([ArtifactOwnerScopeSchema, MountOwnerScopeSchema]);

const ReferencePlacementSchema = Type.Union([
  Type.Object({ instancePath: Type.Array(IdentifierSchema, { minItems: 1 }) }, { additionalProperties: false }),
  Type.Object({ targetBinding: IdentifierSchema }, { additionalProperties: false }),
]);

const ReferenceContextSchema = Type.Object(
  {
    parentArtifactKey: ArtifactKeySchema,
    placement: ReferencePlacementSchema,
    values: Type.Optional(PreviewValuesSchema),
  },
  { additionalProperties: false },
);

const ReferenceInstanceValuesSchema = Type.Union([
  Type.Object(
    {
      owner: InstancePresetOwnerScopeSchema,
      referenceKey: ArtifactKeySchema,
      values: Type.Optional(PreviewValuesSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      owner: PreviewReferenceOwnerScopeSchema,
      values: PreviewValuesSchema,
    },
    { additionalProperties: false },
  ),
]);

const ReferenceCollectionItemSchema = Type.Object(
  {
    key: Type.Optional(IdentifierSchema),
    referenceKey: Type.Optional(ArtifactKeySchema),
    values: Type.Optional(PreviewValuesSchema),
  },
  { additionalProperties: false },
);

const ReferenceCollectionGroupBase = {
  templateKey: IdentifierSchema,
  referenceKey: Type.Optional(ArtifactKeySchema),
  values: Type.Optional(PreviewValuesSchema),
};

const ReferenceCollectionGroupSchema = Type.Union([
  Type.Object({ ...ReferenceCollectionGroupBase, items: Type.Array(ReferenceCollectionItemSchema) }, { additionalProperties: false }),
  Type.Object({ ...ReferenceCollectionGroupBase, count: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
]);

const ReferenceCollectionSchema = Type.Object(
  {
    key: IdentifierSchema,
    owner: Type.Optional(PreviewReferenceOwnerScopeSchema),
    targetBinding: IdentifierSchema,
    groups: Type.Array(ReferenceCollectionGroupSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

const ReferenceMountSchema = Type.Object(
  {
    key: IdentifierSchema,
    owner: Type.Optional(PreviewReferenceOwnerScopeSchema),
    targetBinding: IdentifierSchema,
    artifactKey: ArtifactKeySchema,
    referenceKey: Type.Optional(ArtifactKeySchema),
    values: Type.Optional(PreviewValuesSchema),
    offset: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
    size: Type.Optional(Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })])),
  },
  { additionalProperties: false },
);

const ReferenceBackdropImageSchema = Type.Object(
  {
    path: ReferenceAssetPathSchema,
    viewport: PositiveSizeSchema,
  },
  { additionalProperties: false },
);

const ReferenceBackdropSchema = Type.Object(
  {
    images: Type.Array(ReferenceBackdropImageSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const UiReferenceSchema = Type.Object(
  {
    referenceKey: ArtifactKeySchema,
    subjectArtifactKey: ArtifactKeySchema,
    values: Type.Optional(PreviewValuesSchema),
    instanceValues: Type.Optional(Type.Array(ReferenceInstanceValuesSchema)),
    statePreviewContexts: Type.Optional(StatePreviewContextsSchema),
    context: Type.Optional(ReferenceContextSchema),
    collections: Type.Optional(Type.Array(ReferenceCollectionSchema, { default: [] })),
    mounts: Type.Optional(Type.Array(ReferenceMountSchema, { default: [] })),
    viewport: Type.Optional(PositiveSizeSchema),
    description: Type.Optional(Type.String({ minLength: 1 })),
    backdrop: Type.Optional(ReferenceBackdropSchema),
  },
  { $id: "UiReference", additionalProperties: false },
);

const NavigateActionSchema = Type.Object(
  {
    kind: Type.Literal("Navigate"),
    referenceKey: ArtifactKeySchema,
  },
  { additionalProperties: false },
);

const BackActionSchema = Type.Object(
  {
    kind: Type.Literal("Back"),
  },
  { additionalProperties: false },
);

const SetValueActionSchema = Type.Object(
  {
    kind: Type.Literal("SetValue"),
    owner: PreviewReferenceOwnerScopeSchema,
    fieldName: IdentifierSchema,
    capability: IdentifierSchema,
    value: Type.Unknown(),
  },
  { additionalProperties: false },
);

const PrototypeActionSchema = Type.Union([NavigateActionSchema, BackActionSchema, SetValueActionSchema]);

const PrototypeInteractionSchema = Type.Object(
  {
    referenceKey: ArtifactKeySchema,
    trigger: Type.Object(
      {
        kind: Type.Literal("Tap"),
        target: GraphTargetSchema,
      },
      { additionalProperties: false },
    ),
    actions: Type.Array(PrototypeActionSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const UiPrototypeSchema = Type.Object(
  {
    prototypeKey: ArtifactKeySchema,
    startReferenceKey: ArtifactKeySchema,
    interactions: Type.Array(PrototypeInteractionSchema),
  },
  { $id: "UiPrototype", additionalProperties: false },
);

export type ArtifactUseSite = Static<typeof ArtifactUseSiteSchema>;
export type GraphTarget = Static<typeof GraphTargetSchema>;
export type PreviewReferenceOwnerScope = Static<typeof PreviewReferenceOwnerScopeSchema>;
export type UiReference = Static<typeof UiReferenceSchema>;
export type ReferenceInstanceValues = Static<typeof ReferenceInstanceValuesSchema>;
export type ReferenceCollection = Static<typeof ReferenceCollectionSchema>;
export type ReferenceCollectionGroup = Static<typeof ReferenceCollectionGroupSchema>;
export type ReferenceCollectionItem = Static<typeof ReferenceCollectionItemSchema>;
export type ReferenceMount = Static<typeof ReferenceMountSchema>;
export type ReferenceBackdropImage = Static<typeof ReferenceBackdropImageSchema>;
export type PrototypeAction = Static<typeof PrototypeActionSchema>;
export type PrototypeInteraction = Static<typeof PrototypeInteractionSchema>;
export type UiPrototype = Static<typeof UiPrototypeSchema>;
