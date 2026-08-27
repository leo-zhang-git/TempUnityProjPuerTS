import { Type } from "@sinclair/typebox";
import { UiReferenceSchema } from "../../../schema/ui-prototype-schema.js";
import { UiSourceSchema } from "../../../schema/ui-source-schema.js";

const CaptureClipSchema = Type.Object(
  {
    nodeId: Type.String({ minLength: 1 }),
    instancePath: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

const CapturePreviewSchema = Type.Object(
  {
    states: Type.Optional(Type.Record(Type.String(), Type.String())),
    inputs: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
  },
  { additionalProperties: false },
);

export const diagnosticsBodySchemas = {
  "diagnostics.clear": Type.Object({ through: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
  "diagnostics.report": Type.Object(
    {
      timestamp: Type.String({ minLength: 1, maxLength: 64 }),
      message: Type.String({ minLength: 1, maxLength: 16_384 }),
      stack: Type.Optional(Type.String({ maxLength: 65_536 })),
    },
    { additionalProperties: false },
  ),
  capture: Type.Object(
    {
      path: Type.String({ minLength: 1 }),
      overlays: Type.Optional(
        Type.Array(
          Type.Object(
            {
              path: Type.String({ minLength: 1 }),
              source: UiSourceSchema,
            },
            { additionalProperties: false },
          ),
        ),
      ),
      deletedPaths: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      reference: Type.Optional(UiReferenceSchema),
      viewport: Type.Optional(Type.Tuple([Type.Integer({ minimum: 1, maximum: 8192 }), Type.Integer({ minimum: 1, maximum: 8192 })])),
      scale: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])),
      clip: Type.Optional(CaptureClipSchema),
      preview: Type.Optional(CapturePreviewSchema),
      background: Type.Optional(Type.String()),
      draft: Type.Optional(Type.Boolean()),
      includeDebug: Type.Optional(Type.Boolean()),
      output: Type.Optional(Type.String({ minLength: 1 })),
      displayMode: Type.Optional(Type.Literal("unityBaseline")),
    },
    { additionalProperties: false },
  ),
} as const;
