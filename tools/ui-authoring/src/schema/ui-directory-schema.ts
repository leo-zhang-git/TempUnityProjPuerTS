import { type Static, Type } from "@sinclair/typebox";

const UiDirectoryCoverSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("Artifact"), Type.Literal("Reference"), Type.Literal("Prototype")]),
    key: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const UiDirectoryMetadataSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    cover: Type.Optional(UiDirectoryCoverSchema),
  },
  { $id: "UiDirectoryMetadata", additionalProperties: false },
);

export type UiDirectoryCover = Static<typeof UiDirectoryCoverSchema>;
export type UiDirectoryMetadata = Static<typeof UiDirectoryMetadataSchema>;
