-- ============================================================================
-- app_config: nombre de la app y datos que NO van en el código
-- ----------------------------------------------------------------------------
-- Se corre en el SQL Editor del proyecto de Supabase de la app. Se puede
-- correr más de una vez: no pisa lo que ya llenaste.
--
-- Lectura pública (las páginas lo leen antes de iniciar sesión: va en el
-- título). Solo se cambia desde Supabase (Table Editor o SQL), nunca desde
-- la app. NO guardes aquí nada secreto: la llave privada de los avisos va en
-- los secretos de la Edge Function (VAPID_PRIVATE_KEY), no en esta tabla.
--
-- Claves:
--   nombre_app    nombre que sale en los títulos y en el inicio
--   vapid_public  llave pública de los avisos push (pareja de la privada)
-- Los valores "<<...>>" no se muestran: llénalos con el Table Editor o con
--   update public.app_config set valor = '...' where clave = 'nombre_app';
-- ============================================================================

create table if not exists public.app_config (
  clave text primary key,
  valor text not null,
  actualizado_en timestamptz not null default now()
);

comment on table public.app_config is 'Configuración pública de la app (nombre, llave pública de avisos). Sin secretos.';

alter table public.app_config enable row level security;

drop policy if exists "app_config_lectura" on public.app_config;
create policy "app_config_lectura" on public.app_config for select using (true);

grant select on public.app_config to anon, authenticated;

insert into public.app_config (clave, valor) values
  ('nombre_app', '<<nombre de la app>>'),
  ('vapid_public', '<<llave pública VAPID>>')
on conflict (clave) do nothing;

select clave, valor from public.app_config order by clave;
