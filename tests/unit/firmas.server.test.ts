import { PDFDocument, PDFPage } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  actaDTO,
  clientIp,
  ejecutarFirma,
  generarPdf,
  registrarAuditoria,
  resolverIpFirma,
  type ActaCompleta,
  type ActaDTO,
} from "@/lib/firmas.server";
import { crearPng, pngDataUrl } from "../helpers/png";
import { setRequestHeaders } from "../helpers/request";
import { crearSupabaseMock, filtro, type SupabaseMock } from "../helpers/supabase-mock";

type Admin = Parameters<typeof ejecutarFirma>[0];

const ACTA_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function actaBase(over: Record<string, unknown> = {}) {
  return {
    id: ACTA_ID,
    numero: 12,
    tipo: "entrega",
    estado: "pendiente",
    es_prestamo: false,
    prestamo_hasta: null,
    created_at: "2026-10-01T15:00:00.000Z",
    observaciones: "Equipo nuevo",
    tecnico_nombre: "Técnico Uno",
    tecnico_firma_path: null,
    empleado: {
      nombre: "Ana Pérez",
      identificacion: "1234567",
      email: "ana@finesa.com.co",
      cargo: "Analista",
      area: { nombre: "Riesgos" },
      sede: { nombre: "Bogotá" },
      empresa: { nombre: "Finesa S.A." },
    },
    ...over,
  };
}

function itemBase(over: Record<string, unknown> = {}) {
  return {
    estado_fisico: "Bueno",
    accesorios: "Cargador",
    nota: null,
    direccion: "entrega",
    estado_destino: "disponible",
    equipo: {
      id: "eq-1",
      serie: "SN-001",
      activo_fijo: "AF-10",
      modelo: "Latitude 5440",
      tipo: { nombre: "Portátil" },
      marca: { nombre: "Dell" },
    },
    ...over,
  };
}

function completa(
  acta = actaBase(),
  equipos: Record<string, unknown>[] = [itemBase()],
): ActaCompleta {
  return {
    acta,
    equipos: equipos.map((i) => ({ ...(i["equipo"] as object), ...i, equipo: undefined })),
  } as unknown as ActaCompleta;
}

const META = {
  fecha: "2026-10-22T15:00:00.000Z",
  ip: "10.0.0.5",
  medio: "presencial",
  ua: "Vitest",
};

