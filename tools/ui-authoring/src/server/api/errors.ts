import type { UiApiFailure } from "../../schema/ui-api.js";

export type ApiErrorStatus = 400 | 404 | 409 | 422 | 500;

export class ApiHttpError extends Error {
  readonly status: ApiErrorStatus;
  readonly body: UiApiFailure;

  constructor(status: ApiErrorStatus, body: UiApiFailure, options?: ErrorOptions) {
    super("error" in body ? body.error : "API request validation failed", options);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
}

export function badRequest(message: string, options?: ErrorOptions): ApiHttpError {
  return new ApiHttpError(400, { error: message }, options);
}

export function notFound(message: string, options?: ErrorOptions): ApiHttpError {
  return new ApiHttpError(404, { error: message }, options);
}

export function conflict(message: string, options?: ErrorOptions): ApiHttpError {
  return new ApiHttpError(409, { error: message }, options);
}

export function unprocessable(body: UiApiFailure, options?: ErrorOptions): ApiHttpError {
  return new ApiHttpError(422, body, options);
}
