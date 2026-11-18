-- Seguridad por fila, documentos consistentes y operaciones de negocio atómicas.
-- Preflight: nunca fusiona ni elimina identidades o documentos ambiguos.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

do $$ begin
  if exists (select 1 from public.empleados
    group by upper(regexp_replace(identificacion, '[^0-9A-Za-z]', '', 'g')) having count(*) > 1)
    or exists (select 1 from public.empleados where regexp_replace(identificacion, '[^0-9A-Za-z]', '', 'g') = '') then
    raise exception 'PRECHECK_IDENTIFICACION: existen cédulas vacías o duplicadas tras normalización. Corrija las fichas antes de migrar; no se eliminó ninguna.';
  end if;
  if exists (select 1 from public.acta_items i join public.actas a on a.id=i.acta_id
    where a.tipo='cambio' and i.direccion is null) then
    raise exception 'PRECHECK_DIRECCION: existen líneas de cambio sin dirección. Corrija explícitamente antes de migrar.';
  end if;
  if exists (select 1 from public.acta_items i join public.actas a on a.id=i.acta_id
    where a.estado='pendiente' group by i.equipo_id having count(*)>1) then
    raise exception 'PRECHECK_RESERVAS: un equipo figura en varias actas pendientes. Anule las actas duplicadas antes de migrar; no se eliminó ninguna.';
  end if;
  if exists (select 1 from public.reportes_falla where estado='abierto' group by equipo_id having count(*)>1) then
    raise exception 'PRECHECK_FALLAS: un equipo tiene varios reportes abiertos. Atienda o descarte los duplicados antes de migrar; se conserva el historial.';
  end if;
  if exists (select 1 from public.pedido_lineas where cantidad<=0 or recibida<0 or recibida>cantidad or precio_estimado<0) then
    raise exception 'PRECHECK_PEDIDOS: hay cantidades o precios inválidos. Concilie las líneas con sus recepciones antes de migrar.';
  end if;
end $$;

alter table public.empleados add column identificacion_normalizada text generated always as
  (upper(regexp_replace(identificacion, '[^0-9A-Za-z]', '', 'g'))) stored;
alter table public.empleados add constraint empleados_identificacion_canonica_no_vacia check (identificacion_normalizada <> '');
create unique index empleados_identificacion_canonica_uq on public.empleados(identificacion_normalizada);
revoke insert, update on public.empleados from authenticated;
grant insert (nombre,identificacion,email,cargo,area_id,sede_id,empresa_id,activo,owner_id,created_by)
  on public.empleados to authenticated;
grant update (nombre,identificacion,email,cargo,area_id,sede_id,empresa_id,activo)
  on public.empleados to authenticated;

