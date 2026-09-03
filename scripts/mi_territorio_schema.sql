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
