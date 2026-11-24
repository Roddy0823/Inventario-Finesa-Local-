import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, withUser } from "../helpers/pglite";
import { asignarRol, crearCatalogosBasicos, crearUsuario } from "../helpers/fixtures";

const ADMIN = "81000000-0000-4000-8000-000000000001";
const AUX = "81000000-0000-4000-8000-000000000002";
const EMP = "81000000-0000-4000-8000-000000000003";
const OTHER = "82000000-0000-4000-8000-000000000001";
const OTHER_AUX = "82000000-0000-4000-8000-000000000002";

describe("Lecturas RLS sin recalcular la identidad por fila", () => {
  let db: PGlite;
  let empleado: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    for (const [id, name] of [
      [ADMIN, "Admin"],
      [AUX, "Aux"],
      [EMP, "Empleado"],
      [OTHER_AUX, "Aux externo"],
    ]) {
      await crearUsuario(db, id!, `${id}@test.local`, name!);
    }
    await asignarRol(db, ADMIN, "admin");
    await asignarRol(db, AUX, "auxiliar", ADMIN);
    await asignarRol(db, OTHER_AUX, "auxiliar", OTHER);
    await asignarRol(db, EMP, "empleado");
    const cat = await crearCatalogosBasicos(db, ADMIN);
    const otherCat = await crearCatalogosBasicos(db, OTHER);
    empleado = (
      await db.query<{ id: string }>(
        "insert into empleados(nombre,identificacion,user_id,owner_id) values('Empleado','81001',$1,$2) returning id",
        [EMP, ADMIN],
      )
    ).rows[0]!.id;
    await db.query(
      "insert into equipos(tipo_id,serie,owner_id) select $1,'RLS-' || n,$2 from generate_series(1,100) n",
      [cat.tipoId, ADMIN],
    );
    await db.query("insert into equipos(tipo_id,serie,owner_id) values($1,'EXTERNO',$2)", [
      otherCat.tipoId,
      OTHER,
    ]);
  });

  afterEach(async () => {
    await db?.close();
  });

  const total = async (db: PGlite) =>
    Number(
      (
        await db.query<{ total: string }>(
          "select coalesce(sum(total),0)::text as total from panel_conteos()",
        )
      ).rows[0]!.total,
    );

  it("reutiliza el plan sin reutilizar la identidad de una solicitud anterior", async () => {
    await db.exec("prepare conteo_rls as select count(*)::int as total from equipos");
    for (const [user, expected] of [
      [ADMIN, 100],
      [OTHER_AUX, 1],
      [EMP, 0],
      [AUX, 100],
      [OTHER_AUX, 1],
    ] as const) {
      await withUser(db, user, async () => {
        expect((await db.query<{ total: number }>("execute conteo_rls")).rows[0]!.total).toBe(
          expected,
        );
      });
    }
  });

  it("los totales y estadísticas mantienen el aislamiento por ecosistema", async () => {
    for (const [user, expected] of [
      [ADMIN, 100],
      [OTHER_AUX, 1],
      [EMP, 0],
    ] as const) {
      await withUser(db, user, async () => {
        expect(await total(db)).toBe(expected);
        const stats = await db.query<{ stats: { total: number } }>(
          "select estadisticas_inventario() as stats",
        );
        expect(stats.rows[0]!.stats.total).toBe(expected);
      });
    }
  });

  it("revalida la suspensión del perfil en la consulta siguiente", async () => {
    expect(await withUser(db, AUX, () => total(db))).toBe(100);
    await db.query("update profiles set activo=false where id=$1", [AUX]);
    await withUser(db, AUX, async () => {
      expect(await total(db)).toBe(0);
      for (const table of ["equipos", "empleados", "catalogo_items"]) {
        expect((await db.query(`select id from ${table}`)).rows).toHaveLength(0);
      }
    });
  });

  it("revoca la ficha y sus catálogos al desactivar un empleado", async () => {
    await withUser(db, EMP, async () => {
      expect((await db.query("select id from empleados")).rows).toHaveLength(1);
      expect((await db.query("select id from catalogo_items")).rows).toHaveLength(3);
    });
    await db.query("update empleados set activo=false where id=$1", [empleado]);
    await withUser(db, EMP, async () => {
      expect((await db.query("select id from empleados")).rows).toHaveLength(0);
      expect((await db.query("select id from catalogo_items")).rows).toHaveLength(0);
    });
  });

  it("evalúa los helpers de autorización una vez por consulta aunque haya cien filas", async () => {
    await withUser(db, ADMIN, async () => {
      const result = await db.query<{ "QUERY PLAN": Array<{ Plan: Plan }> }>(
        "explain (analyze, verbose, format json) select id from equipos",
      );
      type Plan = {
        "Parent Relationship"?: string;
        "Actual Loops"?: number;
        Output?: string[];
        Plans?: Plan[];
      };
      const nodes: Plan[] = [];
      const visit = (plan: Plan) => {
        nodes.push(plan);
        plan.Plans?.forEach(visit);
      };
      visit(result.rows[0]!["QUERY PLAN"][0]!.Plan);
      const helpers = nodes.filter(
        (plan) =>
          plan["Parent Relationship"] === "InitPlan" &&
          plan.Output?.some((output) => /usuario_habilitado|my_owner_id/.test(output)),
      );
      expect(helpers.length).toBeGreaterThanOrEqual(2);
      expect(helpers.every((plan) => plan["Actual Loops"] === 1)).toBe(true);
    });
  });
});
