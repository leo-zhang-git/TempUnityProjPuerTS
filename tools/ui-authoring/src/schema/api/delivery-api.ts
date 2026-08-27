import type { UiSource } from "../ui-source-schema.js";
import type { UiPrefabImportRequest, UiPublishRequest, UiReconcileRequest, UiUnityJobSnapshot } from "../ui-unity-job.js";
import type { UiApiRoute, UiApiRouteDefinition } from "./contract.js";

export const deliveryApiRoutes = {
  "unity.import": { method: "POST", path: "/api/unity/import", responseKind: "json" },
  "unity.reconcile": { method: "POST", path: "/api/unity/reconcile", responseKind: "json" },
  "unity.sync": { method: "POST", path: "/api/unity/sync", responseKind: "json" },
  "unity.publish": { method: "POST", path: "/api/unity/publish", responseKind: "json" },
  "unity.job": { method: "GET", path: "/api/unity/job", responseKind: "json" },
} as const satisfies Readonly<Record<string, UiApiRouteDefinition>>;

export interface DeliveryApiContract {
  readonly "unity.import": UiApiRoute<"POST", undefined, UiPrefabImportRequest, { readonly job: UiUnityJobSnapshot }>;
  readonly "unity.reconcile": UiApiRoute<"POST", undefined, UiReconcileRequest, { readonly job: UiUnityJobSnapshot }>;
  readonly "unity.sync": UiApiRoute<"POST", undefined, UiSource, { readonly job: UiUnityJobSnapshot }>;
  readonly "unity.publish": UiApiRoute<"POST", undefined, UiPublishRequest, { readonly job: UiUnityJobSnapshot }>;
  readonly "unity.job": UiApiRoute<"GET", { readonly id: string }, undefined, { readonly job: UiUnityJobSnapshot }>;
}
