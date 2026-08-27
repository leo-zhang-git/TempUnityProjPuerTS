import { Type } from "@sinclair/typebox";
import { UiPrototypeSchema, UiReferenceSchema } from "../../../schema/ui-prototype-schema.js";
import { UiSourceSchema } from "../../../schema/ui-source-schema.js";

const ArtifactTransactionSchema = Type.Object(
  {
    upserts: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          source: UiSourceSchema,
          expectedContent: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        },
        { additionalProperties: false },
      ),
    ),
    deletes: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          expectedContent: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    saveMode: Type.Optional(Type.Union([Type.Literal("strict"), Type.Literal("repair")])),
  },
  { additionalProperties: false },
);

const WorkspaceSaveSchema = Type.Object(
  {
    artifacts: Type.Object(
      {
        upserts: Type.Array(
          Type.Object(
            {
              path: Type.String({ minLength: 1 }),
              source: UiSourceSchema,
              expectedRevision: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
            },
            { additionalProperties: false },
          ),
        ),
        deletes: Type.Array(
          Type.Object(
            { path: Type.String({ minLength: 1 }), expectedRevision: Type.String({ minLength: 1 }) },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    references: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          reference: UiReferenceSchema,
          expectedRevision: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    prototypes: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          prototype: UiPrototypeSchema,
          expectedRevision: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    nodeIdentityOperations: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1 }),
            mappings: Type.Array(
              Type.Object(
                {
                  ownerArtifactKey: Type.String({ pattern: "^[A-Z][A-Za-z0-9]*$" }),
                  beforeNodeId: Type.String({ pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$" }),
                  afterNodeId: Type.String({ pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$" }),
                },
                { additionalProperties: false },
              ),
              { minItems: 1 },
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

const guardedWriteSchema = (document: typeof UiReferenceSchema | typeof UiPrototypeSchema) =>
  Type.Object(
    {
      document,
      expectedContent: Type.Union([Type.String(), Type.Null()]),
      saveMode: Type.Optional(Type.Union([Type.Literal("strict"), Type.Literal("repair")])),
    },
    { additionalProperties: false },
  );

const WorkspaceDocumentKindSchema = Type.Union([Type.Literal("artifact"), Type.Literal("reference"), Type.Literal("prototype")]);
const WorkspaceKeySchema = Type.String({ pattern: "^[A-Z][A-Za-z0-9]*$" });
const WorkspaceDocumentOperationSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("move-document"),
      kind: WorkspaceDocumentKindSchema,
      key: WorkspaceKeySchema,
      nextKey: WorkspaceKeySchema,
      nextPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("duplicate-document"),
      kind: WorkspaceDocumentKindSchema,
      key: WorkspaceKeySchema,
      nextKey: WorkspaceKeySchema,
      nextPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("create-variant"),
      artifactKey: WorkspaceKeySchema,
      nextKey: WorkspaceKeySchema,
      nextPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("create-reference"),
      artifactKey: WorkspaceKeySchema,
      nextKey: WorkspaceKeySchema,
      nextPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("delete-document"), kind: WorkspaceDocumentKindSchema, key: WorkspaceKeySchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("create-directory"),
      path: Type.String({ minLength: 1 }),
      displayName: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("move-directory"), path: Type.String({ minLength: 1 }), nextPath: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object({ action: Type.Literal("delete-directory"), path: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
]);

export const documentBodySchemas = {
  "workspace.documents": WorkspaceDocumentOperationSchema,
  "workspace.save": WorkspaceSaveSchema,
  "artifact.transaction": ArtifactTransactionSchema,
  "reference.write": guardedWriteSchema(UiReferenceSchema),
  "prototype.write": guardedWriteSchema(UiPrototypeSchema),
} as const;
