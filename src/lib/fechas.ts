/** Fechas civiles de Colombia, independientes de la zona horaria del navegador. */
export function hoyColombia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function inicioDiaColombia(fecha: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Fecha inválida");
  const date = new Date(`${fecha}T00:00:00-05:00`);
  if (!Number.isFinite(date.getTime()) || hoyColombia(date) !== fecha)
    throw new Error("Fecha inválida");
  return date.toISOString();
}

export function finExclusivoColombia(fecha: string): string {
  return new Date(Date.parse(inicioDiaColombia(fecha)) + 86_400_000).toISOString();
}
