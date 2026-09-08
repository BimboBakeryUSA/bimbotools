-- ============================================================================
-- Mi Territorio (Bimbo Tools) — esquema de base de datos.
-- ----------------------------------------------------------------------------
-- Vive hoy dentro del proyecto Supabase "bimbo-inventory-pro" (se reusó ese
-- proyecto porque el free tier de la organización tiene tope de 2 proyectos
-- activos — ver README, sección "Base de datos"). Tablas con nombre propio
-- para no chocar con las de esa otra app.
--
-- Esto es exactamente lo que se aplicó al proyecto real vía las
-- herramientas de Supabase — se deja aquí como referencia y por si algún
-- día se separa a su propio proyecto (migrar = correr esto ahí y copiar los
-- datos).
--
-- Autenticación: Mi Territorio NO tiene su propio sistema de usuarios —
-- reusa `auth.users` + `public.profiles` (role: admin/corporativo/route,
-- route_code) que ya trae bimbo-inventory-pro, y las funciones
-- current_user_role()/current_user_route_code() que ya usan sus otras
-- tablas (products, scan_sessions). Ese esquema NO se repite aquí porque no
-- es de Mi Territorio — ver el proyecto real si hace falta consultarlo.
-- ============================================================================

-- Dueños de ruta (IBP). id = número de ruta, tal cual viene del reporte de
-- ventas (ej. "0150"). El token es la entrada directa del IBP (ver
-- reclamar_ruta_por_token más abajo) — no adivinable, único por ruta.
create table public.ibps (
  id text primary key,
  propietario text not null,
  token text not null unique default encode(gen_random_bytes(20), 'hex'),
  token_primer_uso timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.ibps is 'Mi Territorio: dueños de ruta (IBP). id = número de ruta.';
comment on column public.ibps.token is 'Mi Territorio: token no adivinable para entrada directa del IBP (mi-territorio.html?t=). Válido 7 días desde el primer uso (token_primer_uso) para sesiones anónimas repetidas; después de eso, solo login real.';

-- Catálogo de tiendas por ruta + la decisión del IBP sobre cada una.
-- estatus/motivo/frecuencia/revisado_en son NULL hasta que el IBP la revisa
-- ("sin revisar" en la UI = estatus is null). Solo dos estatus posibles:
-- "activa" e "inactiva" — no hay un tercer estatus de "pedir borrado"; pedir
-- que se elimine una tienda es simplemente marcarla inactiva con el motivo
-- explicando por qué (ver README).
create table public.tiendas (
  id text primary key,                    -- código de tienda (Central Store)
  ibp_id text not null references public.ibps(id) on delete cascade,
  nombre text not null default '',
  direccion text not null default '',
  ciudad text not null default '',
  estado_us text not null default '',     -- estado de EE.UU. (VA, MD...), no confundir con "estatus"
  zip text not null default '',
  tipo_cuenta text not null default '',
  productos integer not null default 0,   -- productos Bimbo distintos vendidos en el periodo del reporte
  estatus text check (estatus in ('activa', 'inactiva')),
  motivo text,
  frecuencia text check (frecuencia in ('semanal', '2x_semana', 'quincenal', 'pedido')),
  dias_visita text[] not null default '{}', -- lunes..sabado, domingo no se pauta
  revisado_en timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.tiendas is 'Mi Territorio: catálogo de tiendas + decisión del IBP (activa/inactiva, motivo, frecuencia).';

create index tiendas_ibp_id_idx on public.tiendas (ibp_id);

-- Ventas semanales por tienda (histórico del reporte "12 semanas"), para
-- calcular hace cuánto no tiene actividad y mostrar el sparkline. Solo se
-- guardan semanas con unidades != 0 — una semana ausente se interpreta como 0
-- (ver SEMANAS_ETIQUETAS en js/depuracion.js, que arma el arreglo completo).
create table public.ventas_semanales (
  id bigint generated always as identity primary key,
  tienda_id text not null references public.tiendas(id) on delete cascade,
  semana text not null,                   -- ej. "24/2026"
  unidades integer not null default 0,
  unique (tienda_id, semana)
);

comment on table public.ventas_semanales is 'Mi Territorio: unidades vendidas por tienda y semana (histórico del reporte de ventas).';

create index ventas_semanales_tienda_id_idx on public.ventas_semanales (tienda_id);

-- Historial de cambios por tienda (quién cambió qué y cuándo) — solo se
-- muestra en admin.html (el IBP no lo ve). Se escribe únicamente desde las
-- funciones SECURITY DEFINER de abajo, como parte del mismo cambio que
-- registran — no tiene policy de insert propia. actor usa el mismo
-- vocabulario que profiles.role (route/admin/corporativo), ya derivado del
-- lado del servidor a partir de la sesión real (no lo manda el navegador).
create table public.tiendas_historial (
  id bigint generated always as identity primary key,
  tienda_id text not null references public.tiendas(id) on delete cascade,
  actor text not null check (actor in ('route', 'admin', 'corporativo')),
  actor_nombre text,
  campo text not null,                    -- 'estatus' | 'frecuencia' | 'dias_visita' | 'reset'
  valor_anterior jsonb,
  valor_nuevo jsonb,
  creado_en timestamptz not null default now()
);

comment on table public.tiendas_historial is 'Mi Territorio: historial de cambios por tienda (quién cambió qué y cuándo) — solo visible en admin.html.';

create index tiendas_historial_tienda_id_idx on public.tiendas_historial (tienda_id, creado_en desc);

-- ----------------------------------------------------------------------------
-- RLS: nada de lectura pública. Un "route" (profiles.role) solo ve las filas
-- de su propia ruta (profiles.route_code); admin/corporativo ven todo; sin
-- sesión, RLS bloquea todo (current_user_role() da null). El historial de
-- cambios es exclusivo de admin/corporativo, el IBP no lo ve.
--
-- Escritura: sigue sin haber policy de insert/update/delete para nadie —
-- todo pasa por las funciones SECURITY DEFINER de abajo, que validan del
-- lado del servidor que un "route" solo toque tiendas de su propia ruta.
-- ----------------------------------------------------------------------------

alter table public.ibps enable row level security;
alter table public.tiendas enable row level security;
alter table public.ventas_semanales enable row level security;
alter table public.tiendas_historial enable row level security;

create policy "ibps_select" on public.ibps for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
  or id = public.current_user_route_code()
);

create policy "tiendas_select" on public.tiendas for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
  or ibp_id = public.current_user_route_code()
);

