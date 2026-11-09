-- ============================================================================
-- Planificador de rutas (rutas.html) — tablas nuevas.
-- ----------------------------------------------------------------------------
-- Se corre UNA vez en el SQL Editor del proyecto Supabase "bimbo-inventory-pro"
-- (el mismo de Mi Territorio). Solo AGREGA tablas: no modifica tiendas, ibps,
-- ventas_semanales ni nada de lo que ya usan los IBPs.
--
--   rutas_geo     coordenadas de cada tienda (Census, OpenStreetMap o manual)
--   rutas_plan    plan de visitas A/B por ruta (IBP): días, orden, punto de
--                 salida y frecuencias cambiadas a mano
--   rutas_config  reglas globales de frecuencia (se editan en la página)
--
-- Acceso: solo admin, DOS, ZSL y MSL (lectura y escritura). Los IBPs y
-- cualquier otro rol no ven nada. Sin sesión, RLS bloquea todo.
-- ============================================================================

create table if not exists public.rutas_geo (
  tienda_id text primary key references public.tiendas(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  fuente text not null default 'manual' check (fuente in ('census', 'osm', 'manual')),
  actualizado_en timestamptz not null default now()
);

comment on table public.rutas_geo is 'Planificador de rutas: coordenadas por tienda (fuente: census/osm/manual).';

create table if not exists public.rutas_plan (
  ibp_id text primary key references public.ibps(id) on delete cascade,
  -- {"direccion": "...", "lat": 38.9, "lng": -77.4} o null
  inicio jsonb,
  -- frecuencias cambiadas a mano: {"<id tienda>": "2x" | "1x" | "q" | "fuera"}
  frecuencias jsonb not null default '{}'::jsonb,
  -- días con su orden: {"A1": ["<id tienda>", ...], "A2": [...], ..., "B5": [...]}
  -- A/B = semana, 1..6 = lunes..sábado
  slots jsonb not null default '{}'::jsonb,
  -- tiendas que se movieron a mano (el recálculo completo las respeta)
  fijadas text[] not null default '{}',
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);

comment on table public.rutas_plan is 'Planificador de rutas: plan de visitas semana A/B por ruta (IBP).';

create table if not exists public.rutas_config (
  clave text primary key,
  valor jsonb not null,
  actualizado_en timestamptz not null default now()
);

comment on table public.rutas_config is 'Planificador de rutas: configuración global (reglas de frecuencia).';

alter table public.rutas_geo enable row level security;
alter table public.rutas_plan enable row level security;
alter table public.rutas_config enable row level security;

-- Roles con acceso al planificador (se compara como texto para no depender
-- de que el enum user_role tenga todos estos valores).
create or replace function public.rutas_tiene_acceso()
returns boolean
language sql
stable
as $$
  select coalesce(lower(public.current_user_role()::text) = any (array['admin','dos','zsl','msl']), false)
$$;

create policy "rutas_geo_acceso" on public.rutas_geo for all
using (public.rutas_tiene_acceso()) with check (public.rutas_tiene_acceso());

create policy "rutas_plan_acceso" on public.rutas_plan for all
using (public.rutas_tiene_acceso()) with check (public.rutas_tiene_acceso());

create policy "rutas_config_acceso" on public.rutas_config for all
using (public.rutas_tiene_acceso()) with check (public.rutas_tiene_acceso());

grant select, insert, update, delete on public.rutas_geo, public.rutas_plan, public.rutas_config to authenticated;
