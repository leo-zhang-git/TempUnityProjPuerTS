import { Type } from "@sinclair/typebox";

const SemanticSearchCandidateSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    texts: Type.Array(Type.String({ minLength: 1, maxLength: 500_000 }), { minItems: 1, maxItems: 8 }),
  },
  { additionalProperties: false },
);

export const searchBodySchemas = {
  "workspace.semanticSearch": Type.Object(
    {
      query: Type.String({ minLength: 1, maxLength: 500_000 }),
      candidates: Type.Array(SemanticSearchCandidateSchema, { maxItems: 10_000 }),
    },
    { additionalProperties: false },
  ),
} as const;
