-- ============================================================================
-- Calendario de feriados y semanas especiales (rutas.html → pestaña Feriados)
-- ----------------------------------------------------------------------------
-- Se corre en el SQL Editor del proyecto de la app (INVENTARIO), después de
-- rutas_schema.sql y pendientes_y_pruebas.sql. Se puede volver a correr.
--
--   rutas_dias_especiales  días sin ruta (feriados) o con ruta extra, para
--                          todas las rutas (ibp_id null) o solo una
--   rutas_plan_especial    el plan de una ruta en una semana especial. El plan
--                          A/B de siempre (rutas_plan) no se toca: pasada esa
--                          semana, la ruta vuelve sola a su plan normal.
--
-- También cambia las tiendas pendientes de Mi Territorio: los días sin ruta
-- no cuentan como días sin visita.
-- ============================================================================

create table if not exists public.rutas_dias_especiales (
  id bigint generated always as identity primary key,
  fecha date not null,
  nombre text,
  -- false = sin ruta ese día (Rts Off); true = sí hay ruta (día extra)
  trabaja boolean not null default false,
  -- null = todas las rutas; con valor = solo esa ruta (gana sobre la general)
  ibp_id text references public.ibps(id) on delete cascade,
  creado_en timestamptz not null default now()
);

create unique index if not exists rutas_dias_especiales_unico
  on public.rutas_dias_especiales (fecha, coalesce(ibp_id, ''));

comment on table public.rutas_dias_especiales is 'Feriados: días sin ruta (o con ruta extra) para todas las rutas o una sola.';

create table if not exists public.rutas_plan_especial (
  ibp_id text not null references public.ibps(id) on delete cascade,
  -- lunes de la semana especial
  semana date not null check (extract(isodow from semana) = 1),
  -- semana del plan normal de la que sale (A o B)
  base text not null check (base in ('A', 'B')),
  -- días con su orden: {"E1": ["<id tienda>", ...], ..., "E7": [...]} (1 = lunes)
  slots jsonb not null default '{}'::jsonb,
  -- días que el IBP carga en el warehouse esa semana
  wh_dias integer[] not null default '{}',
  actualizado_en timestamptz not null default now(),
  actualizado_por text,
  primary key (ibp_id, semana)
);

comment on table public.rutas_plan_especial is 'Plan de visitas de una ruta en una semana con feriados (no cambia el plan A/B).';

alter table public.rutas_dias_especiales enable row level security;
alter table public.rutas_plan_especial enable row level security;

-- El calendario lo leen todos los que entran a la app; lo cambian solo los
-- managers (los mismos del planificador).
drop policy if exists "dias_especiales_leer" on public.rutas_dias_especiales;
create policy "dias_especiales_leer" on public.rutas_dias_especiales for select
using (auth.uid() is not null);

drop policy if exists "dias_especiales_cambiar" on public.rutas_dias_especiales;
create policy "dias_especiales_cambiar" on public.rutas_dias_especiales for all
using (public.rutas_tiene_acceso()) with check (public.rutas_tiene_acceso());

drop policy if exists "plan_especial_acceso" on public.rutas_plan_especial;
create policy "plan_especial_acceso" on public.rutas_plan_especial for all
using (public.rutas_tiene_acceso()) with check (public.rutas_tiene_acceso());

grant select, insert, update, delete on public.rutas_dias_especiales, public.rutas_plan_especial to authenticated;

-- Feriados de fin de año 2026 (del calendario de rutas). Domingo no se pone:
-- ya es día sin ruta normal. Si ya existen, no se duplican.
insert into public.rutas_dias_especiales (fecha, nombre, trabaja) values
  ('2026-11-26', 'Thanksgiving', false),
  ('2026-11-27', 'Thanksgiving', false),
  ('2026-12-25', 'Christmas', false),
  ('2026-12-26', 'Christmas', false),
  ('2026-12-31', 'New Year', false),
  ('2027-01-01', 'New Year', false)
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- Pendientes de Mi Territorio: los días sin ruta no cuentan
-- ----------------------------------------------------------------------------

-- Cuántos días sin ruta (feriados) hay entre p_desde (sin contarlo) y p_hasta
-- (contándolo) para esa ruta. Una regla solo de la ruta gana sobre la general.
create or replace function public._dias_sin_ruta(p_ruta text, p_desde date, p_hasta date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from (
    select distinct on (d.fecha) d.fecha, d.trabaja
    from public.rutas_dias_especiales d
    where d.fecha > p_desde and d.fecha <= p_hasta
      and (d.ibp_id is null or d.ibp_id = p_ruta)
    order by d.fecha, (d.ibp_id is null)
  ) x
  where not x.trabaja;
$$;

revoke all on function public._dias_sin_ruta(text, date, date) from public, anon, authenticated;

-- Igual que en pendientes_y_pruebas.sql, pero restando los días sin ruta:
--   semanal:  más de 7 días de ruta sin visita
--   quincenal: más de 14 días de ruta sin visita
--   2x / 3x:  la ventana de 7 días se alarga lo que haya de feriados
create or replace function public._tiendas_pendientes(p_ruta text)
returns table (
  tienda_id text, nombre text, direccion text, ciudad text, frecuencia text,
  dias_visita text[], ultima_visita date, dias_sin_visita integer,
  visitas_semana integer, visitas_necesarias integer
)
language sql
stable
security definer
set search_path = public
as $$
  with hoy as (select (now() at time zone 'America/New_York')::date as d),
  ventana as (
    select (select d from hoy) - 7 - public._dias_sin_ruta(p_ruta, (select d from hoy) - 7, (select d from hoy)) as desde
  ),
  t as (
    select t.id, t.nombre, t.direccion, t.ciudad, t.frecuencia, t.dias_visita,
           t.revisado_en::date as desde,
           case t.frecuencia when '2x_semana' then 2 when '3x_semana' then 3 when 'semanal' then 1 else 0 end as necesarias
    from public.tiendas t
    where t.ibp_id = p_ruta and t.vigente and t.estatus = 'activa'
      and t.frecuencia in ('semanal', '2x_semana', '3x_semana', 'quincenal')
  ),
  v as (
    select vi.tienda_id,
           max(vi.fecha) as ultima,
           count(*) filter (where vi.fecha between (select desde from ventana) and (select d from hoy))::int as n7
    from public.visitas vi
    join t on t.id = vi.tienda_id
    where vi.fecha <= (select d from hoy)
    group by vi.tienda_id
  ),
  x as (
    select t.*, v.ultima, coalesce(v.n7, 0) as n7,
           ((select d from hoy) - coalesce(v.ultima, t.desde, (select d from hoy)))::int as sin_visita,
           public._dias_sin_ruta(p_ruta, coalesce(v.ultima, t.desde, (select d from hoy)), (select d from hoy)) as feriados
    from t left join v on v.tienda_id = t.id
  )
  select x.id, x.nombre, x.direccion, x.ciudad, x.frecuencia, x.dias_visita, x.ultima,
         x.sin_visita, x.n7, x.necesarias
  from x
  where case
    when x.frecuencia = 'quincenal' then x.sin_visita - x.feriados > 14
    when x.frecuencia = 'semanal' then x.sin_visita - x.feriados > 7
    else coalesce(x.desde, (select d from hoy)) <= (select desde from ventana) and x.n7 < x.necesarias
  end
  order by x.sin_visita desc, x.nombre;
$$;

revoke all on function public._tiendas_pendientes(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
