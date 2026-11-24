import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearSupabaseMock } from "../helpers/supabase-mock";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn() }));
const state = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth, from: state.from } }));
import { loadVerifiedMe, meQuery } from "@/lib/me";

const load = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } }).fetchQuery(meQuery);

describe("identidad validada en Supabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = crearSupabaseMock({
      onQuery: (q) => ({
        data:
          q.table === "profiles"
            ? { activo: true, nombre: "Auxiliar" }
            : q.table === "user_roles"
              ? [{ role: "auxiliar" }]
              : [{ permiso: "reportes_exportar" }],
      }),
    });
    state.from.mockImplementation(db.client.from);
  });
  it("no acepta una sesión local si Supabase rechaza al usuario", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "forged" } } } });
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect(await load()).toBeNull();
    expect(state.from).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
  });
  it("propaga fallos de red sin recuperar permisos de una sesión antigua", async () => {
    auth.getUser.mockRejectedValue(new Error("network unavailable"));
    await expect(load()).rejects.toThrow("network unavailable");
    expect(state.from).not.toHaveBeenCalled();
  });
  it("carga los permisos del usuario validado e ignora user_metadata", async () => {
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "verified",
          email: "test@example.com",
          app_metadata: {},
          user_metadata: { role: "admin", permisos_extra: ["cargas_masivas"] },
        },
      },
      error: null,
    });
    const me = await load();
    expect(me?.id).toBe("verified");
    expect(me?.isAdmin).toBe(false);
    expect(me?.can("reportes_exportar")).toBe(true);
    expect(me?.can("cargas_masivas")).toBe(false);
  });
});

describe("navegación con identidad validada y caché breve", () => {
  const session = (id: string | null) => ({
    data: { session: id ? { user: { id } } : null },
    error: null,
  });
  let qc: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const db = crearSupabaseMock({
      onQuery: (q) => ({
        data:
          q.table === "profiles"
            ? { activo: true, nombre: "Usuario" }
            : q.table === "user_roles"
              ? [{ role: "auxiliar" }]
              : [],
      }),
    });
    state.from.mockImplementation(db.client.from);
    auth.getSession.mockResolvedValue(session("a"));
    auth.getUser.mockResolvedValue({
      data: { user: { id: "a", email: "a@example.com" } },
      error: null,
    });
  });
  afterEach(() => {
    qc.clear();
    vi.useRealTimers();
  });

  it("comparte una sola validación remota entre preload, entrada y navegación reciente", async () => {
    const [preload, page] = await Promise.all([loadVerifiedMe(qc), loadVerifiedMe(qc)]);
    expect(preload?.id).toBe("a");
    expect(page?.id).toBe("a");
    expect((await loadVerifiedMe(qc))?.id).toBe("a");
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(state.from).toHaveBeenCalledTimes(3);
  });

  it("vuelve a validar permisos después de 30 segundos", async () => {
    vi.useFakeTimers();
    await loadVerifiedMe(qc);
    await vi.advanceTimersByTimeAsync(30_001);
    await loadVerifiedMe(qc);
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });

  it("no reutiliza permisos de otra cuenta aunque el caché sea reciente", async () => {
    await loadVerifiedMe(qc);
    auth.getSession.mockResolvedValue(session("b"));
    auth.getUser.mockResolvedValue({ data: { user: { id: "b" } }, error: null });
    expect((await loadVerifiedMe(qc))?.id).toBe("b");
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });

  it("rechaza una sesión local cuando getUser no confirma su identidad", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect(await loadVerifiedMe(qc)).toBeNull();
    expect(state.from).not.toHaveBeenCalled();
    expect(qc.getQueryData(meQuery.queryKey)).toBeUndefined();
  });

  it("descarta el resultado si la cuenta cambia mientras llegan los permisos", async () => {
    auth.getSession.mockResolvedValueOnce(session("a")).mockResolvedValue(session("b"));
    expect(await loadVerifiedMe(qc)).toBeNull();
    expect(qc.getQueryData(meQuery.queryKey)).toBeUndefined();
  });

  it("un cierre de sesión elimina el perfil validado anterior", async () => {
    await loadVerifiedMe(qc);
    auth.getSession.mockResolvedValue(session(null));
    expect(await loadVerifiedMe(qc)).toBeNull();
    expect(qc.getQueryData(meQuery.queryKey)).toBeUndefined();
  });
});
