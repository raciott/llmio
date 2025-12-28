export function buildHeaders(source: Headers, withHeader: boolean, customHeaders: Record<string, string>, stream: boolean) {
  const headers = withHeader ? new Headers(source) : new Headers();

  if (stream) headers.set("X-Accel-Buffering", "no");

  // 删除不应该转发到上游的 headers
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.delete("x-goog-api-key");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("keep-alive");
  headers.delete("transfer-encoding");

  for (const [k, v] of Object.entries(customHeaders)) headers.set(k, v);

  return headers;
}
