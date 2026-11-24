import type { AuthChangeEvent } from "@supabase/supabase-js";

/** Un token renovado no implica que hayan cambiado todos los datos del inventario. */
export function authCacheAction(
  event: AuthChangeEvent,
  previousUserId: string | null | undefined,
  nextUserId: string | null,
) {
  const changedUser = previousUserId !== undefined && previousUserId !== nextUserId;
  return {
    clear: changedUser || event === "SIGNED_OUT",
    refreshIdentity: event === "TOKEN_REFRESHED" || event === "USER_UPDATED",
    invalidateRouter:
      changedUser ||
      event === "SIGNED_OUT" ||
      event === "USER_UPDATED" ||
      event === "PASSWORD_RECOVERY" ||
      (event === "SIGNED_IN" && previousUserId === undefined),
    signedIn: event === "SIGNED_IN" && (changedUser || previousUserId === undefined),
  };
}
