import type { TSchema } from "@sinclair/typebox";
import type { UiApiRouteKey } from "../../schema/ui-api.js";
import { assetBodySchemas } from "./body-schemas/assets.js";
import { deliveryBodySchemas } from "./body-schemas/delivery.js";
import { diagnosticsBodySchemas } from "./body-schemas/diagnostics.js";
import { documentBodySchemas } from "./body-schemas/documents.js";
import { searchBodySchemas } from "./body-schemas/search.js";
import { workspaceBodySchemas } from "./body-schemas/workspace.js";

export const uiApiMutableBodySchemas = {
  ...workspaceBodySchemas,
  ...documentBodySchemas,
  ...searchBodySchemas,
  ...deliveryBodySchemas,
  ...assetBodySchemas,
  ...diagnosticsBodySchemas,
} as const satisfies Partial<Record<UiApiRouteKey, TSchema>>;