create policy "ventas_semanales_select" on public.ventas_semanales for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
  or exists (
    select 1 from public.tiendas t
    where t.id = ventas_semanales.tienda_id
      and t.ibp_id = public.current_user_route_code()
  )
);

create policy "tiendas_historial_select" on public.tiendas_historial for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
);

-- ----------------------------------------------------------------------------
-- Entrada directa por token — crea/actualiza el profile de la sesión actual
-- (normalmente una sesión anónima recién creada con signInAnonymously())
-- con role=route + route_code de esa ruta. Válido 7 días desde el primer
-- uso del token; después de eso, exige login real. Ver README, sección
-- "Autenticación".
-- ----------------------------------------------------------------------------

create or replace function public.reclamar_ruta_por_token(
  p_token text,
  p_email text default null
)
returns table (ruta text, propietario text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ibp_id text;
  v_ibp_propietario text;
  v_ibp_primer_uso timestamptz;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'se requiere una sesión para reclamar una ruta';
  end if;

  select i.id, i.propietario, i.token_primer_uso
    into v_ibp_id, v_ibp_propietario, v_ibp_primer_uso
  from public.ibps i
  where i.token = p_token;

  if not found then
    raise exception 'token inválido';
  end if;

  if v_ibp_primer_uso is null then
    update public.ibps set token_primer_uso = now() where id = v_ibp_id;
  elsif v_ibp_primer_uso < now() - interval '7 days' then
    raise exception 'este enlace ya venció, inicia sesión con tu cuenta';
  end if;

  insert into public.profiles (id, role, route_code, estado, email)
  values (v_uid, 'route', v_ibp_id, 'activo', p_email)
  on conflict (id) do update
    set role = 'route',
        route_code = v_ibp_id,
        estado = 'activo',
        email = coalesce(excluded.email, public.profiles.email);

  return query select v_ibp_id, v_ibp_propietario;
end;
$$;

revoke all on function public.reclamar_ruta_por_token(text, text) from public;
grant execute on function public.reclamar_ruta_por_token(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Escrituras — el actor/nombre para tiendas_historial ya NO lo manda el
-- navegador: se deriva de la sesión real (profiles), y se valida que un
-- "route" solo pueda tocar tiendas de su propia ruta.
-- ----------------------------------------------------------------------------

-- Común a las 4 funciones de abajo: valida el acceso de quien llama sobre
-- una tienda puntual y devuelve (rol, nombre) para dejar en el historial.
create or replace function public._verificar_acceso_tienda(p_tienda_id text)
returns table (v_actor public.user_role, v_nombre text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_route text := public.current_user_route_code();
begin
  if v_role is null then
    raise exception 'no autenticado';
  end if;

  if v_role = 'route' then
    if not exists (select 1 from public.tiendas where id = p_tienda_id and ibp_id = v_route) then
      raise exception 'no tienes acceso a esta tienda';
    end if;
  elsif v_role not in ('admin', 'corporativo') then
    raise exception 'rol no autorizado';
  end if;

  return query
    select v_role, coalesce(p.nombre, p.email, v_role::text) from public.profiles p where p.id = auth.uid();
end;
$$;

revoke all on function public._verificar_acceso_tienda(text) from public;

create or replace function public.set_tienda_estatus(
  p_tienda_id text,
  p_estatus text,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior record;
  v_nuevo_motivo text;
  v_acceso record;
begin
  if p_estatus not in ('activa', 'inactiva') then
    raise exception 'estatus inválido: %', p_estatus;
  end if;

  select * into v_acceso from public._verificar_acceso_tienda(p_tienda_id);

  select estatus, motivo into v_anterior from public.tiendas where id = p_tienda_id;
  if not found then
    raise exception 'tienda no encontrada: %', p_tienda_id;
  end if;

  v_nuevo_motivo := case when p_estatus = 'activa' then null else p_motivo end;

  update public.tiendas
  set estatus = p_estatus,
      motivo = v_nuevo_motivo,
      revisado_en = now()
  where id = p_tienda_id;

  insert into public.tiendas_historial (tienda_id, actor, actor_nombre, campo, valor_anterior, valor_nuevo)
  values (
    p_tienda_id, v_acceso.v_actor::text, v_acceso.v_nombre, 'estatus',
    jsonb_build_object('estatus', v_anterior.estatus, 'motivo', v_anterior.motivo),
    jsonb_build_object('estatus', p_estatus, 'motivo', v_nuevo_motivo)
  );
end;
$$;

create or replace function public.set_tienda_frecuencia(
  p_tienda_id text,
  p_frecuencia text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior text;
  v_acceso record;
begin
  if p_frecuencia not in ('semanal', '2x_semana', 'quincenal', 'pedido') then
    raise exception 'frecuencia inválida: %', p_frecuencia;
  end if;

  select * into v_acceso from public._verificar_acceso_tienda(p_tienda_id);

  select frecuencia into v_anterior from public.tiendas where id = p_tienda_id;
  if not found then
    raise exception 'tienda no encontrada: %', p_tienda_id;
  end if;

  update public.tiendas
  set frecuencia = p_frecuencia,
      revisado_en = now()
  where id = p_tienda_id;

  insert into public.tiendas_historial (tienda_id, actor, actor_nombre, campo, valor_anterior, valor_nuevo)
  values (p_tienda_id, v_acceso.v_actor::text, v_acceso.v_nombre, 'frecuencia', to_jsonb(v_anterior), to_jsonb(p_frecuencia));
end;
$$;

create or replace function public.set_tienda_dias(
  p_tienda_id text,
  p_dias text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dias_validos text[] := array['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  dia text;
  v_anterior text[];
  v_nuevo text[];
  v_acceso record;
begin
  foreach dia in array p_dias loop
    if not (dia = any(dias_validos)) then
      raise exception 'día inválido: %', dia;
    end if;
  end loop;

  select * into v_acceso from public._verificar_acceso_tienda(p_tienda_id);

  select dias_visita into v_anterior from public.tiendas where id = p_tienda_id;
  if not found then
    raise exception 'tienda no encontrada: %', p_tienda_id;
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_nuevo from unnest(p_dias) as d;

  update public.tiendas
  set dias_visita = v_nuevo,
      revisado_en = now()
  where id = p_tienda_id;

  insert into public.tiendas_historial (tienda_id, actor, actor_nombre, campo, valor_anterior, valor_nuevo)
  values (p_tienda_id, v_acceso.v_actor::text, v_acceso.v_nombre, 'dias_visita', to_jsonb(v_anterior), to_jsonb(v_nuevo));
end;
$$;

-- Reinicio total de una tienda — solo admin/corporativo (nunca route).
-- Pensado para pruebas del admin, o para deshacer un error del IBP. La deja
-- "sin revisar", como si nunca la hubieran tocado.
create or replace function public.set_tienda_reset(
  p_tienda_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior record;
  v_role public.user_role := public.current_user_role();
  v_nombre text;
begin
  if v_role is null or v_role not in ('admin', 'corporativo') then
    raise exception 'solo admin/corporativo puede reiniciar una tienda';
  end if;

  select coalesce(nombre, email, v_role::text) into v_nombre from public.profiles where id = auth.uid();

  select estatus, motivo, frecuencia, dias_visita into v_anterior
  from public.tiendas where id = p_tienda_id;

  if not found then
    raise exception 'tienda no encontrada: %', p_tienda_id;
  end if;

  update public.tiendas
  set estatus = null,
      motivo = null,
      frecuencia = null,
      dias_visita = '{}',
      revisado_en = null
  where id = p_tienda_id;

  insert into public.tiendas_historial (tienda_id, actor, actor_nombre, campo, valor_anterior, valor_nuevo)
  values (
    p_tienda_id, v_role::text, v_nombre, 'reset',
    jsonb_build_object(
      'estatus', v_anterior.estatus,
      'motivo', v_anterior.motivo,
      'frecuencia', v_anterior.frecuencia,
      'dias_visita', v_anterior.dias_visita
    ),
    null
  );
end;
$$;

revoke all on function public.set_tienda_estatus(text, text, text) from public;
revoke all on function public.set_tienda_frecuencia(text, text) from public;
revoke all on function public.set_tienda_dias(text, text[]) from public;
revoke all on function public.set_tienda_reset(text) from public;
grant execute on function public.set_tienda_estatus(text, text, text) to anon, authenticated;
grant execute on function public.set_tienda_frecuencia(text, text) to anon, authenticated;
grant execute on function public.set_tienda_dias(text, text[]) to anon, authenticated;
grant execute on function public.set_tienda_reset(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- NOTA: a partir de aquí, lo que sigue documenta migraciones aplicadas
-- directamente en producción (obfikwhukpzelsghowcq) vía mcp__Supabase__
-- apply_migration, que no se habían vuelto a mirror-ear en este archivo:
-- - ibps.manager + semanas_recientes() + grants de columna para que
--   admin/corporativo carguen catálogo/ventas directo desde admin.html
--   ("Actualizar catálogo") sin tocar estatus/motivo/frecuencia/dias_visita.
-- - visitas + mensajes, abajo.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Visitas: marca real de que una tienda se visitó en una fecha (agenda del
-- IBP) — distinto de dias_visita (el plan semanal). El propio IBP marca/
-- desmarca la suya vía las funciones de abajo; admin.html puede cargar un
-- archivo con las ya visitadas (INSERT directo, mismo patrón de columnas +
-- RLS que la carga de catálogo).
-- ----------------------------------------------------------------------------

create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  tienda_id text not null references public.tiendas(id) on delete cascade,
  fecha date not null,
  visitada_en timestamptz not null default now(),
  marcado_por uuid references auth.users(id),
  origen text not null default 'ibp' check (origen in ('ibp', 'admin_carga')),
  unique (tienda_id, fecha)
);

comment on table public.visitas is 'Mi Territorio: marca de que una tienda se visitó de verdad en una fecha — separado de dias_visita (el plan).';

create index visitas_tienda_id_idx on public.visitas (tienda_id);
create index visitas_fecha_idx on public.visitas (fecha);

alter table public.visitas enable row level security;

create policy "visitas_select" on public.visitas for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
  or exists (
    select 1 from public.tiendas t
    where t.id = visitas.tienda_id
      and t.ibp_id = public.current_user_route_code()
  )
);

-- Carga masiva directa: solo admin/corporativo (el propio IBP marca su
-- visita vía marcar_tienda_visitada, abajo).
create policy "visitas_insert_admin" on public.visitas for insert
with check (public.current_user_role() = any (array['admin','corporativo']::public.user_role[]));

create policy "visitas_update_admin" on public.visitas for update
using (public.current_user_role() = any (array['admin','corporativo']::public.user_role[]));

create policy "visitas_delete_admin" on public.visitas for delete
using (public.current_user_role() = any (array['admin','corporativo']::public.user_role[]));

grant select, insert, update, delete on public.visitas to authenticated;

create or replace function public.marcar_tienda_visitada(
  p_tienda_id text,
  p_fecha date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acceso record;
begin
  select * into v_acceso from public._verificar_acceso_tienda(p_tienda_id);

  insert into public.visitas (tienda_id, fecha, marcado_por, origen, visitada_en)
  values (p_tienda_id, p_fecha, auth.uid(), 'ibp', now())
  on conflict (tienda_id, fecha) do update
    set visitada_en = now(), marcado_por = auth.uid(), origen = 'ibp';
end;
$$;

create or replace function public.desmarcar_tienda_visitada(
  p_tienda_id text,
  p_fecha date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acceso record;
begin
  select * into v_acceso from public._verificar_acceso_tienda(p_tienda_id);
  delete from public.visitas where tienda_id = p_tienda_id and fecha = p_fecha;
end;
$$;

revoke all on function public.marcar_tienda_visitada(text, date) from public;
revoke all on function public.desmarcar_tienda_visitada(text, date) from public;
grant execute on function public.marcar_tienda_visitada(text, date) to anon, authenticated;
grant execute on function public.desmarcar_tienda_visitada(text, date) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Mensajes: admin/corporativo -> una ruta puntual. El IBP los ve (y los
-- marca leídos) en su agenda, con aviso emergente si hay alguno sin leer.
-- ----------------------------------------------------------------------------

create table public.mensajes (
  id uuid primary key default gen_random_uuid(),
  ruta_id text not null references public.ibps(id) on delete cascade,
  texto text not null,
  creado_por uuid references auth.users(id),
  creado_por_nombre text,
  creado_en timestamptz not null default now(),
  leido_en timestamptz
);

comment on table public.mensajes is 'Mi Territorio: mensajes de admin/corporativo a una ruta puntual, con aviso emergente en la agenda del IBP.';

create index mensajes_ruta_id_idx on public.mensajes (ruta_id, creado_en desc);

alter table public.mensajes enable row level security;

create policy "mensajes_select" on public.mensajes for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
  or ruta_id = public.current_user_route_code()
);

create policy "mensajes_insert_admin" on public.mensajes for insert
with check (public.current_user_role() = any (array['admin','corporativo']::public.user_role[]));

-- El IBP solo puede tocar leido_en de sus propios mensajes (columna
-- otorgada abajo) — no puede editar el texto ni mensajes de otra ruta.
create policy "mensajes_update_leido" on public.mensajes for update
using (ruta_id = public.current_user_route_code())
with check (ruta_id = public.current_user_route_code());

grant select, insert on public.mensajes to authenticated;
grant update (leido_en) on public.mensajes to authenticated;

-- ----------------------------------------------------------------------------
-- Notificaciones push (Web Push) para mensajes admin -> IBP. Guarda la
-- suscripción del navegador de cada ruta; al insertarse un mensaje, un
-- trigger llama automáticamente a la Edge Function "enviar-push" (vía
-- pg_net) que le manda la notificación real al dispositivo — probado en
-- Android/Chrome (los IBP usan handhelds Honeywell); en iPhone Safari solo
-- funciona si la página se agregó a la pantalla de inicio.
-- ----------------------------------------------------------------------------

create extension if not exists pg_net;

create table public.push_subscripciones (
  id uuid primary key default gen_random_uuid(),
  ruta_id text not null references public.ibps(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);

comment on table public.push_subscripciones is 'Mi Territorio: suscripciones de Web Push por ruta, para el aviso emergente de mensajes cuando la app no está abierta.';

create index push_subscripciones_ruta_id_idx on public.push_subscripciones (ruta_id);

alter table public.push_subscripciones enable row level security;

create policy "push_subs_select" on public.push_subscripciones for select
using (
  public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
  or ruta_id = public.current_user_route_code()
);

create policy "push_subs_insert" on public.push_subscripciones for insert
with check (ruta_id = public.current_user_route_code());

create policy "push_subs_delete" on public.push_subscripciones for delete
using (
  ruta_id = public.current_user_route_code()
  or public.current_user_role() = any (array['admin','corporativo']::public.user_role[])
);

grant select, insert, delete on public.push_subscripciones to authenticated;

alter table public.push_subscripciones add constraint push_subscripciones_endpoint_key2 unique (endpoint, ruta_id);

-- Trigger: al insertar un mensaje, llama a la Edge Function enviar-push.
-- Fire-and-forget (pg_net es asíncrono) — si falla, el mensaje igual se
-- guarda y se ve en la agenda/polling; el push es un plus, no la fuente de
-- verdad. La llave publicable (Bearer) es la misma que usa el navegador —
-- no es secreta.
create or replace function public._notificar_mensaje_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://obfikwhukpzelsghowcq.supabase.co/functions/v1/enviar-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_-qW3XyldNJgpOk6BLReC3A_HIyZHrHM'
    ),
    body := jsonb_build_object('ruta_id', NEW.ruta_id, 'texto', NEW.texto, 'mensaje_id', NEW.id)
  );
  return NEW;
end;
$$;

create trigger mensajes_notificar_push
after insert on public.mensajes
for each row execute function public._notificar_mensaje_nuevo();

-- Usada por la Edge Function asignar-ruta -- adminClient.auth.admin.listUsers()
-- fallaba en este proyecto ("Database error finding users"), se busca la
-- cuenta directo por SQL en su lugar.
create or replace function public._buscar_usuario_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public._buscar_usuario_por_email(text) from public;
grant execute on function public._buscar_usuario_por_email(text) to service_role;
