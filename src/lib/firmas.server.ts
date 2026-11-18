import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { validarPngBase64 } from "./security.server";
import type { Database } from "@/integrations/supabase/types";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

export function clientIp() {
  if (process.env["LOCAL_ONLY"] === "true")
    return getRequestIP({ xForwardedFor: false }) || "desconocida";
  const cf = getRequestHeader("cf-connecting-ip");
  const xff = getRequestHeader("x-forwarded-for");
  return (
    cf || (xff ? xff.split(",")[0]!.trim() : "") || getRequestHeader("x-real-ip") || "desconocida"
  );
}

let serverEgressIpCache: { ip: string; timestamp: number } | null = null;

async function obtenerIpSalidaServidor(): Promise<string | null> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return null;
  }
  const ahora = Date.now();
  if (serverEgressIpCache && ahora - serverEgressIpCache.timestamp < 10 * 60_000) {
    return serverEgressIpCache.ip;
  }
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data?.ip) {
        serverEgressIpCache = { ip: data.ip, timestamp: ahora };
        return data.ip;
      }
    }
  } catch {
    /* fallback si no hay salida a internet o falla la resolución */
  }
  return null;
}

function esIpLocalOInvalida(ip?: string | null): boolean {
  if (!ip) return true;
  const normalizada = ip.trim().toLowerCase();
  return (
    normalizada === "" ||
    normalizada === "desconocida" ||
    normalizada === "127.0.0.1" ||
    normalizada === "::1" ||
    normalizada === "localhost" ||
    normalizada === "::ffff:127.0.0.1"
  );
}

export async function resolverIpFirma(opts?: {
  ipCliente?: string | null | undefined;
}): Promise<string> {
  if (process.env["LOCAL_ONLY"] === "true") {
    // Conexión directa local/LAN: ignorar cabeceras de proxy y datos del formulario.
    return getRequestIP({ xForwardedFor: false }) || "desconocida";
  }
  // 1. Cabeceras directas de proxy estándar
  const cf = getRequestHeader("cf-connecting-ip");
  if (cf && !esIpLocalOInvalida(cf)) return cf.trim();

  const xff = getRequestHeader("x-forwarded-for");
  if (xff) {
    const primera = xff.split(",")[0]?.trim();
    if (primera && !esIpLocalOInvalida(primera)) return primera;
  }

  const real = getRequestHeader("x-real-ip");
  if (real && !esIpLocalOInvalida(real)) return real.trim();

  const trueClient = getRequestHeader("true-client-ip") || getRequestHeader("x-client-ip");
  if (trueClient && !esIpLocalOInvalida(trueClient)) return trueClient.trim();

  // 2. IP del socket / conexión HTTP de TanStack Start
  try {
    const socketIp =
      typeof getRequestIP === "function" ? getRequestIP({ xForwardedFor: true }) : undefined;
    if (socketIp) {
      const limpia = socketIp.replace(/^::ffff:/, "").trim();
      if (!esIpLocalOInvalida(limpia)) return limpia;
    }
  } catch {
    /* getRequestIP no disponible o no aplicable */
  }

  // 3. IP reportada por el navegador del cliente (detectada vía detectarIpNavegador)
  if (opts?.ipCliente && !esIpLocalOInvalida(opts.ipCliente)) {
    return opts.ipCliente.trim();
  }

  // 4. IP pública de salida corporativa (ej. Artemis 190.90.34.66) consultada desde el servidor
  const ipSalida = await obtenerIpSalidaServidor();
  if (ipSalida && !esIpLocalOInvalida(ipSalida)) {
    return ipSalida;
  }

  // 5. Último recurso (compatibilidad con clientIp())
  return clientIp();
}

export async function registrarAuditoria(
  admin: Admin,
  userId: string | null,
  tabla: string,
  accion: string,
  registroId: string | null,
  detalle: string,
) {
  const { error } = await admin
    .from("auditoria")
    .insert({ user_id: userId, tabla, accion, registro_id: registroId, detalle });
  if (error) throw new Error("No se pudo registrar la auditoría: " + error.message);
}

type JsonRpc = "reservar_firma" | "confirmar_firma" | "reservar_intento_pin";
/** Las RPC JSON requieren confirmación; las RPC void se comprueban directamente. */
export async function rpcServidor<T>(
  admin: Admin,
  name: JsonRpc,
  args: Database["public"]["Functions"][JsonRpc]["Args"],
): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data === null) throw new Error(`La operación ${name} no devolvió confirmación.`);
  return data as T;
}

