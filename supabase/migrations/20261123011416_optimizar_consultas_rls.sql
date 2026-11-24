-- Evalúa la identidad y autorización estable una vez por sentencia, no por fila.
-- Las subconsultas no están correlacionadas: Postgres las ejecuta como InitPlan.
-- No se comparten resultados entre consultas/usuarios ni se omiten las RLS.
-- Se conservan roles, tipos permisivo/restrictivo y condiciones de acceso existentes.

do $$ declare t text; begin
  foreach t in array array['catalogo_items','empleados','proveedores','alertas_stock_config','articulo_proveedores',
    'equipos','equipo_historial','reparaciones','actas','acta_items','tokens_firma','solicitudes_reabastecimiento',
    'pedidos_compra','pedido_lineas','reportes_falla','certificaciones','certificacion_respuestas','auditoria'] loop
    execute format('alter policy "Usuario habilitado" on public.%I using ((select public.usuario_habilitado(auth.uid()))) with check ((select public.usuario_habilitado(auth.uid())))',t);
  end loop;
end $$;

alter policy "Ver perfil propio o personal" on public.profiles
  using (
    id = (select auth.uid())
    or ((select public.is_staff(auth.uid())) and (
      id = (select public.my_owner_id())
      or id in (select ur.user_id from public.user_roles ur where ur.owner_id = (select public.my_owner_id()))
      or id in (select e.user_id from public.empleados e where e.owner_id = (select public.my_owner_id()) and e.user_id is not null)
    ))
  );

alter policy "Ver roles propios o admin" on public.user_roles
  using (user_id = (select auth.uid()) or owner_id = (select auth.uid()));

alter policy "Ver permisos propios o admin" on public.user_permisos
  using (
    user_id = (select auth.uid()) or exists (
      select 1 from public.user_roles ur
      where ur.user_id = user_permisos.user_id and ur.role = 'auxiliar' and ur.owner_id = (select auth.uid())
    )
  );

alter policy "Catalogos visibles" on public.catalogo_items
  using (owner_id = (select public.my_owner_id()) or owner_id = (select e.owner_id from public.empleados e where e.user_id = (select auth.uid())));

alter policy "Ver empleados" on public.empleados
  using (owner_id = (select public.my_owner_id()) or user_id = (select auth.uid()));

alter policy "Personal ve proveedores" on public.proveedores
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Personal gestiona proveedores" on public.proveedores
  using ((select public.has_permiso(auth.uid(), 'proveedores_editar')) and owner_id = (select public.my_owner_id()))
  with check ((select public.has_permiso(auth.uid(), 'proveedores_editar')) and owner_id = (select public.my_owner_id()));

