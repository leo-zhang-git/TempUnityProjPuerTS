import { Type } from "@sinclair/typebox";
import { UiSourceSchema } from "../../../schema/ui-source-schema.js";

const selectionSchema = Type.Object(
  {
    dependencyMode: Type.Union([Type.Literal("declared"), Type.Literal("dependencies")]),
    excludeArtifactKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

export const deliveryBodySchemas = {
  "unity.import": Type.Object(
    {
      prefabPath: Type.String({ minLength: 1 }),
      sourcePath: Type.String({ minLength: 1 }),
      initialSize: Type.Optional(Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })])),
      write: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  "unity.reconcile": Type.Object(
    {
      source: UiSourceSchema,
      scope: Type.Optional(Type.Union([Type.Literal("current"), Type.Literal("dependencies"), Type.Literal("all")])),
      selection: Type.Optional(selectionSchema),
    },
    { additionalProperties: false },
  ),
  "unity.sync": UiSourceSchema,
  "unity.publish": Type.Object(
    {
      source: UiSourceSchema,
      scope: Type.Optional(
        Type.Union([Type.Literal("current"), Type.Literal("dependencies"), Type.Literal("changes"), Type.Literal("all")]),
      ),
      selection: Type.Optional(selectionSchema),
      confirmScaffold: Type.Optional(Type.Boolean()),
      runClientTypecheck: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
} as const;
