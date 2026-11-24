import type { QueryClient } from "@tanstack/react-query";

export const REALTIME_QUERY_KEYS = [
  "actas",
  "acta",
  "equipos",
  "equipo",
  "empleado",
  "empleados",
  "portal",
  "panel",
  "estadisticas",
  "estadisticas_avanzadas",
  "certificaciones",
] as const;

/** Agrupa cambios de una transacción/importación sin cancelar repetidamente la lectura en curso. */
export function createRealtimeInvalidator(queryClient: QueryClient, delay = 300) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fetching = false;
  let disposed = false;

  function schedule() {
    if (!disposed && !fetching && !timer && pending.size) timer = setTimeout(flush, delay);
  }

  async function flush() {
    timer = undefined;
    if (disposed) return;
    const keys = new Set(pending);
    pending.clear();
    fetching = true;
    try {
      await queryClient.invalidateQueries({
        predicate: (query) => typeof query.queryKey[0] === "string" && keys.has(query.queryKey[0]),
      });
    } finally {
      fetching = false;
      // Si llegaron filas mientras leíamos, volver a consultar al terminar.
      schedule();
    }
  }

  return {
    add(key: string) {
      if (disposed) return;
      pending.add(key);
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      pending.clear();
    },
  };
}
