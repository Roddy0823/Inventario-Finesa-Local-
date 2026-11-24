import { describe, expect, it } from "vitest";
import { hasBlockingQueryError, isTransientQueryError } from "@/lib/query-errors";

describe("datos anteriores ante interrupciones de consultas", () => {
  it.each([
    new TypeError("Failed to fetch"),
    { message: "TypeError: fetch failed" },
    { status: 503 },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "PGRST002", message: "Could not query the database for the schema cache" },
  ])("conserva la lectura anterior ante un fallo recuperable %j", (error) => {
    expect(isTransientQueryError(error)).toBe(true);
    expect(hasBlockingQueryError({ data: [], isError: true, error })).toBe(false);
    expect(hasBlockingQueryError({ data: undefined, isError: true, error })).toBe(true);
  });

  it.each([
    { status: 401, message: "Failed to fetch" },
    { status: 403 },
    { code: "42501", message: "permission denied" },
    { code: "PGRST301", message: "JWT expired" },
    { code: "PGRST302", message: "JWT missing" },
    { status: 400 },
    new Error("Error de consulta desconocido"),
  ])("nunca conserva datos para ocultar errores de acceso o consulta %j", (error) => {
    expect(isTransientQueryError(error)).toBe(false);
    expect(hasBlockingQueryError({ data: ["previo"], isError: true, error })).toBe(true);
  });
});