export async function cargarActaCompleta(admin: Admin, actaId: string) {
  const { data: acta, error } = await admin
    .from("actas")
    .select(
      "*, empleado:empleados(id, nombre, identificacion, email, cargo, user_id, area:catalogo_items!empleados_area_id_fkey(nombre), sede:catalogo_items!empleados_sede_id_fkey(nombre), empresa:catalogo_items!empleados_empresa_id_fkey(nombre))",
    )
    .eq("id", actaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!acta) throw new Error("Acta no encontrada");
  const { data: items, error: itemsError } = await admin
    .from("acta_items")
    .select(
      "estado_fisico, accesorios, nota, direccion, estado_destino, equipo:equipos(id, serie, activo_fijo, modelo, tipo:catalogo_items!equipos_tipo_id_fkey(nombre), marca:catalogo_items!equipos_marca_id_fkey(nombre))",
    )
    .eq("acta_id", actaId);
  if (itemsError)
    throw new Error("No se pudieron cargar los equipos del acta: " + itemsError.message);
  return {
    acta,
    equipos: (items ?? [])
      .filter((i) => i.equipo)
      .map((i) => ({
        ...(i.equipo as object),
        estado_fisico: i.estado_fisico,
        accesorios: i.accesorios,
        nota: i.nota,
        direccion: i.direccion,
        estado_destino: i.estado_destino,
      })) as unknown as NonNullable<typeof items>[number]["equipo"][],
  };
}

export type ActaCompleta = Awaited<ReturnType<typeof cargarActaCompleta>>;

export function actaDTO(c: ActaCompleta) {
  const a = c.acta;
  const e = a.empleado as unknown as {
    nombre: string;
    identificacion: string;
    email: string | null;
    cargo: string | null;
    area: { nombre: string } | null;
    sede: { nombre: string } | null;
    empresa: { nombre: string } | null;
  } | null;
  return {
    id: a.id,
    numero: a.numero,
    tipo: a.tipo,
    es_prestamo: !!(a as { es_prestamo?: boolean }).es_prestamo,
    prestamo_hasta: (a as { prestamo_hasta?: string | null }).prestamo_hasta ?? null,
    estado: a.estado,
    created_at: a.created_at,
    observaciones: a.observaciones,
    tecnico: a.tecnico_nombre,
    empleado: {
      nombre: e?.nombre ?? "",
      identificacion: e?.identificacion ?? "",
      cargo: e?.cargo ?? "",
      area: e?.area?.nombre ?? "",
      sede: e?.sede?.nombre ?? "",
      empresa: e?.empresa?.nombre ?? "",
    },
    equipos: c.equipos.map((q) => {
      const x = q as unknown as {
        serie: string;
        activo_fijo: string | null;
        modelo: string | null;
        tipo: { nombre: string } | null;
        marca: { nombre: string } | null;
        estado_fisico: string | null;
        accesorios: string | null;
        nota: string | null;
        direccion: string | null;
        estado_destino: string | null;
      };
      return {
        serie: x.serie,
        activo_fijo: x.activo_fijo ?? "",
        modelo: x.modelo ?? "",
        tipo: x.tipo?.nombre ?? "",
        marca: x.marca?.nombre ?? "",
        estado_fisico: x.estado_fisico ?? "",
        accesorios: x.accesorios ?? "",
        nota: x.nota ?? "",
        direccion: x.direccion ?? dtoTipo(a.tipo),
        estado_destino: x.estado_destino ?? "",
      };
    }),
  };
}
function dtoTipo(t: string) {
  return t === "devolucion" ? "devolucion" : "entrega";
}
export type ActaDTO = ReturnType<typeof actaDTO>;

