import { describe, expect, it } from "vitest";
import { authCacheAction } from "@/lib/auth-cache";

describe("sincronización de Auth sin reiniciar consultas del inventario", () => {
  it("la sesión inicial conserva la consulta que ya está cargando el perfil", () => {
    expect(authCacheAction("INITIAL_SESSION", undefined, "a")).toEqual({
      clear: false,
      refreshIdentity: false,
      invalidateRouter: false,
      signedIn: false,
    });
  });
  it("renovar un token actualiza solo la identidad y no reinicia la navegación", () => {
    expect(authCacheAction("TOKEN_REFRESHED", "a", "a")).toEqual({
      clear: false,
      refreshIdentity: true,
      invalidateRouter: false,
      signedIn: false,
    });
  });
  it("un SIGNED_IN repetido al enfocar la ventana no recarga datos", () => {
    expect(authCacheAction("SIGNED_IN", "a", "a")).toEqual({
      clear: false,
      refreshIdentity: false,
      invalidateRouter: false,
      signedIn: false,
    });
  });
  it("cambiar de cuenta o salir siempre borra cachés y revalida rutas", () => {
    for (const action of [
      authCacheAction("SIGNED_IN", "a", "b"),
      authCacheAction("INITIAL_SESSION", "a", "b"),
      authCacheAction("SIGNED_OUT", "a", null),
    ]) {
      expect(action.clear).toBe(true);
      expect(action.invalidateRouter).toBe(true);
    }
  });
  it("actualizar el usuario refresca permisos y acceso a la ruta", () => {
    expect(authCacheAction("USER_UPDATED", "a", "a")).toMatchObject({
      clear: false,
      refreshIdentity: true,
      invalidateRouter: true,
    });
  });
});
