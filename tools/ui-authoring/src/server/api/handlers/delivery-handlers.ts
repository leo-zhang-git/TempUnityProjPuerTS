import { Value } from "@sinclair/typebox/value";
import { validateSourceReadiness } from "../../../kernel/validation.js";
import type { UiApiJsonRouteKey, UiApiSuccess } from "../../../schema/ui-api.js";
import type { UiSource } from "../../../schema/ui-source-schema.js";
import type { UiPrefabImportRequest, UiPublishRequest, UiReconcileRequest } from "../../../schema/ui-unity-job.js";
import type { UnityJobApiService } from "../../unity-job-service.js";
import { uiApiMutableBodySchemas } from "../body-schemas.js";
import { badRequest, notFound } from "../errors.js";
import type { ApiJsonResponse } from "../http.js";
import type { RoutedApiRequest } from "../router.js";
import type { ApiHandlerGroup } from "./types.js";

type DeliveryRouteKey = "unity.import" | "unity.reconcile" | "unity.sync" | "unity.publish" | "unity.job";

interface DeliveryHandlerContext {
  readonly unityJobService: UnityJobApiService | undefined;
  readonly success: <K extends UiApiJsonRouteKey>(key: K, body: UiApiSuccess<K>) => ApiJsonResponse;
  readonly semantic: <T>(operation: () => T | Promise<T>) => Promise<T>;
  readonly validationError: (validation: ReturnType<typeof validateSourceReadiness>) => Error;
}

function requiredQuery(request: RoutedApiRequest, name: string): string {
  const value = request.url.searchParams.get(name);
  if (!value) throw badRequest(`Missing ${name} parameter`);
  return value;
}

export function createDeliveryHandlers(context: DeliveryHandlerContext): ApiHandlerGroup<DeliveryRouteKey> {
  const service = (): UnityJobApiService => {
    if (!context.unityJobService) throw new Error("Unity job service is unavailable");
    return context.unityJobService;
  };
  return {
    "unity.import": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["unity.import"], request.body))
        throw badRequest("Prefab Import request does not match the API contract");
      return context.success("unity.import", {
        job: await context.semantic(() => service().startImport(request.body as UiPrefabImportRequest)),
      });
    },
    "unity.reconcile": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["unity.reconcile"], request.body))
        throw badRequest("Unity reconcile request does not match the API contract");
      const reconcileRequest = request.body as UiReconcileRequest;
      const validation = validateSourceReadiness(reconcileRequest.source);
      if (!validation.valid) throw context.validationError(validation);
      return context.success("unity.reconcile", { job: await context.semantic(() => service().startReconcile(reconcileRequest)) });
    },
    "unity.sync": async (request) => {
      const validation = validateSourceReadiness(request.body);
      if (!validation.valid) throw context.validationError(validation);
      return context.success("unity.sync", { job: await context.semantic(() => service().startSync(request.body as UiSource)) });
    },
    "unity.publish": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["unity.publish"], request.body))
        throw badRequest("Unity publish request does not match the API contract");
      const publishRequest = request.body as UiPublishRequest;
      if (publishRequest.scope !== "changes") {
        const validation = validateSourceReadiness(publishRequest.source);
        if (!validation.valid) throw context.validationError(validation);
      }
      return context.success("unity.publish", {
        job: await context.semantic(() =>
          service().startPublish({
            ...publishRequest,
            runClientTypecheck: publishRequest.runClientTypecheck === true,
          }),
        ),
      });
    },
    "unity.job": async (request) => {
      const job = service().job(requiredQuery(request, "id"));
      if (!job) throw notFound("Unity job not found");
      return context.success("unity.job", { job });
    },
  };
}
