import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Permiso } from "./constantes";

export type Me = {
  id: string;
  email: string;
  nombre: string;
  lastSignInAt?: string | undefined;
  activo: boolean;
  roles: string[];
  permisos: Permiso[];
  isAdmin: boolean;
  isStaff: boolean;
  isEmpleado: boolean;
  can: (p: Permiso) => boolean;
};

export const meQuery = queryOptions({
  queryKey: ["me"],
  staleTime: 30_000,
  gcTime: 10 * 60_000,
  refetchOnWindowFocus: false,
  queryFn: async (): Promise<Me | null> => {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (error.status === 401 || error.status === 403 || error.name === "AuthSessionMissingError")
        return null;
      throw error;
    }
    const user = data.user;
    if (!user) return null;
    const id = user.id;
    const [p, r, pe] = await Promise.all([
      supabase.from("profiles").select("activo, nombre").eq("id", id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", id),
      supabase.from("user_permisos").select("permiso").eq("user_id", id),
    ]);
    if (p.error) throw p.error;
    if (r.error) throw r.error;
    if (pe.error) throw pe.error;
    const roles = (r.data ?? []).map((x) => x.role as string);
    const dbPermisos = (pe.data ?? []).map((x) => x.permiso as Permiso);
    const rawExtra = (user.app_metadata as { permisos_extra?: unknown } | undefined)
      ?.permisos_extra;
    const extraPermisos = Array.isArray(rawExtra)
      ? (rawExtra.filter((x): x is string => typeof x === "string") as Permiso[])
      : [];
    const permisos = [...new Set<Permiso>([...dbPermisos, ...extraPermisos])];
    const activo = p.data?.activo ?? false;
    const isAdmin = activo && roles.includes("admin");
    const isStaff = activo && (isAdmin || roles.includes("auxiliar"));
    return {
      id,
      email: user.email ?? "",
      nombre: p.data?.nombre || user.email || "",
      lastSignInAt: user.last_sign_in_at,
      activo,
      roles,
      permisos,
      isAdmin,
      isStaff,
      isEmpleado: activo && roles.includes("empleado") && !isStaff,
      can: (x) => isAdmin || (isStaff && permisos.includes(x)),
    };
  },
});

/** La sesión local solo identifica cambios de cuenta; los permisos vienen de getUser + RLS. */
export async function loadVerifiedMe(queryClient: QueryClient): Promise<Me | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const sessionId = data.session?.user.id;
  const cached = queryClient.getQueryData(meQuery.queryKey);
  if (!sessionId || (cached && cached.id !== sessionId)) {
    await queryClient.cancelQueries({ queryKey: meQuery.queryKey });
    queryClient.removeQueries({ queryKey: meQuery.queryKey });
  }
  if (!sessionId) return null;

  const me = await queryClient.fetchQuery(meQuery);
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (me?.id !== sessionId || current.data.session?.user.id !== sessionId) {
    queryClient.removeQueries({ queryKey: meQuery.queryKey });
    return null;
  }
  return me;
}

export function useMe() {
  return useQuery(meQuery);
}
