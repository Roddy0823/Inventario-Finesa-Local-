import { afterEach, describe, expect, it } from "vitest";
import { fetchAll, fetchByIds } from "@/lib/fetchAll";
import { hoyColombia, inicioDiaColombia, finExclusivoColombia } from "@/lib/fechas";
import { normalizarPaginacion } from "@/lib/paginacion";
import { cargaMasivaStore } from "@/lib/cargaMasivaStore";
import { validar, type Contexto, type Lectura } from "@/lib/cargaMasiva";

describe("fechas civiles colombianas", () => {
  it("mantiene el día colombiano durante las cinco primeras horas UTC", () => {
    expect(hoyColombia(new Date("2026-11-12T04:59:59Z"))).toBe("2026-11-11");
    expect(hoyColombia(new Date("2026-11-12T05:00:00Z"))).toBe("2026-11-12");
  });
  it("incluye el último milisegundo y excluye el siguiente día en un rango", () => {
    const inicio = inicioDiaColombia("2024-02-29");
    const fin = finExclusivoColombia("2024-02-29");
    expect(inicio).toBe("2024-02-29T05:00:00.000Z");
    expect(fin).toBe("2024-03-01T05:00:00.000Z");
    const dentro = (v: string) => v >= inicio && v < fin;
    expect(dentro("2024-03-01T04:59:59.999Z")).toBe(true);
    expect(dentro(fin)).toBe(false);
    expect(() => inicioDiaColombia("2023-02-29")).toThrow("Fecha inválida");
  });
});

describe("paginación y consultas completas", () => {
  it("la URL determina exactamente el rango de la segunda página", () => {
    expect(normalizarPaginacion("2", "50")).toEqual({
      pagina: 2,
      tamano: 50,
      desde: 50,
      hasta: 99,
    });
    expect(normalizarPaginacion(-2, 5000)).toEqual({ pagina: 1, tamano: 25, desde: 0, hasta: 24 });
    expect(normalizarPaginacion(Infinity, "oops").pagina).toBe(1);
  });
  it("exporta 2501 filas y falla si alguna página no pudo leerse", async () => {
    const data = Array.from({ length: 2501 }, (_, id) => ({ id }));
    const rows = await fetchAll((a, b) =>
      Promise.resolve({ data: data.slice(a, b + 1), error: null }),
    );
    expect(rows).toEqual(data);
    await expect(
      fetchAll((a, b) =>
        Promise.resolve({
          data: a === 0 ? data.slice(a, b + 1) : null,
          error: a ? new Error("sin conexión") : null,
        }),
      ),
    ).rejects.toThrow("sin conexión");
  });
  it("consulta todos los IDs únicos y pagina historiales grandes por fragmento", async () => {
    const ids = Array.from({ length: 230 }, (_, i) => String(i));
    const all = ids.flatMap((id) => Array.from({ length: 12 }, (_, n) => `${id}:${n}`));
    const seen: string[][] = [];
    const rows = await fetchByIds([...ids, "0"], (group, a, b) => {
      seen.push(group);
      return Promise.resolve({
        data: all.filter((v) => group.includes(v.split(":")[0]!)).slice(a, b + 1),
        error: null,
      });
    });
    expect(rows).toEqual(all);
    expect(Math.max(...seen.map((v) => v.length))).toBe(100);
    expect(new Set(rows).size).toBe(2760);
  });
});

describe("aislamiento de importaciones", () => {
  afterEach(() => cargaMasivaStore.setIdentity(null));
  it("borra contexto y cancela trabajo tardío al cambiar de identidad", async () => {
    cargaMasivaStore.setIdentity("usuario-a");
    const op = cargaMasivaStore.iniciarOperacion();
    cargaMasivaStore.setFase("procesando");
    const late = Promise.resolve().then(() => {
      op.comprobar();
      cargaMasivaStore.setFase("resultado");
    });
    cargaMasivaStore.setIdentity("usuario-b");
    await expect(late).rejects.toMatchObject({ name: "AbortError" });
    expect(op.signal.aborted).toBe(true);
    expect(cargaMasivaStore.getState().fase).toBe("idle");
    expect(cargaMasivaStore.getState().ctx).toBeNull();
  });
  it("renovar la misma identidad conserva trabajo pero una nueva operación invalida la anterior", () => {
    cargaMasivaStore.setIdentity("usuario-a");
    const first = cargaMasivaStore.iniciarOperacion();
    cargaMasivaStore.setFase("revision");
    cargaMasivaStore.setIdentity("usuario-a");
    expect(first.vigente()).toBe(true);
    expect(cargaMasivaStore.getState().fase).toBe("revision");
    const second = cargaMasivaStore.iniciarOperacion();
    expect(first.vigente()).toBe(false);
    expect(second.vigente()).toBe(true);
  });
});

describe("asignaciones de importación por identidad canónica", () => {
  const ctx: Contexto = {
    catalogos: [],
    proveedores: [],
    esAdmin: true,
    puedeEmpleados: true,
    puedeEquipos: true,
    empleados: [{ id: "emp-1", identificacion: "123", activo: true, sede_id: null }],
    equipos: [
      {
        id: "eq-1",
        serie: "SERIE-1",
        activo_fijo: "ACTIVO-1",
        estado: "disponible",
        empleado_id: null,
      },
    ],
  };
  function lectura(codigos: string[]): Lectura {
    return {
      archivo: "asignaciones.xlsx",
      hojasIgnoradas: [],
      hojas: {
        asignaciones: {
          hoja: "asignaciones",
          nombreHoja: "Asignaciones",
          columnasFaltantes: [],
          ignoradas: 0,
          filas: codigos.map((codigo, index) => ({
            n: index + 2,
            get: (campo) =>
              campo === "cedula" ? "123" : campo === "identificador" ? codigo : null,
          })),
        },
      },
    };
  }
  it("detecta el mismo equipo referido por serie y activo fijo", () => {
    const result = validar(lectura(["SERIE-1", "ACTIVO-1"]), ctx).filas.asignaciones;
    expect(result[0]!.estado).toBe("nuevo");
    expect(result[1]!.estado).toBe("error");
    expect(result[1]!.errores.join(" ")).toContain("Equipo repetido");
  });
  it("rechaza un código que identifica dos equipos distintos", () => {
    const result = validar(lectura(["ACTIVO-1"]), {
      ...ctx,
      equipos: [
        ...ctx.equipos,
        {
          id: "eq-2",
          serie: "ACTIVO-1",
          activo_fijo: null,
          estado: "disponible",
          empleado_id: null,
        },
      ],
    });
    expect(result.filas.asignaciones[0]!.errores.join(" ")).toContain("Identificador ambiguo");
  });
});
