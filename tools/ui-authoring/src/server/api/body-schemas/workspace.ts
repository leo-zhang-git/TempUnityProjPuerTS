import { Type } from "@sinclair/typebox";

const CollaborationDocumentSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("artifact"), Type.Literal("reference"), Type.Literal("prototype")]),
    key: Type.String({ minLength: 1, maxLength: 256 }),
    path: Type.String({ minLength: 1, maxLength: 2048 }),
  },
  { additionalProperties: false },
);

const CollaborationStatusSchema = Type.Object(
  {
    documents: Type.Array(CollaborationDocumentSchema, { maxItems: 256 }),
  },
  { additionalProperties: false },
);

export const workspaceBodySchemas = {
  "workspace.vcs": Type.Object(
    {
      action: Type.Union([Type.Literal("commit"), Type.Literal("update")]),
    },
    { additionalProperties: false },
  ),
  "artifact.svn.revert": Type.Object(
    {
      path: Type.String({ minLength: 1 }),
      expectedRevision: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  "collaboration.profile.write": Type.Object(
    {
      userName: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
  "collaboration.status": CollaborationStatusSchema,
  "collaboration.activity": CollaborationStatusSchema,
  "collaboration.presence": Type.Object(
    {
      sessionId: Type.String({ minLength: 1, maxLength: 128 }),
      documents: Type.Array(CollaborationDocumentSchema, { maxItems: 256 }),
    },
    { additionalProperties: false },
  ),
} as const;
