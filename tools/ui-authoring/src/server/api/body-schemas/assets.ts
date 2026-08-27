import { Type } from "@sinclair/typebox";

const AssetPathSchema = Type.String({ minLength: 1 });

export const assetBodySchemas = {
  "assets.operation": Type.Union([
    Type.Object({ action: Type.Literal("move"), from: AssetPathSchema, to: AssetPathSchema }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("copy"), from: AssetPathSchema, to: AssetPathSchema }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("delete"), path: AssetPathSchema }, { additionalProperties: false }),
  ]),
} as const;
