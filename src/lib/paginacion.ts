export function normalizarPaginacion(page: unknown, pageSize: unknown) {
  const pagina = Number(page);
  const tamano = Number(pageSize);
  const p = Number.isSafeInteger(pagina) && pagina > 0 ? pagina : 1;
  const t = [10, 25, 50, 100].includes(tamano) ? tamano : 25;
  return { pagina: p, tamano: t, desde: (p - 1) * t, hasta: p * t - 1 };
}