create or replace function public.usuario_habilitado(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active(p_user) and (
    not public.has_role(p_user,'empleado') or exists(select 1 from public.empleados where user_id=p_user and activo)
  )
$$;
create or replace function public.my_owner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when not public.usuario_habilitado(auth.uid()) then null
    when public.has_role(auth.uid(),'admin') then auth.uid()
    else (select owner_id from public.user_roles where user_id=auth.uid() and role='auxiliar' limit 1) end
$$;
create or replace function public.my_empleado_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.empleados where user_id=auth.uid() and activo and public.is_active(auth.uid())
    and public.has_role(auth.uid(),'empleado') and not public.is_staff(auth.uid()) limit 1
$$;
do $$ declare t text; begin
  foreach t in array array['catalogo_items','empleados','proveedores','alertas_stock_config','articulo_proveedores',
    'equipos','equipo_historial','reparaciones','actas','acta_items','tokens_firma','solicitudes_reabastecimiento',
    'pedidos_compra','pedido_lineas','reportes_falla','certificaciones','certificacion_respuestas','auditoria'] loop
    execute format('create policy "Usuario habilitado" on public.%I as restrictive for all to authenticated using (public.usuario_habilitado(auth.uid())) with check (public.usuario_habilitado(auth.uid()))',t);
  end loop;
end $$;

create or replace function public.user_roles_guard_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role='admin' and auth.uid() is not null then
    raise exception 'El rol de Administrador solo se asigna directamente en la base de datos.';
  end if;
  if exists(select 1 from public.user_roles where user_id=new.user_id and id<>new.id
    and ((role='empleado')<>(new.role='empleado'))) then
    raise exception 'Una identidad no puede ser empleado y personal administrativo a la vez';
  end if;
  if new.role in ('admin','auxiliar') and exists(select 1 from public.empleados where user_id=new.user_id) then
    raise exception 'Una identidad ligada a un empleado no puede ser personal administrativo';
  end if;
  return new;
end $$;

create or replace function app_private.catalogo_valido(p_id uuid,p_owner uuid,p_tipo public.catalogo_tipo)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_id is not null and not exists(select 1 from public.catalogo_items where id=p_id and owner_id=p_owner and tipo=p_tipo) then
    raise exception 'Catálogo incompatible con el tipo o ecosistema';
  end if;
end $$;
create or replace function app_private.proveedor_valido(p_id uuid,p_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_id is not null and not exists(select 1 from public.proveedores where id=p_id and owner_id=p_owner) then
    raise exception 'Proveedor ajeno al ecosistema';
  end if;
end $$;
create or replace function public.validar_referencias_ecosistema()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.owner_id is null then raise exception 'El ecosistema es obligatorio'; end if;
  if tg_table_name='empleados' then
    perform app_private.catalogo_valido(new.area_id,new.owner_id,'area');
    perform app_private.catalogo_valido(new.sede_id,new.owner_id,'sede');
    perform app_private.catalogo_valido(new.empresa_id,new.owner_id,'empresa');
    if new.user_id is not null and exists(select 1 from public.user_roles where user_id=new.user_id and role in ('admin','auxiliar')) then
      raise exception 'No se puede vincular una identidad administrativa a un empleado';
    end if;
  elsif tg_table_name='equipos' then
    perform app_private.catalogo_valido(new.tipo_id,new.owner_id,'tipo_equipo');
    perform app_private.catalogo_valido(new.marca_id,new.owner_id,'marca');
    perform app_private.catalogo_valido(new.sede_id,new.owner_id,'sede');
    perform app_private.proveedor_valido(new.proveedor_id,new.owner_id);
    perform app_private.proveedor_valido(new.reparacion_proveedor_id,new.owner_id);
    if new.empleado_id is not null and not exists(select 1 from public.empleados where id=new.empleado_id and owner_id=new.owner_id) then
      raise exception 'Empleado ajeno al ecosistema';
    end if;
  elsif tg_table_name='actas' then
    if not exists(select 1 from public.empleados where id=new.empleado_id and owner_id=new.owner_id) then
      raise exception 'Empleado ajeno al ecosistema';
    end if;
    if new.prestamo_reparacion_equipo_id is not null and not exists(select 1 from public.equipos where id=new.prestamo_reparacion_equipo_id and owner_id=new.owner_id) then
      raise exception 'Equipo de reparación ajeno al ecosistema';
    end if;
  elsif tg_table_name in ('alertas_stock_config','articulo_proveedores') then
    perform app_private.catalogo_valido(new.tipo_id,new.owner_id,'tipo_equipo');
    if tg_table_name='articulo_proveedores' then perform app_private.proveedor_valido(new.proveedor_id,new.owner_id); end if;
  elsif tg_table_name='pedidos_compra' then
    perform app_private.proveedor_valido(new.proveedor_id,new.owner_id);
  elsif tg_table_name='pedido_lineas' then
    perform app_private.catalogo_valido(new.tipo_id,new.owner_id,'tipo_equipo');
    if not exists(select 1 from public.pedidos_compra where id=new.pedido_id and owner_id=new.owner_id) then
      raise exception 'Pedido ajeno al ecosistema';
    end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['empleados','equipos','actas','alertas_stock_config','articulo_proveedores','pedidos_compra','pedido_lineas'] loop
    execute format('create trigger validar_ecosistema before insert or update on public.%I for each row execute function public.validar_referencias_ecosistema()',t);
  end loop;
end $$;

create or replace function public.empleados_before_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.activo and not new.activo and exists(select 1 from public.equipos where empleado_id=new.id and estado in ('asignado','en_reparacion')) then
    raise exception 'PAZ_Y_SALVO: El empleado tiene equipos asignados o en reparación a su cargo. Realice primero la devolución.';
  end if;
  return new;
end $$;
grant usage on sequence public.periferico_seq to authenticated,service_role;
create or replace function public.equipos_before_insert()
returns trigger language plpgsql set search_path=public as $$
declare n text;
begin
  if new.serie is null or btrim(new.serie)='' then
    n:=nextval('public.periferico_seq')::text;
    new.serie:='FIN-ACC-'||lpad(n,greatest(4,length(n)),'0'); new.codigo_interno:=true;
  else new.serie:=upper(btrim(new.serie)); end if;
  if new.estado not in ('disponible','en_reparacion') then
    raise exception 'Un equipo nuevo solo puede registrarse como Disponible o En reparación';
  end if;
  new.empleado_id:=null;
  return new;
end $$;

update public.acta_items i set direccion=a.tipo::text from public.actas a
  where i.acta_id=a.id and i.direccion is null and a.tipo<>'cambio';
alter table public.acta_items alter column direccion set not null;
alter table public.acta_items add constraint acta_items_direccion_valida check(direccion in ('entrega','devolucion'));
alter table public.acta_items add constraint acta_items_destino_valido check(estado_destino in ('disponible','en_alistamiento','en_reparacion'));
alter table public.pedido_lineas add constraint pedido_lineas_cantidades_validas check(cantidad>0 and recibida>=0 and recibida<=cantidad);
alter table public.pedido_lineas add constraint pedido_lineas_precio_valido check(precio_estimado is null or precio_estimado>=0);
revoke update on public.pedido_lineas from authenticated;
grant update (tipo_id,cantidad,precio_estimado) on public.pedido_lineas to authenticated;

-- La clave primaria serializa la reserva aun entre transacciones concurrentes.
create table app_private.equipo_reservas (
  equipo_id uuid primary key references public.equipos(id) on delete cascade,
  acta_id uuid not null references public.actas(id) on delete cascade
);
insert into app_private.equipo_reservas(equipo_id,acta_id)
  select i.equipo_id,i.acta_id from public.acta_items i join public.actas a on a.id=i.acta_id where a.estado='pendiente';
create or replace function public.actas_before_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare emp public.empleados;
begin
  select * into emp from public.empleados where id=new.empleado_id;
  if not found or emp.owner_id is distinct from new.owner_id then raise exception 'Empleado ajeno al ecosistema'; end if;
  if new.tipo in ('entrega','cambio') and not emp.activo then raise exception 'No se puede entregar equipos a un empleado inactivo.'; end if;
  if new.es_prestamo and (new.tipo<>'entrega' or new.prestamo_hasta is null or new.prestamo_hasta<current_date) then
    raise exception 'El préstamo requiere entrega y fecha futura';
  end if;
  new.estado:='pendiente'; new.firmado_at:=null; new.pdf_path:=null; new.firma_path:=null; new.pdf_hash:=null;
  new.tecnico_firma_path:=null;
  select coalesce(nullif(nombre,''),email) into new.tecnico_nombre from public.profiles where id=new.tecnico_id;
  return new;
end $$;
create or replace function public.acta_items_before_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare a public.actas; e public.equipos;
begin
  select * into a from public.actas where id=new.acta_id for update;
  if not found or a.estado<>'pendiente' then raise exception 'El acta no está pendiente'; end if;
  select * into e from public.equipos where id=new.equipo_id for update;
  if not found or e.owner_id is distinct from a.owner_id then raise exception 'Equipo ajeno al ecosistema'; end if;
  if a.tipo<>'cambio' then new.direccion:=a.tipo::text; end if;
  if new.direccion is null or new.direccion not in ('entrega','devolucion') then raise exception 'Indique si el equipo se entrega o se devuelve'; end if;
  if new.estado_destino is null or new.estado_destino not in ('disponible','en_alistamiento','en_reparacion') then raise exception 'Estado de destino inválido'; end if;
  if new.direccion='entrega' and e.estado<>'disponible' then raise exception 'El equipo % no está Disponible.',e.serie; end if;
  if new.direccion='devolucion' and (e.estado not in ('asignado','en_reparacion') or e.empleado_id is distinct from a.empleado_id) then
    raise exception 'El equipo % no está asignado a este empleado.',e.serie;
  end if;
  begin insert into app_private.equipo_reservas values(new.equipo_id,new.acta_id);
  exception when unique_violation then raise exception 'El equipo % ya está en otra acta pendiente de firma.',e.serie; end;
  return new;
end $$;
create or replace function app_private.liberar_reserva_equipo()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='actas' then
    if new.estado<>'pendiente' then delete from app_private.equipo_reservas where acta_id=new.id; end if;
    return new;
  end if;
  delete from app_private.equipo_reservas where acta_id=old.acta_id and equipo_id=old.equipo_id;
  return old;
end $$;
create trigger z_liberar_reservas after update on public.actas for each row execute function app_private.liberar_reserva_equipo();
create trigger liberar_reserva_item after delete on public.acta_items for each row execute function app_private.liberar_reserva_equipo();

create or replace function app_private.validar_firma(p_acta uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.actas; emp public.empleados; i record;
begin
  select * into a from public.actas where id=p_acta for update;
  if not found or a.estado<>'pendiente' then raise exception 'El acta no está pendiente de firma'; end if;
  perform 1 from public.equipos e join public.acta_items it on it.equipo_id=e.id
    where it.acta_id=a.id order by e.id for update of e,it;
  select * into emp from public.empleados where id=a.empleado_id for update;
  if not found or emp.owner_id is distinct from a.owner_id then raise exception 'Empleado ajeno al ecosistema'; end if;
  if a.tipo in ('entrega','cambio') and not emp.activo then raise exception 'El empleado está inactivo'; end if;
  if not exists(select 1 from public.acta_items where acta_id=a.id) then raise exception 'El acta no tiene equipos'; end if;
  if a.tipo='cambio' and (not exists(select 1 from public.acta_items where acta_id=a.id and direccion='entrega')
    or not exists(select 1 from public.acta_items where acta_id=a.id and direccion='devolucion')) then
    raise exception 'Un cambio requiere entrega y devolución';
  end if;
  for i in select e.*,it.direccion from public.acta_items it join public.equipos e on e.id=it.equipo_id
    where it.acta_id=a.id order by e.id for update of e,it loop
    if i.owner_id is distinct from a.owner_id then raise exception 'Equipo ajeno al ecosistema'; end if;
    if i.direccion='entrega' and (i.estado<>'disponible' or i.empleado_id is not null) then raise exception 'El equipo % ya no está disponible',i.serie; end if;
    if i.direccion='devolucion' and (i.estado not in ('asignado','en_reparacion') or i.empleado_id is distinct from a.empleado_id) then
      raise exception 'El equipo % ya no está a cargo del empleado',i.serie;
    end if;
  end loop;
end $$;
create or replace function public.actas_before_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.estado='anulada' and new.estado is distinct from old.estado then raise exception 'Un acta anulada no puede cambiar de estado'; end if;
  if old.estado='anulada' and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception 'El contenido de un acta anulada es inmutable';
  end if;
  if old.estado='firmada' and new.estado not in ('firmada','anulada') then raise exception 'Un acta firmada solo puede anularse'; end if;
  if old.estado='firmada' and (to_jsonb(new)-array['estado','anulada_motivo','anulada_por','anulada_at','updated_at'])
    is distinct from (to_jsonb(old)-array['estado','anulada_motivo','anulada_por','anulada_at','updated_at']) then
    raise exception 'El contenido de un acta firmada es inmutable';
  end if;
  if new.estado='firmada' and old.estado='pendiente' then perform app_private.validar_firma(old.id); end if;
  return new;
end $$;

create index if not exists acta_items_equipo_idx on public.acta_items(equipo_id);
create index if not exists pedido_lineas_pedido_idx on public.pedido_lineas(pedido_id);
create index if not exists reparaciones_equipo_idx on public.reparaciones(equipo_id);
create index if not exists tokens_firma_acta_idx on public.tokens_firma(acta_id);
create unique index reportes_falla_un_abierto on public.reportes_falla(equipo_id) where estado='abierto';
create index if not exists reservas_acta_idx on app_private.equipo_reservas(acta_id);

create or replace function public.equipos_before_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.serie is distinct from old.serie and coalesce(current_setting('app.serie_ok',true),'')<>'1' then
    raise exception 'El número de serie no se puede modificar. Solo el Administrador puede corregirlo indicando un motivo.';
  end if;
  if (new.estado is distinct from old.estado or new.empleado_id is distinct from old.empleado_id)
    and coalesce(current_setting('app.estado_ok',true),'')<>'1' then
    raise exception 'El estado del equipo solo cambia mediante actas firmadas o con un motivo registrado.';
  end if;
  if new.empleado_id is not null and (new.empleado_id is distinct from old.empleado_id or new.estado is distinct from old.estado) then
    perform 1 from public.empleados where id=new.empleado_id and activo and owner_id=new.owner_id for update;
    if not found then raise exception 'Empleado inactivo o ajeno al ecosistema'; end if;
  end if;
  return new;
end $$;

create or replace function public.documento_inmutable()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_estado public.acta_estado;
begin
  if tg_table_name='actas' then v_estado:=old.estado;
  else select estado into v_estado from public.actas where id=old.acta_id for update; end if;
  if v_estado in ('firmada','anulada') then raise exception 'El contenido del documento emitido es inmutable'; end if;
  if tg_table_name='acta_items' and tg_op='UPDATE' then raise exception 'Recree el ítem pendiente para modificarlo'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger actas_no_delete_emitida before delete on public.actas for each row execute function public.documento_inmutable();
create trigger acta_items_inmutables before update or delete on public.acta_items for each row execute function public.documento_inmutable();

drop policy "Personal ve facturas" on storage.objects;
create policy "Personal ve facturas" on storage.objects for select to authenticated using (
  bucket_id='facturas' and public.is_staff(auth.uid()) and (owner=auth.uid() or exists(
    select 1 from public.equipos e where e.owner_id=public.my_owner_id() and name in (e.factura_path,e.baja_documento_path)))
);
drop policy "Personal ve actas" on storage.objects;
create policy "Personal ve actas" on storage.objects for select to authenticated using (
  bucket_id='actas' and public.is_staff(auth.uid()) and exists(select 1 from public.actas a
    where a.owner_id=public.my_owner_id() and split_part(name,'/',1)=a.id::text)
);
create policy "Eliminar factura propia sin referencias" on storage.objects for delete to authenticated using (
  bucket_id='facturas' and owner=auth.uid() and public.has_permiso(auth.uid(),'equipos_editar') and not exists(
    select 1 from public.equipos e where name in (e.factura_path,e.baja_documento_path))
);

create or replace function public.pedido_lineas_guardar()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.pedidos_compra;
begin
  select * into p from public.pedidos_compra where id=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end for update;
  if coalesce(current_setting('app.recibiendo_pedido',true),'')<>'1' then
    if p.estado<>'borrador' then raise exception 'Solo se pueden editar líneas de un borrador'; end if;
    if tg_op='INSERT' and new.recibida<>0 then raise exception 'La recepción se registra mediante su RPC'; end if;
    if tg_op='UPDATE' and new.recibida is distinct from old.recibida then raise exception 'La recepción se registra mediante su RPC'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger pedido_lineas_guardar before insert or update or delete on public.pedido_lineas
  for each row execute function public.pedido_lineas_guardar();

create or replace function public.crear_pedido(p_proveedor uuid,p_lineas jsonb,p_notas text default null,
  p_fecha_esperada date default null,p_estado text default 'borrador')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; it jsonb; v_owner uuid:=public.my_owner_id();
begin
  if not public.has_permiso(auth.uid(),'reabastecimiento_gestionar') then raise exception 'Sin permiso'; end if;
  if p_estado is null or p_estado not in ('borrador','pedido') then raise exception 'Estado inicial inválido'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas) not between 1 and 1000 then
    raise exception 'Indique entre 1 y 1000 líneas';
  end if;
  perform app_private.proveedor_valido(p_proveedor,v_owner);
  insert into public.pedidos_compra(proveedor_id,notas,fecha_esperada,owner_id,creado_por,creado_nombre)
    values(p_proveedor,p_notas,p_fecha_esperada,v_owner,auth.uid(),(select nombre from public.profiles where id=auth.uid())) returning id into v_id;
  for it in select value from jsonb_array_elements(p_lineas) loop
    insert into public.pedido_lineas(pedido_id,tipo_id,cantidad,precio_estimado,owner_id)
      values(v_id,(it->>'tipo_id')::uuid,(it->>'cantidad')::integer,(it->>'precio_estimado')::numeric,v_owner);
  end loop;
  if p_estado='pedido' then update public.pedidos_compra set estado='pedido',fecha_pedido=current_date where id=v_id; end if;
  return v_id;
end $$;

create or replace function public.crear_acta(p_empleado uuid,p_tipo public.acta_tipo,p_items jsonb,
  p_observaciones text default null,p_es_prestamo boolean default false,p_prestamo_hasta date default null,
  p_reparacion_equipo uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; it jsonb; v_owner uuid:=public.my_owner_id();
begin
  if (p_tipo='entrega' and not public.has_permiso(auth.uid(),'actas_entrega'))
    or (p_tipo='devolucion' and not public.has_permiso(auth.uid(),'actas_devolucion'))
    or (p_tipo='cambio' and not (public.has_permiso(auth.uid(),'actas_entrega') and public.has_permiso(auth.uid(),'actas_devolucion')))
    or p_tipo is null or v_owner is null then raise exception 'Sin permiso'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 1000 then
    raise exception 'Indique entre 1 y 1000 equipos';
  end if;
  insert into public.actas(tipo,empleado_id,tecnico_id,owner_id,observaciones,es_prestamo,prestamo_hasta,prestamo_reparacion_equipo_id)
    values(p_tipo,p_empleado,auth.uid(),v_owner,p_observaciones,p_es_prestamo,p_prestamo_hasta,p_reparacion_equipo) returning id into v_id;
  for it in select value from jsonb_array_elements(p_items) order by value->>'equipo_id' loop
    insert into public.acta_items(acta_id,equipo_id,direccion,estado_destino,estado_fisico,accesorios,nota)
      values(v_id,(it->>'equipo_id')::uuid,it->>'direccion',coalesce(it->>'estado_destino','disponible'),it->>'estado_fisico',it->>'accesorios',it->>'nota');
  end loop;
  if p_tipo='cambio' and (not exists(select 1 from public.acta_items where acta_id=v_id and direccion='entrega')
    or not exists(select 1 from public.acta_items where acta_id=v_id and direccion='devolucion')) then
    raise exception 'Un cambio requiere entrega y devolución';
  end if;
  return v_id;
end $$;

create or replace function public.crear_prestamo_contingencia(p_equipo_reparacion uuid,p_equipo_contingencia uuid,
  p_motivo text,p_hasta date,p_proveedor uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.equipos;
begin
  if not public.has_permiso(auth.uid(),'equipos_editar') or not public.has_permiso(auth.uid(),'actas_entrega') then raise exception 'Sin permiso'; end if;
  if p_equipo_reparacion=p_equipo_contingencia then raise exception 'El equipo de contingencia debe ser diferente'; end if;
  perform 1 from public.equipos where id in (p_equipo_reparacion,p_equipo_contingencia) order by id for update;
  select * into e from public.equipos where id=p_equipo_reparacion and owner_id=public.my_owner_id();
  if not found or e.estado not in ('asignado','en_reparacion') or e.empleado_id is null then raise exception 'El equipo no tiene un empleado a cargo'; end if;
  if e.estado<>'en_reparacion' then perform public.cambiar_estado_equipo(p_equipo_reparacion,'en_reparacion',p_motivo,p_proveedor,null); end if;
  return public.crear_acta(e.empleado_id,'entrega',jsonb_build_array(jsonb_build_object('equipo_id',p_equipo_contingencia)),
    p_motivo,true,p_hasta,p_equipo_reparacion);
end $$;

-- Un snapshot firmado nunca mezcla lecturas de distintas versiones.
create or replace function app_private.snapshot_acta(p_acta uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('acta',to_jsonb(a)||jsonb_build_object('empleado',
  jsonb_build_object('id',em.id,'nombre',em.nombre,'identificacion',em.identificacion,'email',em.email,'cargo',em.cargo,
    'user_id',em.user_id,'activo',em.activo,'owner_id',em.owner_id,
    'area',(select jsonb_build_object('nombre',nombre) from public.catalogo_items where id=em.area_id),
    'sede',(select jsonb_build_object('nombre',nombre) from public.catalogo_items where id=em.sede_id),
    'empresa',(select jsonb_build_object('nombre',nombre) from public.catalogo_items where id=em.empresa_id))),
  'equipos',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('estado_fisico',i.estado_fisico,'accesorios',i.accesorios,
    'nota',i.nota,'direccion',i.direccion,'estado_destino',i.estado_destino,
    'tipo',(select jsonb_build_object('nombre',nombre) from public.catalogo_items where id=e.tipo_id),
    'marca',(select jsonb_build_object('nombre',nombre) from public.catalogo_items where id=e.marca_id)) order by e.id)
    from public.acta_items i join public.equipos e on e.id=i.equipo_id where i.acta_id=a.id),'[]'::jsonb))
from public.actas a join public.empleados em on em.id=a.empleado_id where a.id=p_acta
$$;

create table app_private.firma_reservas (
  acta_id uuid primary key references public.actas(id) on delete cascade,
  lease_id uuid not null unique,
  actor_id uuid,
  token_id uuid references public.tokens_firma(id),
  snapshot jsonb not null,
  firmado_at timestamptz not null,
  expires_at timestamptz not null,
  estado text not null check(estado in ('reservada','confirmada','cancelada'))
);
create or replace function app_private.exigir_servidor()
returns void language plpgsql set search_path=public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Operación exclusiva del servidor'; end if;
end $$;
create or replace function app_private.actor_puede_firmar(p_acta uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.actas a join public.empleados em on em.id=a.empleado_id where a.id=p_acta and (
    (public.has_permiso(p_actor,'firmas_capturar') and (a.owner_id=p_actor and public.has_role(p_actor,'admin')
      or exists(select 1 from public.user_roles r where r.user_id=p_actor and r.role='auxiliar' and r.owner_id=a.owner_id)))
    or (em.user_id=p_actor and em.activo and public.is_active(p_actor) and public.has_role(p_actor,'empleado') and not public.is_staff(p_actor))))
$$;
create or replace function public.reservar_firma(p_acta uuid,p_actor uuid,p_token text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.actas; r app_private.firma_reservas; t public.tokens_firma; s jsonb; lease uuid:=gen_random_uuid(); ts timestamptz:=clock_timestamp();
begin
  perform app_private.exigir_servidor();
  select * into a from public.actas where id=p_acta for update;
  if not found then raise exception 'Acta no encontrada'; end if;
  if p_actor is not null then
    if not app_private.actor_puede_firmar(p_acta,p_actor) then raise exception 'Sin autorización para firmar'; end if;
  else
    select * into t from public.tokens_firma where acta_id=p_acta and token=p_token for update;
    if not found then raise exception 'Enlace inválido'; end if;
    if a.estado<>'firmada' and (t.used_at is not null or least(t.expires_at,t.created_at+interval '15 minutes')<=ts) then
      raise exception 'Enlace usado o vencido';
    end if;
    if a.estado='firmada' and not exists(select 1 from app_private.firma_reservas where acta_id=p_acta and token_id=t.id and estado='confirmada') then
      raise exception 'El enlace no corresponde a la firma confirmada';
    end if;
  end if;
  if a.estado='firmada' then return jsonb_build_object('ya_firmada',true,'numero',a.numero,'pdfHash',a.pdf_hash); end if;
  perform app_private.validar_firma(p_acta);
  select * into r from app_private.firma_reservas where acta_id=p_acta;
  if found and r.estado='reservada' and r.expires_at>ts then raise exception 'Firma en proceso; intente de nuevo'; end if;
  s:=app_private.snapshot_acta(p_acta);
  insert into app_private.firma_reservas values(p_acta,lease,p_actor,t.id,s,ts,ts+interval '5 minutes','reservada')
    on conflict(acta_id) do update set lease_id=excluded.lease_id,actor_id=excluded.actor_id,token_id=excluded.token_id,
      snapshot=excluded.snapshot,firmado_at=excluded.firmado_at,expires_at=excluded.expires_at,estado='reservada';
  return jsonb_build_object('lease_id',lease,'acta_id',p_acta,'firmado_at',ts,'snapshot',s,'ya_firmada',false);
end $$;
create or replace function public.confirmar_firma(p_acta uuid,p_lease uuid,p_actor uuid,p_firma_path text,p_pdf_path text,
  p_pdf_hash text,p_medio text,p_ip text,p_user_agent text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.actas; r app_private.firma_reservas; t public.tokens_firma;
begin
  perform app_private.exigir_servidor();
  select * into a from public.actas where id=p_acta for update;
  select * into r from app_private.firma_reservas where acta_id=p_acta and lease_id=p_lease for update;
  if not found or r.actor_id is distinct from p_actor then raise exception 'Reserva de firma inválida'; end if;
  if r.estado='confirmada' and a.estado='firmada' then
    if a.firma_path is distinct from p_firma_path or a.pdf_path is distinct from p_pdf_path or a.pdf_hash is distinct from p_pdf_hash then
      raise exception 'El reintento difiere de la firma confirmada';
    end if;
    return jsonb_build_object('ok',true,'numero',a.numero,'pdfHash',a.pdf_hash,'ya_firmada',true);
  end if;
  if r.estado<>'reservada' or r.expires_at<=clock_timestamp() then raise exception 'Reserva de firma vencida'; end if;
  if p_firma_path is distinct from (p_acta||'/'||p_lease||'/firma.png') or p_pdf_path is distinct from (p_acta||'/'||p_lease||'/acta.pdf')
    or p_pdf_hash is null or p_pdf_hash !~ '^[a-f0-9]{64}$' then raise exception 'Rutas o hash de firma inválidos'; end if;
  if p_actor is not null and not app_private.actor_puede_firmar(p_acta,p_actor) then raise exception 'Sin autorización para firmar'; end if;
  if r.token_id is not null then
    select * into t from public.tokens_firma where id=r.token_id for update;
    if not found or t.used_at is not null or least(t.expires_at,t.created_at+interval '15 minutes')<=clock_timestamp() then raise exception 'Enlace usado o vencido'; end if;
  end if;
  perform app_private.validar_firma(p_acta);
  -- También bloquea los nombres referenciados por el snapshot hasta el commit.
  perform 1 from public.catalogo_items where owner_id=a.owner_id order by id for share;
  if app_private.snapshot_acta(p_acta) is distinct from r.snapshot then raise exception 'El acta o sus equipos cambiaron durante la firma; vuelva a intentarlo'; end if;
  update public.actas set estado='firmada',firmado_at=r.firmado_at,firma_path=p_firma_path,pdf_path=p_pdf_path,pdf_hash=p_pdf_hash,
    firma_medio=p_medio,firma_ip=p_ip,firma_user_agent=left(p_user_agent,400) where id=p_acta;
  update public.tokens_firma set used_at=clock_timestamp() where acta_id=p_acta and used_at is null;
  update app_private.firma_reservas set estado='confirmada' where acta_id=p_acta;
  insert into public.auditoria(user_id,tabla,accion,registro_id,detalle)
    values(p_actor,'actas','FIRMA',p_acta::text,'Firma confirmada: '||p_medio||' · SHA-256 '||p_pdf_hash);
  return jsonb_build_object('ok',true,'numero',a.numero,'pdfHash',p_pdf_hash,'ya_firmada',false);
end $$;
create or replace function public.cancelar_firma(p_acta uuid,p_lease uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform app_private.exigir_servidor();
  update app_private.firma_reservas set estado='cancelada' where acta_id=p_acta and lease_id=p_lease and estado='reservada';
end $$;

create table app_private.pin_reservas (
  empleado_id uuid primary key references public.empleados(id) on delete cascade,
  lease_id uuid not null,
  created_at timestamptz not null default now()
);
create or replace function public.reservar_intento_pin(p_empleado uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.empleados; v_lease uuid:=gen_random_uuid(); ts timestamptz:=clock_timestamp(); n integer;
begin
  perform app_private.exigir_servidor();
  select * into e from public.empleados where id=p_empleado for update;
  if not found or not e.activo or e.user_id is null or not public.usuario_habilitado(e.user_id) or not public.has_role(e.user_id,'empleado') then
    return jsonb_build_object('permitido',false,'intentos',0,'bloqueo_hasta',null,'lease_id',null);
  end if;
  if e.pin_bloqueo_hasta>ts then return jsonb_build_object('permitido',false,'intentos',e.pin_intentos,'bloqueo_hasta',e.pin_bloqueo_hasta,'lease_id',null); end if;
  n:=case when e.pin_bloqueo_hasta is not null then 1 else e.pin_intentos+1 end;
  update public.empleados set pin_intentos=n,pin_bloqueo_hasta=case when n>=5 then ts+interval '15 minutes' else null end where id=p_empleado;
  insert into app_private.pin_reservas(empleado_id,lease_id,created_at) values(p_empleado,v_lease,ts)
    on conflict(empleado_id) do update set lease_id=excluded.lease_id,created_at=excluded.created_at;
  return jsonb_build_object('permitido',true,'intentos',n,'lease_id',v_lease,'bloqueo_hasta',case when n>=5 then ts+interval '15 minutes' end);
end $$;
create or replace function public.finalizar_intento_pin(p_empleado uuid,p_lease uuid,p_exito boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform app_private.exigir_servidor();
  perform 1 from public.empleados where id=p_empleado for update;
  if exists(select 1 from app_private.pin_reservas where empleado_id=p_empleado and lease_id=p_lease and created_at>clock_timestamp()-interval '5 minutes') then
    if p_exito then update public.empleados set pin_intentos=0,pin_bloqueo_hasta=null where id=p_empleado; end if;
    delete from app_private.pin_reservas where empleado_id=p_empleado and lease_id=p_lease;
  end if;
end $$;

create or replace function public.reemplazar_permisos_usuario(p_user uuid,p_permisos text[],p_actor uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_permisos public.app_permiso[]; v_extras jsonb;
begin
  perform app_private.exigir_servidor();
  if not (public.has_role(p_actor,'admin') and public.is_active(p_actor)) then raise exception 'Solo administrador activo'; end if;
  perform 1 from public.user_roles where user_id=p_user and role='auxiliar' and owner_id=p_actor for update;
  if not found then raise exception 'Auxiliar ajeno al ecosistema'; end if;
  v_permisos:=coalesce(p_permisos,'{}')::public.app_permiso[];
  delete from public.user_permisos where user_id=p_user;
  insert into public.user_permisos(user_id,permiso) select distinct p_user,x from unnest(v_permisos) x;
  select coalesce(jsonb_agg(x),'[]') into v_extras from unnest(coalesce(p_permisos,'{}')) x
    where x in ('reabastecimiento_gestionar','proveedores_editar','estadisticas_ver','catalogos_editar');
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('permisos_extra',v_extras) where id=p_user;
  insert into public.auditoria(user_id,tabla,accion,registro_id,detalle)
    values(p_actor,'usuarios','PERMISOS',p_user::text,'Permisos: '||coalesce(array_to_string(p_permisos,', '),'ninguno'));
end $$;

-- Reemplazos acotados: conservan trazabilidad y permisos de las RPC existentes.
create or replace function public.corregir_serie(p_equipo uuid, p_serie text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare old_serie text;
begin
  if not (public.has_role(auth.uid(), 'admin') and public.is_active(auth.uid())) then
    raise exception 'Solo el Administrador puede corregir series';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  if coalesce(btrim(p_serie), '') = '' then raise exception 'La serie no puede estar vacía'; end if;
  select serie into old_serie from public.equipos where id = p_equipo and owner_id = public.my_owner_id() for update;
  if not found then raise exception 'Equipo no encontrado'; end if;
  perform set_config('app.serie_ok', '1', true);
  update public.equipos set serie = upper(btrim(p_serie)) where id = p_equipo;
  perform set_config('app.serie_ok', '', true);
  insert into public.equipo_historial(equipo_id, evento, detalle)
  values (p_equipo, 'correccion_serie', old_serie || ' → ' || upper(btrim(p_serie)) || '. Motivo: ' || p_motivo);
end $$;
create or replace function public.cambiar_estado_equipo(
  p_equipo uuid,
  p_estado public.equipo_estado,
  p_motivo text,
  p_proveedor uuid default null,
  p_documento_baja text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.equipos;
  es_admin boolean := public.has_role(auth.uid(), 'admin');
  pn text;
  det_hist text;
begin
  if not public.has_permiso(auth.uid(), 'equipos_editar') then raise exception 'Sin permiso'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  if p_estado is null then raise exception 'Estado obligatorio'; end if;
  if p_estado = 'asignado' then raise exception 'Asignado solo se obtiene con un acta de entrega firmada'; end if;
  if p_estado = 'de_baja' and not es_admin then raise exception 'Solo el Administrador puede dar de baja equipos'; end if;
  select * into e from public.equipos where id = p_equipo and owner_id = public.my_owner_id() for update;
  if not found then raise exception 'Equipo no encontrado'; end if;
  perform app_private.proveedor_valido(p_proveedor,e.owner_id);
  if e.estado = 'de_baja' then raise exception 'El equipo ya está dado de baja'; end if;
  if e.estado = 'asignado' and p_estado <> 'en_reparacion' and not es_admin then
    raise exception 'El equipo está asignado; realice primero el acta de devolución';
  end if;
  if p_proveedor is not null then
    select nombre into pn from public.proveedores where id = p_proveedor and owner_id = e.owner_id;
  end if;

  det_hist := 'Motivo: ' || p_motivo || coalesce(' · Proveedor de servicio: ' || pn, '');
  if p_estado = 'de_baja' and p_documento_baja is not null then
    det_hist := det_hist || ' · Soporte de baja adjunto';
  end if;

  perform set_config('app.estado_ok', '1', true);
  perform set_config('app.hist_evento', p_estado::text, true);
  perform set_config('app.hist_detalle', det_hist, true);
  update public.equipos set
    estado = p_estado,
    prestamo_hasta = case when p_estado='en_reparacion' then e.prestamo_hasta else null end,
    empleado_id = case when p_estado = 'en_reparacion' then e.empleado_id else null end,
    reparacion_proveedor_id = case when p_estado = 'en_reparacion' and pn is not null then p_proveedor else null end,
    reparacion_inicio = case when p_estado = 'en_reparacion' then now() else null end,
    baja_documento_path = case when p_estado = 'de_baja' and p_documento_baja is not null then p_documento_baja else e.baja_documento_path end
  where id = p_equipo;

  if p_estado = 'en_reparacion' then
    insert into public.reparaciones(equipo_id, proveedor_id, owner_id)
    values (p_equipo, case when pn is not null then p_proveedor end, e.owner_id);
  elsif e.estado = 'en_reparacion' then
    update public.reparaciones set fin = now() where equipo_id = p_equipo and fin is null;
  end if;
  perform set_config('app.estado_ok', '', true);
  perform set_config('app.hist_evento', '', true);
  perform set_config('app.hist_detalle', '', true);
end $$;
create or replace function public.finalizar_reparacion(p_equipo uuid, p_devolver boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if not public.has_permiso(auth.uid(), 'equipos_editar') then raise exception 'Sin permiso'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into e from public.equipos where id = p_equipo and owner_id=public.my_owner_id() for update;
  if not found then raise exception 'Equipo no encontrado'; end if;
  if p_devolver and not exists(select 1 from public.empleados where id=e.empleado_id and activo and owner_id=e.owner_id) then raise exception 'Empleado inactivo o inválido'; end if;
  if e.estado <> 'en_reparacion' then raise exception 'El equipo no está en reparación'; end if;
  if p_devolver and e.empleado_id is null then raise exception 'El equipo no tiene empleado ligado; déjelo disponible'; end if;
  perform set_config('app.estado_ok', '1', true);
  perform set_config('app.hist_evento', case when p_devolver then 'asignado' else 'disponible' end, true);
  perform set_config('app.hist_detalle', 'Fin de reparación' || case when p_devolver then ' (devuelto al empleado)' else '' end || '. Motivo: ' || p_motivo, true);
  if p_devolver then
    update public.equipos set estado = 'asignado', reparacion_proveedor_id = null, reparacion_inicio = null where id = p_equipo;
  else
    update public.equipos set estado = 'disponible', empleado_id = null, prestamo_hasta = null, reparacion_proveedor_id = null, reparacion_inicio = null where id = p_equipo;
  end if;
  update public.reparaciones set fin = now() where equipo_id = p_equipo and fin is null;
  perform set_config('app.estado_ok', '', true);
  perform set_config('app.hist_evento', '', true);
  perform set_config('app.hist_detalle', '', true);
end $$;
create or replace function public.anular_acta(p_acta uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(), 'admin') and public.is_active(auth.uid())) then
    raise exception 'Solo el Administrador puede anular actas';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  perform 1 from public.actas where id=p_acta and owner_id=public.my_owner_id() for update;
  if not found then raise exception 'Acta no encontrada'; end if;
  if exists(select 1 from public.actas where id=p_acta and estado='anulada') then return; end if;
  update public.actas set
    estado = 'anulada',
    anulada_motivo = p_motivo,
    anulada_por = auth.uid(),
    anulada_at = now()
  where id = p_acta and estado <> 'anulada';
  update public.tokens_firma set used_at = now() where acta_id = p_acta and used_at is null;
  insert into public.equipo_historial(equipo_id, evento, detalle, acta_id)
    select equipo_id, 'acta_anulada', 'Motivo: ' || p_motivo, p_acta from public.acta_items where acta_id = p_acta;
end $$;
create or replace function public.recibir_pedido_linea(
  p_linea uuid,
  p_seriales text[],
  p_sin_serial integer,
  p_marca uuid,
  p_sede uuid,
  p_modelo text,
  p_valor numeric,
  p_factura text,
  p_garantia date,
  p_activos text[] default null,
  p_nombres text[] default null
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l record;
  p record;
  n integer := 0;
  prov text;
  pend integer;
  k integer;
begin
  if not public.has_permiso(auth.uid(), 'reabastecimiento_gestionar') then
    raise exception 'Sin permiso';
  end if;
  if p_sin_serial is null or p_sin_serial<0 then raise exception 'Cantidad sin serial inválida'; end if;
  if p_valor<0 then raise exception 'Valor inválido'; end if;
  select * into l from pedido_lineas where id = p_linea and owner_id = public.my_owner_id() for update;
  if not found then raise exception 'Línea no encontrada'; end if;
  select * into p from pedidos_compra where id = l.pedido_id and owner_id=public.my_owner_id() for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  perform app_private.catalogo_valido(p_marca,p.owner_id,'marca');
  perform app_private.catalogo_valido(p_sede,p.owner_id,'sede');
  if p.estado not in ('pedido', 'parcial') then raise exception 'El pedido debe estar en estado Pedido realizado'; end if;
  select nombre into prov from proveedores where id = p.proveedor_id;
  pend := l.cantidad - l.recibida;
  if coalesce(array_length(p_seriales, 1), 0) + coalesce(p_sin_serial, 0) = 0 then raise exception 'Nada para recibir'; end if;
  if coalesce(array_length(p_seriales, 1), 0) + coalesce(p_sin_serial, 0) > pend then raise exception 'Supera lo pendiente (%)', pend; end if;
  for k in 1..coalesce(array_length(p_seriales, 1), 0) loop
    insert into equipos(tipo_id, marca_id, sede_id, modelo, serie, activo_fijo, nombre_equipo, proveedor_id, proveedor, valor_compra, factura_numero, garantia_fin, anio_compra, fecha_ingreso, estado, created_by, owner_id)
    values (
      l.tipo_id, p_marca, p_sede, nullif(trim(p_modelo), ''), upper(trim(p_seriales[k])),
      nullif(trim(p_activos[k]), ''), nullif(trim(p_nombres[k]), ''),
      p.proveedor_id, prov, p_valor, nullif(trim(p_factura), ''), p_garantia,
      extract(year from now())::int, current_date, 'disponible', auth.uid(), p.owner_id
    );
    n := n + 1;
  end loop;
  for i in 1..coalesce(p_sin_serial, 0) loop
    insert into equipos(tipo_id, marca_id, sede_id, modelo, serie, proveedor_id, proveedor, valor_compra, factura_numero, garantia_fin, anio_compra, fecha_ingreso, estado, created_by, owner_id)
    values (
      l.tipo_id, p_marca, p_sede, nullif(trim(p_modelo), ''), '',
      p.proveedor_id, prov, p_valor, nullif(trim(p_factura), ''), p_garantia,
      extract(year from now())::int, current_date, 'disponible', auth.uid(), p.owner_id
    );
    n := n + 1;
  end loop;
  perform set_config('app.recibiendo_pedido','1',true);
  update pedido_lineas set recibida = recibida + n where id = l.id;
  perform set_config('app.recibiendo_pedido','',true);
  if exists (select 1 from articulo_proveedores where tipo_id = l.tipo_id and proveedor_id = p.proveedor_id) then
    update articulo_proveedores set ultima_compra = current_date, ultimo_precio = coalesce(p_valor, ultimo_precio)
    where tipo_id = l.tipo_id and proveedor_id = p.proveedor_id;
  else
    insert into articulo_proveedores(tipo_id, proveedor_id, ultima_compra, ultimo_precio, owner_id)
    values (l.tipo_id, p.proveedor_id, current_date, p_valor, p.owner_id);
  end if;
  if not exists (select 1 from pedido_lineas where pedido_id = p.id and recibida < cantidad) then
    update pedidos_compra set estado = 'recibido', cerrado_at = now() where id = p.id;
  else
    update pedidos_compra set estado = 'parcial' where id = p.id;
  end if;
  return n;
end $$;
create or replace function public.actas_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'firmada' and old.estado = 'pendiente' then
    perform set_config('app.estado_ok', '1', true);
    perform set_config('app.acta_id', new.id::text, true);
    perform set_config('app.hist_evento', new.tipo::text, true);
    perform set_config(
      'app.hist_detalle',
      'Acta #' || new.numero || ' firmada (' || coalesce(new.firma_medio, '') || ')' ||
      case when new.es_prestamo then ' · Préstamo temporal hasta ' || coalesce(new.prestamo_hasta::text, '—') else '' end,
      true
    );
    update public.equipos set
      estado = 'asignado',
      reparacion_inicio=null, reparacion_proveedor_id=null,
      empleado_id = new.empleado_id,
      prestamo_hasta = case when new.es_prestamo then coalesce(new.prestamo_hasta, current_date + 7) else null end
    where id in (select equipo_id from public.acta_items where acta_id = new.id and direccion = 'entrega');

    update public.equipos e set
      estado = i.estado_destino::equipo_estado,
      empleado_id = null,
      prestamo_hasta = null,
      reparacion_inicio = case when i.estado_destino = 'en_reparacion' then now() else null end,
      reparacion_proveedor_id = null
    from public.acta_items i
    where i.acta_id = new.id and i.direccion = 'devolucion' and e.id = i.equipo_id;

    update public.reparaciones set fin=now() where fin is null and equipo_id in (select equipo_id from public.acta_items where acta_id=new.id and direccion='devolucion');
    insert into public.reparaciones(equipo_id, owner_id)
      select i.equipo_id, new.owner_id
      from public.acta_items i
      where i.acta_id = new.id and i.direccion = 'devolucion' and i.estado_destino = 'en_reparacion';

    perform set_config('app.estado_ok', '', true);
    perform set_config('app.acta_id', '', true);
    perform set_config('app.hist_evento', '', true);
    perform set_config('app.hist_detalle', '', true);
  end if;
  return new;
end $$;

create or replace function public.certificar_equipos(p_cert uuid, p_faltantes uuid[], p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare
  emp public.empleados;
  c public.certificaciones;
  todos uuid[];
begin
  select * into emp from public.empleados where id = public.my_empleado_id();
  if not found then raise exception 'Solo empleados pueden certificar'; end if;
  select * into c from public.certificaciones where id = p_cert and activa and fecha_limite>=current_date and owner_id = emp.owner_id;
  if not found then raise exception 'Campaña no disponible'; end if;
  select coalesce(array_agg(id), '{}') into todos
  from public.equipos
  where empleado_id = emp.id and estado in ('asignado', 'en_reparacion');
  insert into public.certificacion_respuestas(certificacion_id, empleado_id, equipos_ok, equipos_faltantes, comentario, owner_id)
  values (
    p_cert,
    emp.id,
    array(select unnest(todos) except select unnest(coalesce(p_faltantes, '{}'))),
    array(select unnest(coalesce(p_faltantes, '{}')) intersect select unnest(todos)),
    nullif(btrim(p_comentario), ''),
    emp.owner_id
  );
end $$;

create or replace function public.atender_falla(p_reporte uuid, p_estado text, p_respuesta text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.reportes_falla; e public.equipos;
begin
  if not public.has_permiso(auth.uid(), 'equipos_editar') then raise exception 'Sin permiso'; end if;
  if p_estado is null or p_estado not in ('atendido', 'descartado', 'en_reparacion') then raise exception 'Estado inválido'; end if;
  select * into r from public.reportes_falla where id = p_reporte and owner_id = public.my_owner_id() and estado = 'abierto' for update;
  if not found then raise exception 'Reporte no encontrado o ya cerrado'; end if;
  if p_estado='en_reparacion' then
    select * into e from public.equipos where id=r.equipo_id and owner_id=r.owner_id for update;
    if not found then raise exception 'Equipo no encontrado'; end if;
    if e.estado<>'en_reparacion' then perform public.cambiar_estado_equipo(e.id,'en_reparacion',coalesce(nullif(btrim(p_respuesta),''),'Atención de reporte de falla'),null,null); end if;
  end if;
  update public.reportes_falla set
    estado = p_estado,
    respuesta = nullif(btrim(p_respuesta), ''),
    atendido_por = auth.uid(),
    atendido_at = now()
  where id = p_reporte;
  insert into public.equipo_historial(equipo_id, evento, detalle, user_id)
  values (r.equipo_id, 'falla_' || p_estado, coalesce(nullif(btrim(p_respuesta), ''), 'Reporte cerrado'), auth.uid());
end $$;

create or replace function public.marcar_alistado(p_equipo uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if not public.has_permiso(auth.uid(), 'equipos_editar') then raise exception 'Sin permiso'; end if;
  select * into e from public.equipos where id = p_equipo and owner_id = public.my_owner_id() for update;
  if not found or e.estado::text <> 'en_alistamiento' then raise exception 'El equipo no está en alistamiento'; end if;
  perform set_config('app.estado_ok', '1', true);
  perform set_config('app.hist_evento', 'alistado', true);
  perform set_config('app.hist_detalle', 'Alistamiento terminado' || coalesce('. Nota: ' || nullif(btrim(p_nota), ''), ''), true);
  update public.equipos set estado = 'disponible' where id = p_equipo;
  perform set_config('app.estado_ok', '', true);
  perform set_config('app.hist_evento', '', true);
  perform set_config('app.hist_detalle', '', true);
end $$;
create or replace function public.reportar_falla(p_equipo uuid, p_descripcion text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.equipos;
  emp uuid := public.my_empleado_id();
begin
  if emp is null then raise exception 'Solo empleados pueden reportar fallas'; end if;
  if coalesce(btrim(p_descripcion), '') = '' then raise exception 'Describa la falla'; end if;
  select * into e from public.equipos where id = p_equipo and empleado_id = emp for update;
  if not found then raise exception 'El equipo no está a su cargo'; end if;
  if exists (select 1 from public.reportes_falla where equipo_id = p_equipo and estado = 'abierto') then
    raise exception 'Ya hay un reporte abierto para este equipo';
  end if;
  insert into public.reportes_falla(equipo_id, empleado_id, descripcion, owner_id)
  values (p_equipo, emp, left(btrim(p_descripcion), 1000), e.owner_id);
  insert into public.equipo_historial(equipo_id, evento, detalle, user_id)
  values (p_equipo, 'falla_reportada', 'Reporte del empleado: ' || left(btrim(p_descripcion), 300), auth.uid());
end $$;

-- Ninguna función recién creada conserva EXECUTE implícito para PUBLIC.
revoke execute on all functions in schema app_private from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon;
grant execute on function public.usuario_habilitado(uuid) to authenticated,service_role;
grant execute on function public.crear_acta(uuid,public.acta_tipo,jsonb,text,boolean,date,uuid),
  public.crear_pedido(uuid,jsonb,text,date,text),
  public.crear_prestamo_contingencia(uuid,uuid,text,date,uuid)
  to authenticated,service_role;
revoke execute on function public.reservar_firma(uuid,uuid,text),
  public.confirmar_firma(uuid,uuid,uuid,text,text,text,text,text,text),
  public.cancelar_firma(uuid,uuid),public.reservar_intento_pin(uuid),
  public.finalizar_intento_pin(uuid,uuid,boolean),public.reemplazar_permisos_usuario(uuid,text[],uuid)
  from authenticated;
grant execute on function public.reservar_firma(uuid,uuid,text),
  public.confirmar_firma(uuid,uuid,uuid,text,text,text,text,text,text),
  public.cancelar_firma(uuid,uuid),public.reservar_intento_pin(uuid),
  public.finalizar_intento_pin(uuid,uuid,boolean),public.reemplazar_permisos_usuario(uuid,text[],uuid)
  to service_role;

revoke all on all tables in schema app_private from public,anon,authenticated,service_role;
alter table app_private.equipo_reservas enable row level security;
alter table app_private.firma_reservas enable row level security;
alter table app_private.pin_reservas enable row level security;
revoke execute on function public.validar_referencias_ecosistema(),public.pedido_lineas_guardar(),public.documento_inmutable() from authenticated,service_role;
