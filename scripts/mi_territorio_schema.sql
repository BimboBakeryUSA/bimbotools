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
-- ============================================================================

-- Dueños de ruta (IBP). id = número de ruta, tal cual viene del reporte de
-- ventas (ej. "0150").
create table public.ibps (
  id text primary key,
  propietario text not null,
  created_at timestamptz not null default now()
);

comment on table public.ibps is 'Mi Territorio: dueños de ruta (IBP). id = número de ruta.';

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
-- registran — no tiene policy de insert propia.
create table public.tiendas_historial (
  id bigint generated always as identity primary key,
  tienda_id text not null references public.tiendas(id) on delete cascade,
  actor text not null check (actor in ('ibp', 'admin')),
  actor_nombre text,
  campo text not null,                    -- 'estatus' | 'frecuencia' | 'dias_visita' | 'reset'
  valor_anterior jsonb,
  valor_nuevo jsonb,
  creado_en timestamptz not null default now()
);

comment on table public.tiendas_historial is 'Mi Territorio: historial de cambios por tienda (quién cambió qué y cuándo) — solo visible en admin.html.';

create index tiendas_historial_tienda_id_idx on public.tiendas_historial (tienda_id, creado_en desc);

-- ----------------------------------------------------------------------------
-- RLS: lectura abierta (la app hoy no tiene login) para las cuatro tablas.
-- Escritura desde el navegador SOLO a través de las funciones de abajo
-- (set_tienda_estatus / set_tienda_frecuencia / set_tienda_dias /
-- set_tienda_reset) — nadie puede hacer UPDATE directo a tiendas, ibps,
-- ventas_semanales ni tiendas_historial con la llave pública. Así el
-- catálogo (nombre, dirección, ventas) solo lo toca un refresh administrado
-- (vía migración), y el único campo que se puede tocar desde el navegador
-- es el estatus/motivo/frecuencia/días de una tienda — siempre dejando
-- rastro en tiendas_historial de quién lo hizo (actor 'ibp' o 'admin').
-- ----------------------------------------------------------------------------

alter table public.ibps enable row level security;
alter table public.tiendas enable row level security;
alter table public.ventas_semanales enable row level security;
alter table public.tiendas_historial enable row level security;

create policy "lectura publica ibps" on public.ibps for select using (true);
create policy "lectura publica tiendas" on public.tiendas for select using (true);
create policy "lectura publica ventas_semanales" on public.ventas_semanales for select using (true);
create policy "lectura publica tiendas_historial" on public.tiendas_historial for select using (true);

-- Sin policies de insert/update/delete para anon/authenticated: quedan
-- bloqueadas por RLS salvo para el rol que aplica las migraciones.

-- p_actor: 'ibp' (default, lo usa mi-territorio.html) o 'admin' (lo usa
-- admin.html, mandando también p_actor_nombre para saber quién fue).
create or replace function public.set_tienda_estatus(
  p_tienda_id text,
  p_estatus text,
  p_motivo text default null,
  p_actor text default 'ibp',
  p_actor_nombre text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior record;
  v_nuevo_motivo text;
begin
  if p_estatus not in ('activa', 'inactiva') then
    raise exception 'estatus inválido: %', p_estatus;
  end if;
  if p_actor not in ('ibp', 'admin') then
    raise exception 'actor inválido: %', p_actor;
  end if;

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
    p_tienda_id, p_actor, p_actor_nombre, 'estatus',
    jsonb_build_object('estatus', v_anterior.estatus, 'motivo', v_anterior.motivo),
    jsonb_build_object('estatus', p_estatus, 'motivo', v_nuevo_motivo)
  );
end;
$$;

create or replace function public.set_tienda_frecuencia(
  p_tienda_id text,
  p_frecuencia text,
  p_actor text default 'ibp',
  p_actor_nombre text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior text;
begin
  if p_frecuencia not in ('semanal', '2x_semana', 'quincenal', 'pedido') then
    raise exception 'frecuencia inválida: %', p_frecuencia;
  end if;
  if p_actor not in ('ibp', 'admin') then
    raise exception 'actor inválido: %', p_actor;
  end if;

  select frecuencia into v_anterior from public.tiendas where id = p_tienda_id;
  if not found then
    raise exception 'tienda no encontrada: %', p_tienda_id;
  end if;

  update public.tiendas
  set frecuencia = p_frecuencia,
      revisado_en = now()
  where id = p_tienda_id;

  insert into public.tiendas_historial (tienda_id, actor, actor_nombre, campo, valor_anterior, valor_nuevo)
  values (p_tienda_id, p_actor, p_actor_nombre, 'frecuencia', to_jsonb(v_anterior), to_jsonb(p_frecuencia));
end;
$$;

create or replace function public.set_tienda_dias(
  p_tienda_id text,
  p_dias text[],
  p_actor text default 'ibp',
  p_actor_nombre text default null
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
begin
  foreach dia in array p_dias loop
    if not (dia = any(dias_validos)) then
      raise exception 'día inválido: %', dia;
    end if;
  end loop;
  if p_actor not in ('ibp', 'admin') then
    raise exception 'actor inválido: %', p_actor;
  end if;

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
  values (p_tienda_id, p_actor, p_actor_nombre, 'dias_visita', to_jsonb(v_anterior), to_jsonb(v_nuevo));
end;
$$;

-- Reinicio total de una tienda — pensado para uso del admin (pruebas, o
-- deshacer un error del IBP). La deja "sin revisar", como si nunca la
-- hubieran tocado (estatus/motivo/frecuencia en null, dias_visita vacío).
-- Solo admin: no recibe p_actor, siempre registra el cambio como 'admin'.
create or replace function public.set_tienda_reset(
  p_tienda_id text,
  p_actor_nombre text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior record;
begin
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
    p_tienda_id, 'admin', p_actor_nombre, 'reset',
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

revoke all on function public.set_tienda_estatus(text, text, text, text, text) from public;
revoke all on function public.set_tienda_frecuencia(text, text, text, text) from public;
revoke all on function public.set_tienda_dias(text, text[], text, text) from public;
revoke all on function public.set_tienda_reset(text, text) from public;
grant execute on function public.set_tienda_estatus(text, text, text, text, text) to anon, authenticated;
grant execute on function public.set_tienda_frecuencia(text, text, text, text) to anon, authenticated;
grant execute on function public.set_tienda_dias(text, text[], text, text) to anon, authenticated;
grant execute on function public.set_tienda_reset(text, text) to anon, authenticated;
