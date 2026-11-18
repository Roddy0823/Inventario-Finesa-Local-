import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearSupabaseMock, type SupabaseMock } from "../helpers/supabase-mock";

const h = vi.hoisted(() => ({ admin: null as unknown as { client: Record<string, unknown> } }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy({}, { get: (_t, p) => h.admin.client[p as string] }),
}));
import { adjuntarFirmaTecnico } from "@/lib/ajustes.functions";

const ACTA = "a0000000-0000-4000-8000-000000000001";
const TECNICO = "b0000000-0000-4000-8000-000000000002";
let admin: SupabaseMock;
let context: unknown;
const call = () =>
  (adjuntarFirmaTecnico as unknown as (opts: unknown) => Promise<unknown>)({
    data: { actaId: ACTA },
    context,
  });

beforeEach(() => {
  admin = crearSupabaseMock();
  h.admin = admin as unknown as typeof h.admin;
  const scoped = crearSupabaseMock({
    onRpc: (name) => (name === "is_staff" ? { data: true } : undefined),
    onQuery: () => ({
      data: { id: ACTA, tecnico_id: TECNICO, estado: "pendiente", tecnico_firma_path: null },
    }),
  });
  context = { userId: TECNICO, supabase: scoped.client };
});

function respuestaPerdida(current: () => string | null) {
  admin.setOnQuery((q) => {
    if (q.table === "profiles") return { data: { firma_path: "perfiles/firma.png" } };
    if (q.op === "update") return { data: null, error: { message: "Respuesta perdida" } };
    return { data: { tecnico_firma_path: current() } };
  });
}

describe("copia inmutable de la firma técnica", () => {
  it("conserva la copia si el resultado del UPDATE aún es incierto", async () => {
    respuestaPerdida(() => null);
    await expect(call()).rejects.toThrow("Respuesta perdida");
    expect(admin.storageCopy).toHaveBeenCalledOnce();
    expect(admin.storageRemove).not.toHaveBeenCalled();
  });

  it("recupera una confirmación cuya respuesta se perdió sin eliminar su firma", async () => {
    respuestaPerdida(() => admin.storageCopy.mock.calls[0]![1]);
    await expect(call()).resolves.toEqual({ ok: true });
    expect(admin.storageRemove).not.toHaveBeenCalled();
  });

  it("limpia únicamente su copia cuando otra solicitud ya fijó la firma", async () => {
    respuestaPerdida(() => `${ACTA}/otra-firma.png`);
    await expect(call()).resolves.toEqual({ ok: true });
    expect(admin.storageRemove).toHaveBeenCalledWith([admin.storageCopy.mock.calls[0]![1]]);
    expect(admin.storageRemove).not.toHaveBeenCalledWith(["perfiles/firma.png"]);
  });
});
