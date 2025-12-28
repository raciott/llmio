import type { Context } from "hono";

export type PaginationParams = {
  page: number;
  page_size: number;
};

export type PaginationResponse<T> = {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};

const DefaultPageSize = 20;
const MaxPageSize = 100;

export function parsePagination(c: Context, defaults: { page?: number; page_size?: number } = {}): PaginationParams | Error {
  const defaultPage = defaults.page ?? 1;
  const defaultPageSize = defaults.page_size ?? DefaultPageSize;

  const pageStr = c.req.query("page");
  const page = pageStr ? Number.parseInt(pageStr, 10) : defaultPage;
  if (!Number.isFinite(page) || page < 1) return new Error("invalid page parameter");

  const pageSizeStr = c.req.query("page_size");
  const page_size = pageSizeStr ? Number.parseInt(pageSizeStr, 10) : defaultPageSize;
  if (!Number.isFinite(page_size) || page_size < 1 || page_size > MaxPageSize) {
    return new Error(`invalid page_size parameter (1-${MaxPageSize})`);
  }

  return { page, page_size };
}

export function newPaginationResponse<T>(data: T[], total: number, params: PaginationParams): PaginationResponse<T> {
  const pages = Math.ceil(total / params.page_size);
  return { data, total, page: params.page, page_size: params.page_size, pages };
}

export function limitOffset(params: PaginationParams) {
  const offset = (params.page - 1) * params.page_size;
  return { limit: params.page_size, offset };
}
