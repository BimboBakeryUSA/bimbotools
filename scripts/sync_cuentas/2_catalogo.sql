-- ============================================================================
-- Copia de cuentas catálogo → inventario: PARTE 2 (proyecto de CATÁLOGO)
-- ----------------------------------------------------------------------------
-- Se corre en el SQL Editor del proyecto de CATÁLOGO, DESPUÉS de la parte 1
-- y de publicar la Edge Function sincronizar-cuenta en el de inventario.
-- Se puede volver a correr.
--
-- Cada vez que en catálogo se crea una cuenta, se cambia su contraseña
-- (también con "olvidé mi contraseña") o se cambia su nombre / rol / estado,
-- se manda una copia al proyecto de inventario. Solo cuentas con rol admin,
-- msl, zsl o ibp, y que no estén rechazadas. Si inventario no responde, la
-- cuenta en catálogo funciona igual (nunca bloquea el login ni el registro).
--
-- ANTES de correrlo: pon el secreto compartido en la línea marcada abajo
-- (el mismo que SYNC_SECRET de la Edge Function).
-- ============================================================================

create extension if not exists pg_net;

-- Esquema privado: ni la llave pública ni los usuarios lo pueden leer.
create schema if not exists sync;
revoke all on schema sync from public, anon, authenticated;

create table if not exists sync.config (
  clave text primary key,
  valor text not null
);
revoke all on sync.config from public, anon, authenticated;

insert into sync.config (clave, valor) values
  ('url', 'https://obfikwhukpzelsghowcq.supabase.co/functions/v1/sincronizar-cuenta'),
  ('apikey', 'sb_publishable_-qW3XyldNJgpOk6BLReC3A_HIyZHrHM')
on conflict (clave) do update set valor = excluded.valor;

-- >>> Pega aquí el secreto compartido (el mismo de SYNC_SECRET) <<<
insert into sync.config (clave, valor) values ('secreto', '<<SECRETO>>')
on conflict (clave) do update set valor = excluded.valor;

-- Revisa que existan las columnas que se copian (si falla aquí, avísame).
select id, role, nombre, estado_cuenta from public.profiles limit 0;

create or replace function sync.enviar_cuenta(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, sync
as $$
declare
  u record;
  p record;
  v_url text;
  v_key text;
  v_sec text;
begin
  select email, encrypted_password, email_confirmed_at into u from auth.users where id = p_id;
  if u.email is null then return; end if;

  select role, nombre, estado_cuenta into p from public.profiles where id = p_id;
  if p.role is null or p.role::text not in ('admin', 'msl', 'zsl', 'ibp') then return; end if;
  if coalesce(p.estado_cuenta::text, '') = 'rechazado' then return; end if;

  select valor into v_url from sync.config where clave = 'url';
  select valor into v_key from sync.config where clave = 'apikey';
  select valor into v_sec from sync.config where clave = 'secreto';
  if v_url is null or v_sec is null or v_sec like '<<%' then return; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'x-sync-secret', v_sec
    ),
    body := jsonb_build_object(
      'email', u.email,
      'password_hash', u.encrypted_password,
      'confirmada', u.email_confirmed_at is not null,
      'nombre', p.nombre,
      'rol', p.role::text
    )
  );
exception when others then
  raise warning 'sincronizar cuenta %: %', p_id, sqlerrm;
end;
$$;

create or replace function sync.tr_enviar_cuenta()
returns trigger
language plpgsql
security definer
set search_path = public, sync
as $$
begin
  perform sync.enviar_cuenta(new.id);
  return new;
end;
$$;

drop trigger if exists sync_cuenta_usuario on auth.users;
create trigger sync_cuenta_usuario
after insert or update of encrypted_password, email, email_confirmed_at on auth.users
for each row execute function sync.tr_enviar_cuenta();

drop trigger if exists sync_cuenta_perfil on public.profiles;
create trigger sync_cuenta_perfil
after insert or update of role, nombre, estado_cuenta on public.profiles
for each row execute function sync.tr_enviar_cuenta();

-- Copia inicial de todas las cuentas que ya existen. Devuelve cuántas mandó.
create or replace function sync.enviar_todas()
returns integer
language plpgsql
security definer
set search_path = public, sync
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.id from public.profiles p
    where p.role::text in ('admin', 'msl', 'zsl', 'ibp') and coalesce(p.estado_cuenta::text, '') <> 'rechazado'
  loop
    perform sync.enviar_cuenta(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function sync.enviar_cuenta(uuid) from public, anon, authenticated;
revoke all on function sync.enviar_todas() from public, anon, authenticated;

-- Botón "Sincronizar con inventario" del admin de catálogo (solo role admin).
-- Sin correo: manda todas las cuentas. Con correo: solo esa. Devuelve
-- cuántas mandó.
create or replace function public.sincronizar_cuentas_inventario(p_email text default null)
returns integer
language plpgsql
security definer
set search_path = public, sync
as $$
declare
  r record;
  n integer := 0;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin') then
    raise exception 'solo un admin puede sincronizar';
  end if;
  if not exists (select 1 from sync.config where clave = 'secreto' and valor not like '<<%') then
    raise exception 'falta configurar la sincronización (secreto) en este proyecto';
  end if;
  if p_email is null or trim(p_email) = '' then
    return sync.enviar_todas();
  end if;
  for r in select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) loop
    perform sync.enviar_cuenta(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.sincronizar_cuentas_inventario(text) from public, anon;
grant execute on function public.sincronizar_cuentas_inventario(text) to authenticated;

-- Copia inicial (ya con todo instalado):
select sync.enviar_todas() as cuentas_enviadas;
