import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiResponse =
  | { code: number; message: string; error?: string; data?: unknown }
  | unknown;

export function success(c: Context, data: unknown) {
  return c.json(
    {
      code: 200,
      message: "success",
      data,
    },
    200,
  );
}

export function successRaw(c: Context, data: unknown) {
  return c.json(data as never, 200);
}

export function successWithMessage(c: Context, message: string, data: unknown) {
  return c.json(
    {
      code: 200,
      message,
      data,
    },
    200,
  );
}

export function error(c: Context, code: number, message: string) {
  return c.json(
    {
      code,
      message,
    },
    200,
  );
}

export function errorWithHttpStatus(c: Context, httpStatus: ContentfulStatusCode, code: number, message: string) {
  return c.json(
    {
      code,
      message,
    },
    httpStatus,
  );
}

export function internalServerError(c: Context, message: string) {
  return c.json(
    {
      code: 500,
      message,
      error: message,
    },
    500,
  );
}

export function badRequest(c: Context, message: string) {
  return error(c, 400, message);
}

export function notFound(c: Context, message: string) {
  return error(c, 404, message);
}

export function unauthorized(c: Context, message: string) {
  return errorWithHttpStatus(c, 401, 401, message);
}

export function forbidden(c: Context, message: string) {
  return errorWithHttpStatus(c, 403, 403, message);
}