function limpiar(s: string) {
  // Helvetica (WinAnsi) no soporta ciertos caracteres; se reemplazan.
  return (s ?? "").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

async function sha256Hex(data: Uint8Array | string) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const h = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generarPdf(
  dto: ActaDTO,
  firmaPng: Uint8Array,
  meta: { fecha: string; ip: string; medio: string; ua: string },
  tecnicoPng?: Uint8Array | null,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Acta ${dto.tipo} #${dto.numero}`);
  pdf.setAuthor("Finesa");
  pdf.setProducer("Finesa Inventario");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.043, 0.145, 0.27);
  const gray = rgb(0.35, 0.4, 0.48);
  const margin = 40,
    width = 515;
  let page = pdf.addPage([595, 842]);
  let y = 0;
  const header = () => {
    page.drawRectangle({ x: 0, y: 770, width: 595, height: 72, color: navy });
    page.drawText("FINESA", {
      x: margin,
      y: 808,
      size: 20,
      font: bold,
      color: rgb(0.93, 0.96, 0.93),
    });
    const title = `ACTA DE ${dto.tipo === "cambio" ? "CAMBIO / RENOVACION" : dto.tipo === "entrega" ? (dto.es_prestamo ? "PRESTAMO TEMPORAL" : "ENTREGA") : "DEVOLUCION"} No. ${dto.numero}`;
    page.drawText(limpiar(title), {
      x: margin,
      y: 785,
      size: 11,
      font,
      color: rgb(0.75, 0.82, 0.9),
    });
    y = 744;
  };
  header();
  const ensure = (height: number) => {
    if (y - height < 48) {
      page = pdf.addPage([595, 842]);
      header();
    }
  };
  const wrap = (value: string, size = 10, maxWidth = width, face = font) => {
    const result: string[] = [];
    for (const paragraph of String(value ?? "").split(/\r?\n/)) {
      const words = limpiar(paragraph).split(/\s+/);
      let line = "";
      for (const word of words) {
        if (!word) continue;
        const proposed = line ? line + " " + word : word;
        if (face.widthOfTextAtSize(proposed, size) <= maxWidth) {
          line = proposed;
          continue;
        }
        if (line) result.push(line);
        line = "";
        // Also wrap serial numbers, hashes and unbroken user input.
        for (const char of word) {
          if (line && face.widthOfTextAtSize(line + char, size) > maxWidth) {
            result.push(line);
            line = "";
          }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  };
  const paragraph = (value: string, size = 10, face = font, color = navy, inset = 0) => {
    for (const line of wrap(value, size, width - inset, face)) {
      ensure(size + 5);
      page.drawText(line, { x: margin + inset, y, size, font: face, color });
      y -= size + 5;
    }
  };
  const heading = (value: string) => {
    ensure(42);
    y -= 10;
    paragraph(value, 11, bold);
    y -= 3;
  };
  paragraph(
    `Fecha de elaboración: ${new Date(dto.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}`,
    9,
    font,
    gray,
  );
  heading("DATOS DEL EMPLEADO");
  for (const [label, value] of [
    ["Nombre", dto.empleado.nombre],
    ["Identificación", dto.empleado.identificacion],
    ["Cargo", dto.empleado.cargo],
    ["Área", dto.empleado.area],
    ["Sede", dto.empleado.sede],
    ["Empresa", dto.empleado.empresa],
  ])
    paragraph(`${label}: ${value || "—"}`);
  if (dto.es_prestamo)
    paragraph(
      `Préstamo temporal. Fecha estimada de devolución: ${dto.prestamo_hasta ?? "—"}`,
      10,
      bold,
    );
  const groups: [string, typeof dto.equipos][] =
    dto.tipo === "cambio"
      ? [
          ["EQUIPOS QUE RECIBE EL EMPLEADO", dto.equipos.filter((q) => q.direccion === "entrega")],
          [
            "EQUIPOS QUE DEVUELVE EL EMPLEADO",
            dto.equipos.filter((q) => q.direccion === "devolucion"),
          ],
        ]
      : [["EQUIPOS", dto.equipos]];
  const destinations: Record<string, string> = {
    disponible: "Disponible",
    en_alistamiento: "En alistamiento",
    en_reparacion: "En reparación",
  };
  for (const [title, list] of groups) {
    heading(title);
    for (const [index, q] of list.entries()) {
      ensure(60);
      paragraph(`${index + 1}. ${q.tipo} · ${q.marca} · ${q.modelo}`, 10, bold);
      paragraph(`Serie / código: ${q.serie}`, 9);
      if (q.activo_fijo) paragraph(`Activo fijo: ${q.activo_fijo}`, 9);
      paragraph(`Estado físico: ${q.estado_fisico || "—"}`, 9, font, gray);
      paragraph(`Accesorios: ${q.accesorios || "—"}`, 9, font, gray);
      if (q.direccion === "devolucion" && q.estado_destino)
        paragraph(
          `Estado de destino: ${destinations[q.estado_destino] ?? q.estado_destino}`,
          9,
          font,
          gray,
        );
      if (q.nota) paragraph(`Nota: ${q.nota}`, 9, font, gray);
      y -= 7;
    }
  }
  heading("OBSERVACIONES");
  paragraph(dto.observaciones || "Sin observaciones.", 9, font, gray);
  heading("DECLARACIÓN");
  const declaration =
    dto.tipo === "cambio"
      ? "El empleado declara devolver los equipos relacionados como devueltos y recibir en buen estado los equipos nuevos, comprometiéndose a su cuidado y uso exclusivo para fines laborales."
      : dto.tipo === "entrega" && dto.es_prestamo
        ? "El empleado recibe los equipos en calidad de préstamo temporal y se compromete a devolverlos en la fecha indicada o al terminar la reparación de su equipo."
        : dto.tipo === "entrega"
          ? "El empleado declara recibir los equipos relacionados en buen estado y se compromete a su cuidado y uso exclusivo para fines laborales, así como a devolverlos al finalizar su vínculo."
          : "El empleado declara haber devuelto los equipos relacionados. La recepción queda sujeta a verificación técnica.";
  paragraph(declaration, 9, font, gray);
  const employeeLines = wrap(
    `Firma: ${dto.empleado.nombre}\nC.C. ${dto.empleado.identificacion}`,
    9,
    235,
    bold,
  );
  const technicianLines = wrap(`Técnico: ${dto.tecnico ?? ""}`, 9, 235, bold);
  ensure(154);
  y -= 110;
  const drawSignature = async (bytes: Uint8Array, x: number) => {
    const png = await pdf.embedPng(bytes);
    const dims = png.scaleToFit(220, 90);
    page.drawImage(png, { x, y: y + 8, width: dims.width, height: dims.height });
  };
  await drawSignature(firmaPng, 40);
  if (tecnicoPng) await drawSignature(tecnicoPng, 320);
  for (const x of [40, 320]) {
    page.drawLine({ start: { x, y }, end: { x: x + 235, y }, thickness: 0.8, color: navy });
  }
  for (let i = 0; i < Math.max(employeeLines.length, technicianLines.length); i++) {
    ensure(28);
    y -= 14;
    for (const [x, lines] of [
      [40, employeeLines],
      [320, technicianLines],
    ] as const) {
      if (lines[i]) page.drawText(lines[i]!, { x, y, size: 9, font: bold, color: navy });
    }
  }
  y -= 16;
  heading("REGISTRO DE FIRMA ELECTRÓNICA (Ley 527 de 1999)");
  paragraph(`Fecha y hora: ${meta.fecha} (UTC)`, 8, font, gray);
  paragraph(`Medio: ${meta.medio} · IP: ${meta.ip}`, 8, font, gray);
  paragraph(`Dispositivo: ${meta.ua}`, 8, font, gray);
  paragraph(`Huella firma SHA-256: ${await sha256Hex(firmaPng)}`, 7, font, gray);
  paragraph(`Huella datos SHA-256: ${await sha256Hex(JSON.stringify(dto))}`, 7, font, gray);
  pdf.getPages().forEach((p, i) =>
    p.drawText(`Acta #${dto.numero} · Página ${i + 1} de ${pdf.getPageCount()}`, {
      x: margin,
      y: 25,
      size: 8,
      font,
      color: gray,
    }),
  );
  return pdf.save();
}

type FirmaConfirmada = { ok: true; numero: number; pdfHash: string; ya_firmada?: boolean };
type ReservaFirma = {
  lease_id?: string;
  acta_id: string;
  firmado_at: string;
  snapshot?: ActaCompleta;
  ya_firmada?: boolean;
  numero?: number;
  pdfHash?: string;
};

export async function ejecutarFirma(
  admin: Admin,
  opts: {
    actaId: string;
    firmaDataUrl: string;
    medio: string;
    actorId: string | null;
    ipCliente?: string | null | undefined;
    tokenFirma?: string;
  },
): Promise<FirmaConfirmada> {
  const pngCheck = validarPngBase64(opts.firmaDataUrl);
  if (!pngCheck.ok) throw new Error(pngCheck.error);
  const reserva = await rpcServidor<ReservaFirma>(admin, "reservar_firma", {
    p_acta: opts.actaId,
    p_actor: opts.actorId,
    p_token: opts.tokenFirma ?? null,
  });
  if (reserva.ya_firmada && reserva.numero !== undefined && reserva.pdfHash) {
    return { ok: true, numero: reserva.numero, pdfHash: reserva.pdfHash, ya_firmada: true };
  }
  if (
    !reserva.lease_id ||
    !/^[a-f0-9-]{36}$/i.test(reserva.lease_id) ||
    !reserva.snapshot ||
    !reserva.firmado_at
  ) {
    throw new Error("No se pudo reservar una versión verificable del acta.");
  }
  const lease = reserva.lease_id;
  const firmaPath = `${opts.actaId}/${lease}/firma.png`;
  const pdfPath = `${opts.actaId}/${lease}/acta.pdf`;
  const storage = admin.storage.from("actas");
  const uploaded: string[] = [];
  let confirmationStarted = false;
  try {
    const completa = reserva.snapshot;
    const dto = actaDTO(completa);
    const ip = await resolverIpFirma({ ipCliente: opts.ipCliente });
    const ua = (getRequestHeader("user-agent") ?? "").slice(0, 400);
    let tecnicoPng: Uint8Array | null = null;
    const technicalPath = completa.acta.tecnico_firma_path;
    if (technicalPath) {
      const { data: blob, error } = await storage.download(technicalPath);
      if (error || !blob) throw new Error("No se pudo cargar la firma del técnico.");
      tecnicoPng = new Uint8Array(await blob.arrayBuffer());
      const check = validarPngBase64(
        `data:image/png;base64,${Buffer.from(tecnicoPng).toString("base64")}`,
      );
      if (!check.ok) throw new Error("La firma del técnico no es una imagen válida.");
    }
    const pdfBytes = await generarPdf(
      dto,
      pngCheck.bytes,
      { fecha: reserva.firmado_at, ip, medio: opts.medio, ua },
      tecnicoPng,
    );
    const pdfHash = await sha256Hex(pdfBytes);
    for (const [path, bytes, contentType] of [
      [firmaPath, pngCheck.bytes, "image/png"],
      [pdfPath, pdfBytes, "application/pdf"],
    ] as const) {
      const { error } = await storage.upload(path, bytes, { contentType, upsert: false });
      if (error)
        throw new Error(
          `No se pudo guardar ${contentType === "image/png" ? "la firma" : "el PDF"}: ${error.message}`,
        );
      uploaded.push(path);
    }
    confirmationStarted = true;
    const result = await rpcServidor<FirmaConfirmada>(admin, "confirmar_firma", {
      p_acta: opts.actaId,
      p_lease: lease,
      p_actor: opts.actorId,
      p_firma_path: firmaPath,
      p_pdf_path: pdfPath,
      p_pdf_hash: pdfHash,
      p_medio: opts.medio,
      p_ip: ip,
      p_user_agent: ua,
    });
    if (!result.ok || !result.pdfHash || result.numero === undefined)
      throw new Error("No se confirmó la firma del acta.");
    return result;
  } catch (error) {
    // Cancelar primero se serializa con la confirmación en la fila de reserva:
    // una lectura pendiente por sí sola no descarta un commit aún en curso.
    const cancel = await admin.rpc("cancelar_firma", { p_acta: opts.actaId, p_lease: lease });
    if (cancel.error) {
      console.error("No se pudo liberar la reserva de firma:", cancel.error.message);
      throw error;
    }
    const current = await admin
      .from("actas")
      .select("estado, numero, firma_path, pdf_path, pdf_hash")
      .eq("id", opts.actaId)
      .maybeSingle();
    if (current.error) throw error;
    if (
      confirmationStarted &&
      current.data?.estado === "firmada" &&
      current.data.pdf_path === pdfPath &&
      current.data.firma_path === firmaPath &&
      current.data.pdf_hash
    ) {
      return {
        ok: true,
        numero: current.data.numero,
        pdfHash: current.data.pdf_hash,
        ya_firmada: true,
      };
    }
    const unused = uploaded.filter(
      (path) => path !== current.data?.firma_path && path !== current.data?.pdf_path,
    );
    if (unused.length) {
      const cleanup = await storage.remove(unused);
      if (cleanup.error)
        console.error(
          "No se pudieron limpiar archivos de una firma fallida:",
          cleanup.error.message,
        );
    }
    throw error;
  }
}
