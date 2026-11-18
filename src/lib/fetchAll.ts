// Supabase limita cada consulta a 1000 filas; esto pagina hasta traer todo.
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Fragmenta IN para no exceder el tamaño de URL; cada fragmento pagina su resultado. */
export async function fetchByIds<T>(
  ids: string[],
  build: (
    ids: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    rows.push(...(await fetchAll((from, to) => build(unique.slice(i, i + 100), from, to))));
  }
  return rows;
}
