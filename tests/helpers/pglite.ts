import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const PREAMBLE = `
-- Configuración básica de emulación de Supabase en Postgres
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'role', coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
  );
$$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
`;

/**
 * Inicializa una base de datos Postgres en memoria con el esquema consolidado
 * completo de Supabase y las migraciones del proyecto.
 */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(PREAMBLE);

  const migrations = path.join(root, "supabase/migrations");
  for (const file of fs
    .readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = fs.readFileSync(path.join(migrations, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      const position = Number((error as { position?: string }).position);
      const line = Number.isFinite(position)
        ? sql.slice(0, position - 1).split("\n").length
        : "desconocida";
      await db.close();
      throw new Error(
        `Migración ${file}, línea ${line}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  // FORCE también cubre al propietario ordinario; service_role conserva BYPASSRLS,
  // como en Supabase. Las pruebas de usuario siempre cambian a authenticated.
  await db.exec(`
    alter table public.profiles force row level security;
    alter table public.user_roles force row level security;
    alter table public.user_permisos force row level security;
    alter table public.catalogo_items force row level security;
    alter table public.empleados force row level security;
    alter table public.equipos force row level security;
    alter table public.equipo_historial force row level security;
    alter table public.actas force row level security;
    alter table public.acta_items force row level security;
    alter table public.tokens_firma force row level security;
    alter table public.proveedores force row level security;
    alter table public.pedidos_compra force row level security;
    alter table public.pedido_lineas force row level security;
    alter table public.reportes_falla force row level security;
    alter table public.auditoria force row level security;
  `);

  return db;
}

/**
 * Contexto de ejecución bajo la identidad de un usuario específico de Supabase
 * (con RLS activo bajo el rol `authenticated`).
 */
export async function withUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`
    set role authenticated;
    set request.jwt.claim.sub = '${userId}';
    set request.jwt.claim.role = 'authenticated';
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`
      reset role;
      set request.jwt.claim.sub = '';
      set request.jwt.claim.role = '';
    `);
  }
}

/**
 * Contexto de ejecución con privilegios de superusuario / service_role.
 */
export async function withServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`
    set role service_role;
    set request.jwt.claim.sub = '';
    set request.jwt.claim.role = 'service_role';
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`
      reset role;
      set request.jwt.claim.sub = '';
      set request.jwt.claim.role = '';
    `);
  }
}
