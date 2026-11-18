import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, withServiceRole, withUser } from "../helpers/pglite";
import {
  asignarRol,
  concederPermiso,
  crearCatalogosBasicos,
  crearUsuario,
} from "../helpers/fixtures";

const ADMIN = "71000000-0000-4000-8000-000000000001";
const AUX = "71000000-0000-4000-8000-000000000002";
const EMP = "71000000-0000-4000-8000-000000000003";
const OTHER = "72000000-0000-4000-8000-000000000001";

describe("Integridad transaccional y fronteras de autorización", () => {
  let db: PGlite;
  let tipo: string;
  let empleado: string;
  let equipo: string;
  const scalarId = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  const crearActa = async () =>
    withUser(db, AUX, () =>
      scalarId("select public.crear_acta($1,'entrega',$2::jsonb) as id", [
        empleado,
        JSON.stringify([{ equipo_id: equipo }]),
      ]),
    );
  const reservar = async (acta: string, token: string | null = null) =>
    withServiceRole(
      db,
      async () =>
        (
          await db.query<{ reserva: { lease_id: string; firmado_at: string; snapshot: object } }>(
            "select public.reservar_firma($1,$2,$3) as reserva",
            [acta, token ? null : EMP, token],
          )
        ).rows[0]!.reserva,
    );
  const confirmar = async (acta: string, lease: string, token = false) =>
    withServiceRole(db, () =>
      db.query(
        "select public.confirmar_firma($1,$2,$3,$4,$5,$6,'portal del empleado','127.0.0.1','test') as firma",
        [
          acta,
          lease,
          token ? null : EMP,
          `${acta}/${lease}/firma.png`,
          `${acta}/${lease}/acta.pdf`,
          "a".repeat(64),
        ],
      ),
    );

  beforeEach(async () => {
    db = await createTestDatabase();
    for (const [id, name] of [
      [ADMIN, "Admin"],
      [AUX, "Aux"],
      [EMP, "Empleado"],
    ]) {
      await crearUsuario(db, id!, `${name}@test.local`, name!);
    }
    await asignarRol(db, ADMIN, "admin");
    await asignarRol(db, AUX, "auxiliar", ADMIN);
    await asignarRol(db, EMP, "empleado");
    for (const permiso of [
      "equipos_editar",
      "empleados_editar",
      "actas_entrega",
      "actas_devolucion",
      "reabastecimiento_gestionar",
    ]) {
      await concederPermiso(db, AUX, permiso);
    }
    tipo = (await crearCatalogosBasicos(db, ADMIN)).tipoId;
    empleado = await scalarId(
      "insert into empleados(nombre,identificacion,user_id,owner_id) values('Empleado','1.234.567',$1,$2) returning id",
      [EMP, ADMIN],
    );
    equipo = await scalarId(
      "insert into equipos(tipo_id,serie,owner_id) values($1,'EQ-1',$2) returning id",
      [tipo, ADMIN],
    );
  });
  afterEach(async () => {
    await db?.close();
  });

  it("protege el vínculo de identidad y los contadores PIN, manteniendo edición de ficha", async () => {
    await withUser(db, AUX, async () => {
      await expect(
        db.query("update empleados set user_id=$1 where id=$2", [AUX, empleado]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("update empleados set pin_intentos=0 where id=$1", [empleado]),
      ).rejects.toThrow(/permission denied/);
      await db.query("update empleados set cargo='Analista' where id=$1", [empleado]);
    });
    await expect(
      db.query("update empleados set user_id=$1 where id=$2", [AUX, empleado]),
    ).rejects.toThrow(/identidad administrativa/);
  });

  it("normaliza cédulas y rechaza otra representación de la misma identidad", async () => {
    expect(
      (
        await db.query<{ identificacion_normalizada: string }>(
          "select identificacion_normalizada from empleados where id=$1",
          [empleado],
        )
      ).rows[0]!.identificacion_normalizada,
    ).toBe("1234567");
    await expect(
      db.query(
        "insert into empleados(nombre,identificacion,owner_id) values('Duplicado','1234567',$1)",
        [ADMIN],
      ),
    ).rejects.toThrow(/empleados_identificacion_canonica_uq/);
  });

  it("revoca lecturas cuando se desactiva el perfil", async () => {
    await db.query("update profiles set activo=false where id=$1", [AUX]);
    await withUser(db, AUX, async () => {
      expect((await db.query("select id from equipos")).rows).toHaveLength(0);
      expect((await db.query("select id from empleados")).rows).toHaveLength(0);
      expect((await db.query("select id from catalogo_items")).rows).toHaveLength(0);
    });
  });

  it("impide RPC y referencias de equipos ajenos, sin dejar actas parciales", async () => {
    const otherType = (await crearCatalogosBasicos(db, OTHER)).tipoId;
    const foreign = await scalarId(
      "insert into equipos(tipo_id,serie,owner_id) values($1,'EXTERNO',$2) returning id",
      [otherType, OTHER],
    );
    await withUser(db, AUX, async () => {
      await expect(
        db.query("select cambiar_estado_equipo($1,'en_reparacion','Intento')", [foreign]),
      ).rejects.toThrow(/no encontrado/);
      await expect(
        db.query("select crear_acta($1,'entrega',$2::jsonb)", [
          empleado,
          JSON.stringify([{ equipo_id: equipo }, { equipo_id: foreign }]),
        ]),
      ).rejects.toThrow(/ajeno/);
      await expect(
        db.query("insert into equipos(tipo_id,serie,owner_id) values($1,'REF-EXTERNA',$2)", [
          otherType,
          ADMIN,
        ]),
      ).rejects.toThrow(/Catálogo incompatible/);
    });
    expect((await db.query("select id from actas")).rows).toHaveLength(0);
    expect((await db.query("select * from app_private.equipo_reservas")).rows).toHaveLength(0);
  });

  it("revalida equipos y empleado al firmar una entrega pendiente", async () => {
    const acta = await crearActa();
    await withUser(db, AUX, () =>
      db.query("select cambiar_estado_equipo($1,'en_reparacion','Falla')", [equipo]),
    );
    await expect(db.query("update actas set estado='firmada' where id=$1", [acta])).rejects.toThrow(
      /ya no está disponible/,
    );
    await withUser(db, AUX, () =>
      db.query("select finalizar_reparacion($1,false,'Listo')", [equipo]),
    );
    await db.query("update empleados set activo=false where id=$1", [empleado]);
    await expect(db.query("update actas set estado='firmada' where id=$1", [acta])).rejects.toThrow(
      /inactivo/,
    );
  });

  it("reserva un equipo para una sola acta y exige dirección en cambios", async () => {
    const acta = await crearActa();
    await expect(crearActa()).rejects.toThrow(/otra acta pendiente/);
    await withUser(db, ADMIN, () => db.query("select anular_acta($1,'Recrear')", [acta]));
    await withUser(db, AUX, async () => {
      await expect(
        db.query("select crear_acta($1,'cambio',$2::jsonb)", [
          empleado,
          JSON.stringify([{ equipo_id: equipo }]),
        ]),
      ).rejects.toThrow(/Indique/);
    });
    await expect(crearActa()).resolves.toMatch(/[a-f0-9-]{36}/);
  });

  it("genera series internas autorizadas y conserva más de cuatro dígitos", async () => {
    await db.query("select setval('public.periferico_seq',9999,true)");
    await withUser(db, AUX, async () => {
      const result = await db.query<{ serie: string }>(
        "insert into equipos(tipo_id,serie,owner_id) values($1,'',$2) returning serie",
        [tipo, ADMIN],
      );
      expect(result.rows[0]!.serie).toBe("FIN-ACC-10000");
    });
  });

  it("crea pedidos atómicos y rechaza recepciones negativas o excesivas", async () => {
    const proveedor = await scalarId(
      "insert into proveedores(nombre,owner_id) values('Proveedor',$1) returning id",
      [ADMIN],
    );
    await withUser(db, AUX, async () => {
      await expect(
        db.query("select crear_pedido($1,$2::jsonb)", [
          proveedor,
          JSON.stringify([
            { tipo_id: tipo, cantidad: 1 },
            { tipo_id: tipo, cantidad: -2 },
          ]),
        ]),
      ).rejects.toThrow();
      expect((await db.query("select id from pedidos_compra")).rows).toHaveLength(0);
      const pedido = await scalarId("select crear_pedido($1,$2::jsonb,null,null,'pedido') as id", [
        proveedor,
        JSON.stringify([{ tipo_id: tipo, cantidad: 1 }]),
      ]);
      const linea = await scalarId("select id from pedido_lineas where pedido_id=$1", [pedido]);
      await expect(
        db.query(
          "select recibir_pedido_linea($1,array['R1','R2','R3'],-2,null,null,'Modelo',10,null,null)",
          [linea],
        ),
      ).rejects.toThrow(/Cantidad sin serial/);
      await expect(
        db.query("update pedido_lineas set recibida=1 where id=$1", [linea]),
      ).rejects.toThrow(/permission denied/);
      await db.query(
        "select recibir_pedido_linea($1,array['R1'],0,null,null,'Modelo',10,null,null)",
        [linea],
      );
      expect(
        (
          await db.query<{ estado: string }>("select estado from pedidos_compra where id=$1", [
            pedido,
          ])
        ).rows[0]!.estado,
      ).toBe("recibido");
    });
  });

  it("confirma firma y token en una transacción idempotente con rutas únicas", async () => {
    const acta = await crearActa();
    const token = "b".repeat(64);
    await db.query(
      "insert into tokens_firma(acta_id,token,expires_at) values($1,$2,now()+interval '15 minutes')",
      [acta, token],
    );
    const reserva = await reservar(acta, token);
    expect(reserva.snapshot).toHaveProperty("equipos");
    expect(
      (
        await db.query<{ used_at: unknown }>("select used_at from tokens_firma where token=$1", [
          token,
        ])
      ).rows[0]!.used_at,
    ).toBeNull();
    await expect(reservar(acta, token)).rejects.toThrow(/Firma en proceso/);
    const result = await confirmar(acta, reserva.lease_id, true);
    expect(result.rows[0]).toMatchObject({ firma: { ok: true, ya_firmada: false } });
    expect((await confirmar(acta, reserva.lease_id, true)).rows[0]).toMatchObject({
      firma: { ok: true, ya_firmada: true },
    });
    expect(
      (
        await db.query<{ used_at: unknown }>("select used_at from tokens_firma where token=$1", [
          token,
        ])
      ).rows[0]!.used_at,
    ).not.toBeNull();
    expect((await db.query("select id from auditoria where accion='FIRMA'")).rows).toHaveLength(1);
  });

  it("rechaza un PDF generado con un snapshot obsoleto y conserva el token", async () => {
    const acta = await crearActa();
    const token = "c".repeat(64);
    await db.query(
      "insert into tokens_firma(acta_id,token,expires_at) values($1,$2,now()+interval '15 minutes')",
      [acta, token],
    );
    const reserva = await reservar(acta, token);
    await withUser(db, AUX, () =>
      db.query("update equipos set modelo='Modelo actualizado' where id=$1", [equipo]),
    );
    await expect(confirmar(acta, reserva.lease_id, true)).rejects.toThrow(/cambiaron/);
    expect(
      (
        await db.query<{ used_at: unknown }>("select used_at from tokens_firma where token=$1", [
          token,
        ])
      ).rows[0]!.used_at,
    ).toBeNull();
    await withServiceRole(db, () =>
      db.query("select cancelar_firma($1,$2)", [acta, reserva.lease_id]),
    );
    await expect(reservar(acta, token)).resolves.toHaveProperty("lease_id");
  });

  it("limita intentos PIN atómicamente y no deja que un éxito viejo limpie fallos nuevos", async () => {
    await withServiceRole(db, async () => {
      const reserves: { permitido: boolean; lease_id: string }[] = [];
      for (let n = 0; n < 6; n++) {
        reserves.push(
          (
            await db.query<{ r: { permitido: boolean; lease_id: string } }>(
              "select reservar_intento_pin($1) r",
              [empleado],
            )
          ).rows[0]!.r,
        );
      }
      expect(reserves.map((r) => r.permitido)).toEqual([true, true, true, true, true, false]);
      await db.query("select finalizar_intento_pin($1,$2,true)", [empleado, reserves[0]!.lease_id]);
      expect(
        (
          await db.query<{ pin_intentos: number }>(
            "select pin_intentos from empleados where id=$1",
            [empleado],
          )
        ).rows[0]!.pin_intentos,
      ).toBe(5);
    });
    await withUser(db, AUX, async () => {
      await expect(db.query("select reservar_intento_pin($1)", [empleado])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("reemplaza permisos y metadata en una sola transacción", async () => {
    await withServiceRole(db, async () => {
      await db.query(
        "select reemplazar_permisos_usuario($1,array['estadisticas_ver','equipos_editar'],$2)",
        [AUX, ADMIN],
      );
      await expect(
        db.query("select reemplazar_permisos_usuario($1,array['no_existe'],$2)", [AUX, ADMIN]),
      ).rejects.toThrow();
      expect(
        (
          await db.query<{ permiso: string }>(
            "select permiso from user_permisos where user_id=$1 order by permiso::text",
            [AUX],
          )
        ).rows.map((r) => r.permiso),
      ).toEqual(["equipos_editar", "estadisticas_ver"]);
    });
    expect(
      (
        await db.query<{ raw_app_meta_data: { permisos_extra: string[] } }>(
          "select raw_app_meta_data from auth.users where id=$1",
          [AUX],
        )
      ).rows[0]!.raw_app_meta_data.permisos_extra,
    ).toEqual(["estadisticas_ver"]);
  });
});