describe("firmas.server", () => {
  describe("clientIp", () => {
    it("prioriza cf-connecting-ip", () => {
      setRequestHeaders({
        "cf-connecting-ip": "1.1.1.1",
        "x-forwarded-for": "2.2.2.2",
        "x-real-ip": "3.3.3.3",
      });
      expect(clientIp()).toBe("1.1.1.1");
    });

    it("usa la primera IP de x-forwarded-for", () => {
      setRequestHeaders({ "x-forwarded-for": " 2.2.2.2 , 10.0.0.1", "x-real-ip": "3.3.3.3" });
      expect(clientIp()).toBe("2.2.2.2");
    });

    it("recurre a x-real-ip y luego a 'desconocida'", () => {
      setRequestHeaders({ "x-real-ip": "3.3.3.3" });
      expect(clientIp()).toBe("3.3.3.3");
      setRequestHeaders({});
      expect(clientIp()).toBe("desconocida");
    });
  });

  describe("resolverIpFirma", () => {
    it("en modo local registra la IP interna sin consultar Internet ni confiar en el formulario", async () => {
      vi.stubEnv("LOCAL_ONLY", "true");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        setRequestHeaders({
          "x-socket-ip": "10.20.1.15",
          "x-real-ip": "9.9.9.9",
          "cf-connecting-ip": "8.8.8.8",
        });
        expect(clientIp()).toBe("10.20.1.15");
        await expect(resolverIpFirma({ ipCliente: "1.1.1.1" })).resolves.toBe("10.20.1.15");
        setRequestHeaders({ "x-socket-ip": "127.0.0.1" });
        await expect(resolverIpFirma()).resolves.toBe("127.0.0.1");
        setRequestHeaders({});
        await expect(resolverIpFirma()).resolves.toBe("desconocida");
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        fetchSpy.mockRestore();
      }
    });
    it("prioriza cabeceras si son IPs públicas", async () => {
      setRequestHeaders({ "cf-connecting-ip": "1.1.1.1" });
      await expect(resolverIpFirma({ ipCliente: "190.90.34.66" })).resolves.toBe("1.1.1.1");
    });

    it("utiliza ipCliente si las cabeceras son vacías o locales", async () => {
      setRequestHeaders({});
      await expect(resolverIpFirma({ ipCliente: "190.90.34.66" })).resolves.toBe("190.90.34.66");

      setRequestHeaders({ "x-forwarded-for": "127.0.0.1" });
      await expect(resolverIpFirma({ ipCliente: "190.90.34.66" })).resolves.toBe("190.90.34.66");
    });

    it("ignora ipCliente si es loopback o 'desconocida'", async () => {
      setRequestHeaders({ "x-real-ip": "4.4.4.4" });
      await expect(resolverIpFirma({ ipCliente: "127.0.0.1" })).resolves.toBe("4.4.4.4");
      await expect(resolverIpFirma({ ipCliente: "desconocida" })).resolves.toBe("4.4.4.4");
    });
  });

  describe("registrarAuditoria", () => {
    it("inserta el actor y el detalle en la tabla auditoria", async () => {
      const sb = crearSupabaseMock();
      await registrarAuditoria(
        sb.client as unknown as Admin,
        "user-1",
        "actas",
        "FIRMA",
        "acta-1",
        "detalle",
      );
      expect(sb.auditorias()).toEqual([
        {
          user_id: "user-1",
          tabla: "actas",
          accion: "FIRMA",
          registro_id: "acta-1",
          detalle: "detalle",
        },
      ]);
    });
  });

  describe("actaDTO", () => {
    it("aplana empleado y equipos con sus catálogos", () => {
      const dto = actaDTO(completa());
      expect(dto).toMatchObject({
        id: ACTA_ID,
        numero: 12,
        tipo: "entrega",
        es_prestamo: false,
        tecnico: "Técnico Uno",
        empleado: {
          nombre: "Ana Pérez",
          identificacion: "1234567",
          cargo: "Analista",
          area: "Riesgos",
          sede: "Bogotá",
          empresa: "Finesa S.A.",
        },
      });
      expect(dto.equipos).toEqual([
        {
          serie: "SN-001",
          activo_fijo: "AF-10",
          modelo: "Latitude 5440",
          tipo: "Portátil",
          marca: "Dell",
          estado_fisico: "Bueno",
          accesorios: "Cargador",
          nota: "",
          direccion: "entrega",
          estado_destino: "disponible",
        },
      ]);
    });

    it("rellena con cadenas vacías cuando faltan datos opcionales", () => {
      const dto = actaDTO(
        completa(actaBase({ empleado: null }), [
          itemBase({
            estado_fisico: null,
            accesorios: null,
            equipo: { serie: "X", activo_fijo: null, modelo: null, tipo: null, marca: null },
          }),
        ]),
      );
      expect(dto.empleado).toEqual({
        nombre: "",
        identificacion: "",
        cargo: "",
        area: "",
        sede: "",
        empresa: "",
      });
      expect(dto.equipos[0]).toMatchObject({
        serie: "X",
        activo_fijo: "",
        modelo: "",
        tipo: "",
        marca: "",
        estado_fisico: "",
        accesorios: "",
      });
    });

    it.each([
      ["devolucion", "devolucion"],
      ["entrega", "entrega"],
      ["cambio", "entrega"],
    ])("si el ítem no trae dirección, la deriva del tipo de acta (%s → %s)", (tipo, esperado) => {
      const dto = actaDTO(completa(actaBase({ tipo }), [itemBase({ direccion: null })]));
      expect(dto.equipos[0]!.direccion).toBe(esperado);
    });

    it("expone los datos del préstamo de contingencia", () => {
      const dto = actaDTO(completa(actaBase({ es_prestamo: true, prestamo_hasta: "2026-11-01" })));
      expect(dto.es_prestamo).toBe(true);
      expect(dto.prestamo_hasta).toBe("2026-11-01");
    });
  });

  describe("generarPdf", () => {
    const firma = crearPng();

    async function pdfDe(dto: ActaDTO, tecnico?: Uint8Array | null) {
      const bytes = await generarPdf(dto, firma, META, tecnico);
      return { bytes, doc: await PDFDocument.load(bytes) };
    }

    it("genera un PDF válido de una página con metadatos del acta", async () => {
      const { bytes, doc } = await pdfDe(actaDTO(completa()));
      expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toBe("Acta entrega #12");
      expect(doc.getAuthor()).toBe("Finesa");
    });

    it("soporta actas de cambio con equipos en ambos sentidos", async () => {
      const dto = actaDTO(
        completa(actaBase({ tipo: "cambio" }), [
          itemBase(),
          itemBase({
            direccion: "devolucion",
            estado_destino: "en_reparacion",
            equipo: {
              serie: "SN-OLD",
              activo_fijo: null,
              modelo: "Viejo",
              tipo: null,
              marca: null,
            },
          }),
        ]),
      );
      const { doc } = await pdfDe(dto);
      expect(doc.getTitle()).toBe("Acta cambio #12");
    });

    it("no falla con caracteres fuera de WinAnsi (emojis, CJK)", async () => {
      const dto = actaDTO(completa(actaBase({ observaciones: "Entregado ✅ 设备 🚀".repeat(20) })));
      await expect(pdfDe(dto)).resolves.toBeTruthy();
    });

    it("rechaza una firma técnica ilegible para no emitir un documento incompleto", async () => {
      await expect(pdfDe(actaDTO(completa()), new Uint8Array([1, 2, 3]))).rejects.toThrow();
    });

    it("incrusta la firma del técnico cuando es válida", async () => {
      const sinTecnico = await generarPdf(actaDTO(completa()), firma, META, null);
      const conTecnico = await generarPdf(actaDTO(completa()), firma, META, crearPng(120, 40, 99));
      expect(conTecnico.length).toBeGreaterThan(sinTecnico.length);
    });

    it("rechaza una firma de empleado que no es PNG", async () => {
      await expect(
        generarPdf(actaDTO(completa()), new Uint8Array([0, 1, 2]), META),
      ).rejects.toThrow();
    });

    it("conserva equipos, notas y nombres extensos dentro de las páginas", async () => {
      const draw = vi.spyOn(PDFPage.prototype, "drawText");
      const dto = actaDTO(completa());
      dto.empleado.nombre = "Nombre extenso ".repeat(400) + "FIN_NOMBRE";
      dto.observaciones = "Observación detallada ".repeat(300) + "FIN_OBSERVACION";
      dto.equipos = Array.from({ length: 45 }, (_, i) => ({
        ...dto.equipos[0]!,
        serie: "SERIE-" + i,
        nota: "Nota amplia ".repeat(30) + "FIN_NOTA-" + i,
      }));
      const { doc } = await pdfDe(dto);
      expect(doc.getPageCount()).toBeGreaterThan(5);
      const text = draw.mock.calls.map((c) => c[0]).join(" ");
      for (const marker of ["FIN_NOMBRE", "FIN_OBSERVACION", "FIN_NOTA-44", "SERIE-44"])
        expect(text).toContain(marker);
      for (const [, options] of draw.mock.calls) {
        expect(options?.y).toBeGreaterThanOrEqual(25);
        expect(options?.y).toBeLessThanOrEqual(812);
      }
    });
  });

  describe("ejecutarFirma", () => {
    let sb: SupabaseMock;
    let acta: Record<string, unknown>;
    let confirmError: { message: string } | null;
    let commitBeforeError: boolean;
    const lease = "bbbbbbbb-0000-4000-8000-000000000001";
    const firmaPath = ACTA_ID + "/" + lease + "/firma.png";
    const pdfPath = ACTA_ID + "/" + lease + "/acta.pdf";
    const firmaUrl = pngDataUrl(crearPng());
    const confirmation = () =>
      sb.rpcs.find((r) => r.name === "confirmar_firma")?.args as Record<string, unknown>;
    beforeEach(() => {
      setRequestHeaders({ "cf-connecting-ip": "190.0.0.7", "user-agent": "Mozilla/5.0 Vitest" });
      acta = actaBase();
      confirmError = null;
      commitBeforeError = false;
      sb = crearSupabaseMock({
        onQuery: (q) => (q.table === "actas" && q.op === "select" ? { data: acta } : undefined),
        onRpc: (name, args) => {
          if (name === "reservar_firma") {
            if (acta.estado === "firmada")
              return { data: { ya_firmada: true, numero: 12, pdfHash: acta.pdf_hash } };
            if (acta.estado !== "pendiente")
              return { error: { message: "El acta no está pendiente de firma" } };
            return {
              data: {
                lease_id: lease,
                firmado_at: META.fecha,
                snapshot: completa(acta as ReturnType<typeof actaBase>),
              },
            };
          }
          if (name === "confirmar_firma") {
            const a = args as Record<string, unknown>;
            if (!confirmError || commitBeforeError)
              acta = {
                ...acta,
                estado: "firmada",
                firma_path: a.p_firma_path,
                pdf_path: a.p_pdf_path,
                pdf_hash: a.p_pdf_hash,
              };
            return confirmError
              ? { error: confirmError }
              : { data: { ok: true, numero: 12, pdfHash: a.p_pdf_hash } };
          }
          return { data: null };
        },
      });
    });
    const firmar = (over: Partial<Parameters<typeof ejecutarFirma>[1]> = {}) =>
      ejecutarFirma(sb.client as unknown as Admin, {
        actaId: ACTA_ID,
        firmaDataUrl: firmaUrl,
        medio: "presencial",
        actorId: "tecnico-1",
        ...over,
      });

    it("guarda archivos únicos sin sobrescribir y confirma hash, actor y rutas atómicamente", async () => {
      const result = await firmar();
      expect(result).toMatchObject({
        ok: true,
        numero: 12,
        pdfHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(sb.storageUpload.mock.calls.map((c) => [c[0], c[2]])).toEqual([
        [firmaPath, { contentType: "image/png", upsert: false }],
        [pdfPath, { contentType: "application/pdf", upsert: false }],
      ]);
      await expect(
        PDFDocument.load(sb.storageUpload.mock.calls[1]![1] as Uint8Array),
      ).resolves.toBeTruthy();
      expect(confirmation()).toMatchObject({
        p_acta: ACTA_ID,
        p_lease: lease,
        p_actor: "tecnico-1",
        p_pdf_hash: result.pdfHash,
        p_firma_path: firmaPath,
        p_pdf_path: pdfPath,
        p_ip: "190.0.0.7",
      });
      expect(sb.find("actas", "update")).toHaveLength(0);
      expect(sb.storageRemove).not.toHaveBeenCalled();
    });
    it("reserva firma remota con el token y confirma actor nulo", async () => {
      await firmar({ actorId: null, medio: "remoto", tokenFirma: "a".repeat(64) });
      expect(sb.rpcs[0]).toMatchObject({
        name: "reservar_firma",
        args: { p_actor: null, p_token: "a".repeat(64) },
      });
      expect(confirmation()).toMatchObject({ p_actor: null, p_medio: "remoto" });
    });
    it("conserva la IP reportada fuera del modo local", async () => {
      setRequestHeaders({});
      await firmar({ ipCliente: "190.90.34.66" });
      expect(confirmation().p_ip).toBe("190.90.34.66");
    });
    it("un reintento confirmado no vuelve a subir documentos", async () => {
      acta = { ...acta, estado: "firmada", pdf_hash: "a".repeat(64) };
      await expect(firmar()).resolves.toMatchObject({ ok: true, ya_firmada: true });
      expect(sb.storageUpload).not.toHaveBeenCalled();
    });
    it("rechaza actas anuladas y reservas sin autorización", async () => {
      acta.estado = "anulada";
      await expect(firmar()).rejects.toThrow("pendiente");
      expect(sb.storageUpload).not.toHaveBeenCalled();
    });
    it("no sube nada si el acta no existe", async () => {
      sb.setOnRpc(() => ({ error: { message: "Acta no encontrada" } }));
      await expect(firmar()).rejects.toThrow("Acta no encontrada");
      expect(sb.storageUpload).not.toHaveBeenCalled();
    });
    it("valida el PNG antes de reservar", async () => {
      await expect(firmar({ firmaDataUrl: "data:image/png;base64,AAAA" })).rejects.toThrow(/firma/);
      expect(sb.rpcs).toHaveLength(0);
    });
    it("descarga la firma técnica del snapshot", async () => {
      acta.tecnico_firma_path = "tecnicos/t1.png";
      sb.storageDownload.mockResolvedValueOnce({
        data: new Blob([crearPng(100, 40, 5) as BlobPart]),
        error: null,
      });
      await firmar();
      expect(sb.storageDownload).toHaveBeenCalledWith("tecnicos/t1.png");
    });
    it("no confirma una firma cuya imagen no se pudo guardar", async () => {
      sb.storageUpload.mockResolvedValueOnce({
        data: { path: "" },
        error: { message: "duplicate" },
      });
      await expect(firmar()).rejects.toThrow("No se pudo guardar la firma: duplicate");
      expect(confirmation()).toBeUndefined();
      expect(sb.rpcs.at(-1)?.name).toBe("cancelar_firma");
    });
    it("limpia la imagen huérfana si falla el PDF después de cancelar la reserva", async () => {
      sb.storageUpload
        .mockResolvedValueOnce({ data: { path: firmaPath }, error: null })
        .mockResolvedValueOnce({ data: { path: "" }, error: { message: "quota" } });
      sb.storageRemove.mockImplementationOnce(async () => {
        expect(sb.rpcs.at(-1)?.name).toBe("cancelar_firma");
        return { data: [], error: null };
      });
      await expect(firmar()).rejects.toThrow("No se pudo guardar el PDF: quota");
      expect(sb.storageRemove).toHaveBeenCalledWith([firmaPath]);
      expect(confirmation()).toBeUndefined();
    });
    it("propaga rechazos de confirmación y retira archivos no referenciados", async () => {
      confirmError = { message: "El empleado está inactivo" };
      await expect(firmar()).rejects.toThrow("inactivo");
      expect(sb.storageRemove).toHaveBeenCalledWith([firmaPath, pdfPath]);
    });
    it("recupera un commit cuya respuesta se perdió sin borrar sus archivos", async () => {
      confirmError = { message: "network failure" };
      commitBeforeError = true;
      await expect(firmar()).resolves.toMatchObject({ ok: true, ya_firmada: true });
      expect(sb.storageRemove).not.toHaveBeenCalled();
    });
    it("no borra archivos si no puede descartar una confirmación en curso", async () => {
      confirmError = { message: "network failure" };
      const original = sb.client.rpc.getMockImplementation()!;
      sb.client.rpc.mockImplementation(async (name, args) =>
        name === "cancelar_firma"
          ? { data: null, error: { message: "offline" } }
          : original(name, args),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(firmar()).rejects.toThrow("network failure");
      expect(sb.storageRemove).not.toHaveBeenCalled();
    });
    it("no omite el hash cuando la base de datos rechaza el contrato", async () => {
      confirmError = { message: "Could not find the pdf_hash column" };
      await expect(firmar()).rejects.toThrow("pdf_hash");
      expect(sb.rpcs.filter((r) => r.name === "confirmar_firma")).toHaveLength(1);
      expect(confirmation().p_pdf_hash).toMatch(/^[a-f0-9]{64}$/);
    });
    it("limita el user-agent registrado a 400 caracteres", async () => {
      setRequestHeaders({ "user-agent": "x".repeat(1000) });
      await firmar();
      expect(confirmation().p_user_agent).toHaveLength(400);
    });
  });
});
