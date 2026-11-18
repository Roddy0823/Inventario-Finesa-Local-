import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  actaDTO,
  cargarActaCompleta,
  clientIp,
  ejecutarFirma,
  registrarAuditoria,
} from "./firmas.server";
import { checkRateLimit } from "./security.server";

const firmaSchema = z.string().max(3_000_000).startsWith("data:image/png;base64,");
const VIGENCIA_ENLACE_MS = 15 * 60_000;

async function validarToken(token: string, aceptarUsado = false) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("tokens_firma")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error("No se pudo validar el enlace. Intente nuevamente.");
  if (!data) return { admin: supabaseAdmin, error: "El enlace no es válido." as const };
  if (data.used_at && !aceptarUsado)
    return { admin: supabaseAdmin, error: "Este enlace ya fue utilizado." as const };
  // Limitar también los enlaces emitidos antes del cambio de vigencia.
  const expires = Math.min(
    new Date(data.expires_at).getTime(),
    new Date(data.created_at).getTime() + VIGENCIA_ENLACE_MS,
  );
  if (!data.used_at && (!Number.isFinite(expires) || expires <= Date.now()))
    return {
      admin: supabaseAdmin,
      error:
        "El enlace venció (vigencia de 15 minutos). Solicite que generen y le envíen un nuevo enlace." as const,
    };
  return { admin: supabaseAdmin, tk: data, expires: new Date(expires).toISOString() };
}

export const crearEnlaceFirma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ actaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_permiso", {
      _user_id: context.userId,
      _p: "firmas_capturar",
    });
    if (!ok) throw new Error("No tiene permiso para generar enlaces de firma.");
    const { data: acta } = await context.supabase
      .from("actas")
      .select("id, estado")
      .eq("id", data.actaId)
      .maybeSingle();
    if (!acta || acta.estado !== "pendiente")
      throw new Error("El acta no está pendiente de firma.");
    const { signatureOrigin } = await import("./signature-origin.server");
    const origin = signatureOrigin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: revokeError } = await supabaseAdmin
      .from("tokens_firma")
      .update({ used_at: new Date().toISOString() })
      .eq("acta_id", data.actaId)
      .is("used_at", null);
    if (revokeError)
      throw new Error(
        "No se pudo invalidar el enlace anterior. Intente generar el enlace nuevamente.",
      );
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const expires = new Date(Date.now() + VIGENCIA_ENLACE_MS).toISOString();
    const { error } = await supabaseAdmin
      .from("tokens_firma")
      .insert({ acta_id: data.actaId, token, expires_at: expires, created_by: context.userId });
    if (error) throw new Error(error.message);
    await registrarAuditoria(
      supabaseAdmin,
      context.userId,
      "tokens_firma",
      "ENLACE",
      data.actaId,
      "Enlace de firma remota generado (15 minutos)",
    );
    return { token, expires, origin };
  });

export const obtenerActaPorToken = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(d))
  .handler(async ({ data }) => {
    const rl = checkRateLimit(`ver-token:${clientIp()}`, 25, 5 * 60_000);
    if (!rl.allowed)
      return { error: "Demasiadas solicitudes. Intente nuevamente en unos minutos.", acta: null };
    const v = await validarToken(data.token);
    if ("error" in v && v.error) return { error: v.error, acta: null };
    const c = await cargarActaCompleta(v.admin, v.tk!.acta_id);
    if (c.acta.estado !== "pendiente")
      return { error: "Esta acta ya no está pendiente de firma.", acta: null };
    return { error: null, acta: actaDTO(c), expires: v.expires };
  });

export const firmarConToken = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        firma: firmaSchema,
        ip: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const rl = checkRateLimit(`firmar-token:${clientIp()}`, 10, 5 * 60_000);
    if (!rl.allowed)
      throw new Error("Demasiados intentos de firma desde esta conexión. Espere unos minutos.");
    const v = await validarToken(data.token, true);
    if ("error" in v && v.error) throw new Error(v.error);
    // La RPC de confirmación consume el token en la misma transacción que el acta.
    return ejecutarFirma(v.admin, {
      actaId: v.tk!.acta_id,
      firmaDataUrl: data.firma,
      medio: "enlace remoto",
      actorId: null,
      ipCliente: data.ip,
      tokenFirma: data.token,
    });
  });

export const firmarPresencial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ actaId: z.string().uuid(), firma: firmaSchema, ip: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_permiso", {
      _user_id: context.userId,
      _p: "firmas_capturar",
    });
    if (!ok) throw new Error("No tiene permiso para capturar firmas.");
    // Verificar visibilidad en el ecosistema del usuario mediante RLS antes de usar cliente admin
    const { data: actaVisible } = await context.supabase
      .from("actas")
      .select("id, estado")
      .eq("id", data.actaId)
      .maybeSingle();
    if (!actaVisible || !["pendiente", "firmada"].includes(actaVisible.estado)) {
      throw new Error("El acta no está pendiente de firma o no pertenece a su ecosistema.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return ejecutarFirma(supabaseAdmin, {
      actaId: data.actaId,
      firmaDataUrl: data.firma,
      medio: "presencial",
      actorId: context.userId,
      ipCliente: data.ip,
    });
  });

export const firmarComoEmpleado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ actaId: z.string().uuid(), firma: firmaSchema, ip: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const [empleado, staff] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "empleado" }),
      context.supabase.rpc("is_staff", { _user_id: context.userId }),
    ]);
    if (empleado.error || staff.error || !empleado.data || staff.data)
      throw new Error("Esta operación requiere una cuenta exclusiva de empleado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const c = await cargarActaCompleta(supabaseAdmin, data.actaId);
    const emp = c.acta.empleado as unknown as { user_id: string | null } | null;
    if (!emp || emp.user_id !== context.userId) throw new Error("Esta acta no le pertenece.");
    return ejecutarFirma(supabaseAdmin, {
      actaId: data.actaId,
      firmaDataUrl: data.firma,
      medio: "portal del empleado",
      actorId: context.userId,
      ipCliente: data.ip,
    });
  });

export const urlArchivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ actaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS confirma que el usuario puede ver el acta (personal o el propio empleado)
    const { data: acta } = await context.supabase
      .from("actas")
      .select("id, pdf_path")
      .eq("id", data.actaId)
      .maybeSingle();
    if (!acta?.pdf_path) throw new Error("El acta no tiene PDF disponible.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s, error } = await supabaseAdmin.storage
      .from("actas")
      .createSignedUrl(acta.pdf_path, 300);
    if (error) throw new Error(error.message);
    return { url: s.signedUrl };
  });