alter policy "Personal ve alertas_stock_config" on public.alertas_stock_config
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Personal gestiona alertas_stock_config" on public.alertas_stock_config
  using ((select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar')) and owner_id = (select public.my_owner_id()))
  with check ((select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar')) and owner_id = (select public.my_owner_id()));

alter policy "Personal ve articulo_proveedores" on public.articulo_proveedores
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Personal gestiona articulo_proveedores" on public.articulo_proveedores
  using (((select public.has_permiso(auth.uid(), 'proveedores_editar')) or (select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar'))) and owner_id = (select public.my_owner_id()))
  with check (((select public.has_permiso(auth.uid(), 'proveedores_editar')) or (select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar'))) and owner_id = (select public.my_owner_id()));

alter policy "Ver equipos" on public.equipos
  using (owner_id = (select public.my_owner_id()) or (empleado_id is not null and empleado_id = (select public.my_empleado_id())));

alter policy "Personal ve historial" on public.equipo_historial
  using (exists (select 1 from public.equipos e where e.id = equipo_id and e.owner_id = (select public.my_owner_id())));

alter policy "Personal ve reparaciones" on public.reparaciones
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Ver actas" on public.actas
  using (owner_id = (select public.my_owner_id()) or empleado_id = (select public.my_empleado_id()));

alter policy "Ver items de actas visibles" on public.acta_items
  using (exists (select 1 from public.actas a where a.id = acta_items.acta_id and (a.owner_id = (select public.my_owner_id()) or a.empleado_id = (select public.my_empleado_id()))));

alter policy "Personal ve solicitudes" on public.solicitudes_reabastecimiento
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Personal ve pedidos" on public.pedidos_compra
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Personal gestiona pedidos" on public.pedidos_compra
  using ((select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar')) and owner_id = (select public.my_owner_id()))
  with check ((select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar')) and owner_id = (select public.my_owner_id()));

alter policy "Personal ve lineas" on public.pedido_lineas
  using ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()));

alter policy "Personal gestiona lineas" on public.pedido_lineas
  using ((select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar')) and owner_id = (select public.my_owner_id()))
  with check ((select public.has_permiso(auth.uid(), 'reabastecimiento_gestionar')) and owner_id = (select public.my_owner_id()));

alter policy "Ver reportes de falla" on public.reportes_falla
  using (((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id())) or empleado_id = (select public.my_empleado_id()));

alter policy "Ver certificaciones" on public.certificaciones
  using (
    ((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id()))
    or (activa and owner_id = (select owner_id from public.empleados where id = (select public.my_empleado_id())))
  );

alter policy "Ver respuestas" on public.certificacion_respuestas
  using (((select public.is_staff(auth.uid())) and owner_id = (select public.my_owner_id())) or empleado_id = (select public.my_empleado_id()));

alter policy "Admin ve auditoria" on public.auditoria
  using (
    (select public.has_role(auth.uid(), 'admin')) and (
      user_id = (select auth.uid())
      or user_id in (select ur.user_id from public.user_roles ur where ur.role = 'auxiliar' and ur.owner_id = (select auth.uid()))
    )
  );

-- Los filtros explícitos de las RPC usan la misma evaluación por sentencia.
-- Se mantiene SECURITY INVOKER: las filas siguen pasando por RLS.
create or replace function public.panel_conteos()
returns table(estado public.equipo_estado, total bigint)
language sql stable security invoker set search_path = public as $$
  select e.estado, count(*) from public.equipos e where e.owner_id = (select public.my_owner_id()) group by e.estado
$$;

create or replace function public.stock_bajo()
returns table(tipo_id uuid, tipo text, disponibles bigint, stock_minimo integer)
language sql stable security invoker set search_path = public as $$
  select a.tipo_id, c.nombre,
    (select count(*) from equipos e where e.tipo_id = a.tipo_id and e.estado = 'disponible' and e.owner_id = a.owner_id),
    a.stock_minimo
  from alertas_stock_config a join catalogo_items c on c.id = a.tipo_id
  where a.activa and a.owner_id = (select public.my_owner_id())
    and (select count(*) from equipos e where e.tipo_id = a.tipo_id and e.estado = 'disponible' and e.owner_id = a.owner_id) <= a.stock_minimo
  order by 3, 2;
$$;

create or replace function public.resumen_proveedores()
returns table(proveedor_id uuid, nombre text, equipos bigint, en_garantia bigint, valor numeric, reparaciones bigint, en_reparacion bigint, dias_promedio numeric)
language sql stable set search_path = public as $$
  select p.id, p.nombre,
    (select count(*) from equipos e where e.proveedor_id = p.id and e.estado <> 'de_baja'),
    (select count(*) from equipos e where e.proveedor_id = p.id and e.estado <> 'de_baja' and e.garantia_fin >= current_date),
    (select coalesce(sum(e.valor_compra), 0) from equipos e where e.proveedor_id = p.id and e.estado <> 'de_baja'),
    (select count(*) from reparaciones r where r.proveedor_id = p.id and r.fin is not null),
    (select count(*) from reparaciones r where r.proveedor_id = p.id and r.fin is null),
    (select round(avg(extract(epoch from r.fin - r.inicio) / 86400)::numeric, 1) from reparaciones r where r.proveedor_id = p.id and r.fin is not null)
  from proveedores p where p.owner_id = (select public.my_owner_id()) order by p.nombre
$$;

create or replace function public.estadisticas_inventario(p_sede uuid default null, p_tipo uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
with e as (
  select eq.*, coalesce(eq.valor_compra, 0) v from equipos eq
  where eq.owner_id = (select public.my_owner_id())
    and (p_sede is null or eq.sede_id = p_sede) and (p_tipo is null or eq.tipo_id = p_tipo)
)
select jsonb_build_object(
  'total', (select count(*) from e),
  'valor_total', (select coalesce(sum(v), 0) from e where estado <> 'de_baja'),
  'valor_por_estado', (select coalesce(jsonb_object_agg(estado, val), '{}') from (select estado, sum(v) val from e group by estado) s),
  'por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}') from (select estado, count(*) n from e group by estado) s),
  'sin_valor', (select count(*) from e where valor_compra is null),
  'por_tipo', (select coalesce(jsonb_agg(t order by t.cantidad desc), '[]') from (
      select coalesce(c.nombre, '—') nombre, count(*) cantidad,
        count(*) filter (where estado = 'disponible') disponibles,
        count(*) filter (where estado = 'asignado') asignados,
        count(*) filter (where estado = 'en_reparacion') en_reparacion,
        count(*) filter (where estado = 'de_baja') de_baja,
        sum(v) valor, round(avg(valor_compra), 0) promedio
      from e left join catalogo_items c on c.id = e.tipo_id group by c.nombre) t),
  'por_marca', (select coalesce(jsonb_agg(t order by t.cantidad desc), '[]') from (
      select coalesce(c.nombre, 'Sin marca') nombre, count(*) cantidad, sum(v) valor from e left join catalogo_items c on c.id = e.marca_id group by c.nombre order by 2 desc limit 15) t),
  'por_sede', (select coalesce(jsonb_agg(t order by t.cantidad desc), '[]') from (
      select coalesce(c.nombre, 'Sin sede') nombre, count(*) cantidad, sum(v) valor from e left join catalogo_items c on c.id = e.sede_id group by c.nombre) t),
  'ingresos_mes', (select coalesce(jsonb_agg(t order by t.mes), '[]') from (
      select to_char(date_trunc('month', fecha_ingreso), 'YYYY-MM') mes, count(*) cantidad, sum(v) valor from e
      where fecha_ingreso >= date_trunc('month', current_date) - interval '11 months' group by 1) t),
  'por_anio', (select coalesce(jsonb_agg(t order by t.anio), '[]') from (
      select anio_compra anio, count(*) cantidad from e where anio_compra is not null group by 1) t),
  'garantia_vencida', (select count(*) from e where garantia_fin < current_date and estado <> 'de_baja'),
  'garantia_por_vencer', (select count(*) from e where garantia_fin between current_date and current_date + 90 and estado <> 'de_baja'),
  'top_proveedores', (select coalesce(jsonb_agg(t order by t.valor desc), '[]') from (
      select coalesce(p.nombre, nullif(e.proveedor, ''), 'Sin proveedor') nombre, count(*) cantidad, sum(v) valor
      from e left join proveedores p on p.id = e.proveedor_id group by 1 order by 3 desc limit 10) t),
  'actas_mes', (select coalesce(jsonb_agg(t order by t.mes), '[]') from (
      select to_char(date_trunc('month', firmado_at), 'YYYY-MM') mes,
        count(*) filter (where tipo = 'entrega') entregas, count(*) filter (where tipo = 'devolucion') devoluciones
      from actas where owner_id = (select public.my_owner_id()) and estado = 'firmada'
        and firmado_at >= date_trunc('month', current_date) - interval '11 months' group by 1) t),
  'actas_firmadas_mes', (select count(*) from actas where owner_id = (select public.my_owner_id()) and estado = 'firmada' and firmado_at >= date_trunc('month', current_date)),
  'actas_pendientes', (select count(*) from actas where owner_id = (select public.my_owner_id()) and estado = 'pendiente')
)
$$;

create or replace function public.estadisticas_avanzadas(p_sede uuid default null, p_tipo uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
with e as (
  select eq.* from equipos eq where eq.owner_id = (select public.my_owner_id())
    and (p_sede is null or eq.sede_id = p_sede) and (p_tipo is null or eq.tipo_id = p_tipo)
), r as (
  select rp.* from reparaciones rp join e on e.id = rp.equipo_id
), a as (
  select * from actas where owner_id = (select public.my_owner_id()) and estado <> 'anulada'
)
select jsonb_build_object(
  'fallas_30', (select count(distinct id) from (
      select equipo_id id from r where inicio >= now() - interval '30 days'
      union select id from e where estado = 'de_baja' and updated_at >= now() - interval '30 days') x),
  'fallas_30_prev', (select count(distinct id) from (
      select equipo_id id from r where inicio >= now() - interval '60 days' and inicio < now() - interval '30 days') x),
  'asignados_prev', (select count(*) from e where estado = 'asignado' and created_at < date_trunc('month', current_date)),
  'firmadas', (select count(*) from a where estado = 'firmada'),
  'pendientes', (select count(*) from a where estado = 'pendiente'),
  'firmadas_mes_prev', (select count(*) from a where estado = 'firmada' and firmado_at >= date_trunc('month', current_date) - interval '1 month' and firmado_at < date_trunc('month', current_date)),
  'horas_firma', (select round(avg(extract(epoch from firmado_at - created_at) / 3600)::numeric, 1) from a where estado = 'firmada' and firmado_at is not null),
  'por_tipo_estado', (select coalesce(jsonb_agg(t order by t.total desc), '[]') from (
      select coalesce(c.nombre, '—') nombre, count(*) total,
        count(*) filter (where estado = 'disponible') disponible, count(*) filter (where estado = 'asignado') asignado,
        count(*) filter (where estado = 'en_reparacion') en_reparacion, count(*) filter (where estado = 'de_baja') de_baja
      from e left join catalogo_items c on c.id = e.tipo_id group by c.nombre order by 2 desc limit 12) t),
  'fallas_marca', (select coalesce(jsonb_agg(t order by t.total desc), '[]') from (
      select coalesce(c.nombre, 'Sin marca') nombre,
        (select count(*) from r join e e2 on e2.id = r.equipo_id where e2.marca_id is not distinct from c.id) reparaciones,
        count(*) filter (where e.estado = 'de_baja') bajas,
        count(*) equipos,
        (select count(*) from r join e e2 on e2.id = r.equipo_id where e2.marca_id is not distinct from c.id) + count(*) filter (where e.estado = 'de_baja') total
      from e left join catalogo_items c on c.id = e.marca_id group by c.id, c.nombre) t where t.total > 0 limit 12),
  'fallas_modelo', (select coalesce(jsonb_agg(t order by t.total desc), '[]') from (
      select coalesce(nullif(e.modelo, ''), 'Sin modelo') nombre,
        count(distinct r.id) reparaciones, count(distinct e.id) filter (where e.estado = 'de_baja') bajas,
        count(distinct r.id) + count(distinct e.id) filter (where e.estado = 'de_baja') total
      from e left join r on r.equipo_id = e.id group by 1) t where t.total > 0 limit 12),
  'por_cargo', (select coalesce(jsonb_agg(t order by t.cantidad desc), '[]') from (
      select coalesce(nullif(em.cargo, ''), 'Sin cargo') nombre, count(*) cantidad from e join empleados em on em.id = e.empleado_id where e.estado = 'asignado' group by 1 order by 2 desc limit 15) t),
  'por_area', (select coalesce(jsonb_agg(t order by t.cantidad desc), '[]') from (
      select coalesce(c.nombre, 'Sin área') nombre, count(*) cantidad from e join empleados em on em.id = e.empleado_id left join catalogo_items c on c.id = em.area_id where e.estado = 'asignado' group by 1 order by 2 desc limit 15) t),
  'por_sede_emp', (select coalesce(jsonb_agg(t order by t.cantidad desc), '[]') from (
      select coalesce(c.nombre, 'Sin sede') nombre, count(*) cantidad from e join empleados em on em.id = e.empleado_id left join catalogo_items c on c.id = em.sede_id where e.estado = 'asignado' group by 1 order by 2 desc limit 15) t),
  'movimientos', (select coalesce(jsonb_agg(t order by t.mes), '[]') from (
      select to_char(m, 'YYYY-MM') mes,
        (select count(*) from a where estado = 'firmada' and tipo = 'entrega' and date_trunc('month', firmado_at) = m) entregas,
        (select count(*) from a where estado = 'firmada' and tipo = 'devolucion' and date_trunc('month', firmado_at) = m) devoluciones,
        (select count(*) from e where date_trunc('month', fecha_ingreso) = m) ingresos,
        (select count(*) from e where fecha_ingreso < m + interval '1 month') acumulado
      from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m) t),
  'stock', (select coalesce(jsonb_agg(t order by t.nombre), '[]') from (
      select c.nombre, (select count(*) from equipos x where x.owner_id = (select public.my_owner_id()) and x.tipo_id = s.tipo_id and x.estado = 'disponible') disponibles, s.stock_minimo minimo
      from alertas_stock_config s join catalogo_items c on c.id = s.tipo_id where s.owner_id = (select public.my_owner_id()) and s.activa) t),
  'garantias', jsonb_build_object(
      'd30', (select count(*) from e where estado <> 'de_baja' and garantia_fin between current_date and current_date + 30),
      'd60', (select count(*) from e where estado <> 'de_baja' and garantia_fin between current_date + 31 and current_date + 60),
      'd90', (select count(*) from e where estado <> 'de_baja' and garantia_fin between current_date + 61 and current_date + 90))
)
$$;

