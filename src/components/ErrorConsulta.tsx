import { Button } from "@/components/ui/button";

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
