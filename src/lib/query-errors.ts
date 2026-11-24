/** Solo fallos recuperables de transporte/servidor permiten mostrar la última lectura válida. */
export function isTransientQueryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = detail.status ?? detail.statusCode;
  const code = detail.code ?? "";
  if (status === 401 || status === 403 || code === "42501" || /^PGRST30[123]$/.test(code))
    return false;
  if (status && status >= 400 && status < 500) return status === 408 || status === 429;
  if (status && status >= 500) return true;
  if (code === "57014" || /^PGRST00[012]$/.test(code)) return true;
  return /failed to fetch|fetch failed|network(?:error| error| request failed| unavailable)|load failed|timeout|timed out|econnreset|econnrefused|socket hang up|connection (?:closed|reset|refused)|temporarily unavailable/i.test(
    detail.message ?? "",
  );
}

export type QueryFailureState = { isError: boolean; data: unknown; error: unknown };

export function hasBlockingQueryError(query: QueryFailureState): boolean {
  return query.isError && (query.data === undefined || !isTransientQueryError(query.error));
}
