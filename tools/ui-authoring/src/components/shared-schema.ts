import { Type } from "@sinclair/typebox";

export const vector2Schema = Type.Tuple([Type.Number(), Type.Number()]);
export const nodeIdSchema = Type.String({ pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$" });
export const requiredNodeReferenceSchema = Type.Union([Type.Literal(""), nodeIdSchema], { default: "" });
const artifactKeySchema = Type.String({ pattern: "^[A-Z][A-Za-z0-9]*$" });
export const artifactReferenceSchema = artifactKeySchema;
export const requiredArtifactReferenceSchema = Type.Union([Type.Literal(""), artifactKeySchema], { default: "" });
export const stateNameSchema = Type.String({ minLength: 1, pattern: "^[^/\\\\]+$" });
export const colorSchema = Type.String({ pattern: "^#[0-9A-Fa-f]{8}$" });
export const assetPathSchema = Type.String({ pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+" });
export const selectableTransitionSchema = Type.Union([Type.Literal("none"), Type.Literal("colorTint")], { default: "colorTint" });

export const directionSchema = Type.Union(
  [Type.Literal("leftToRight"), Type.Literal("rightToLeft"), Type.Literal("bottomToTop"), Type.Literal("topToBottom")],
  { default: "leftToRight" },
);

export const childAlignmentSchema = Type.Union(
  [
    Type.Literal("upperLeft"),
    Type.Literal("upperCenter"),
    Type.Literal("upperRight"),
    Type.Literal("middleLeft"),
    Type.Literal("middleCenter"),
    Type.Literal("middleRight"),
    Type.Literal("lowerLeft"),
    Type.Literal("lowerCenter"),
    Type.Literal("lowerRight"),
  ],
  { default: "upperLeft" },
);
