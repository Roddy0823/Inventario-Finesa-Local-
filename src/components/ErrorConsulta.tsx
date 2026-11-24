import { Button } from "@/components/ui/button";
import { hasBlockingQueryError, type QueryFailureState } from "@/lib/query-errors";

export function AvisoActualizacion({
  consultas,
}: {
  consultas: (QueryFailureState & { refetch: () => unknown })[];
}) {
  const pendientes = consultas.filter((query) => query.isError && !hasBlockingQueryError(query));
  if (!pendientes.length) return null;
  return (
    <ErrorConsulta
      mensaje="La conexión se interrumpió al actualizar. Se muestran los últimos datos recibidos; pueden haber cambiado."
      reintentar={() => Promise.all(pendientes.map((query) => query.refetch()))}
    />
  );
}

export function ErrorConsulta({
  reintentar,
  mensaje = "No se pudieron cargar los datos. Revise la conexión y vuelva a intentar.",
}: {
  reintentar: () => unknown;
  mensaje?: string;
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <p>{mensaje}</p>
      <Button variant="outline" onClick={() => void reintentar()}>
        Reintentar
      </Button>
    </div>
  );
}
