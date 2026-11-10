-- ============================================================================
-- Mi Territorio: agrega la frecuencia "3 veces por semana" (3x_semana).
-- ----------------------------------------------------------------------------
-- Se corre UNA vez en el SQL Editor del proyecto Supabase "bimbo-inventory-pro".
-- Solo amplía la lista de valores permitidos: no cambia ninguna tienda.
-- Es seguro correrlo más de una vez.
-- ============================================================================

-- 1. Valores permitidos en tiendas.frecuencia
do $$
declare
  r record;
begin
  -- Quita el check viejo de frecuencia (su nombre lo puso Postgres al crearlo).
  for r in
    select con.conname
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
      and cls.relname = 'tiendas'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%frecuencia%'
  loop
    execute format('alter table public.tiendas drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tiendas
  add constraint tiendas_frecuencia_check
  check (frecuencia in ('semanal', '2x_semana', '3x_semana', 'quincenal', 'pedido'));

-- 2. La función que usan Mi Territorio y el Administrador para guardarla
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
  if p_frecuencia not in ('semanal', '2x_semana', '3x_semana', 'quincenal', 'pedido') then
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

revoke all on function public.set_tienda_frecuencia(text, text) from public;
grant execute on function public.set_tienda_frecuencia(text, text) to anon, authenticated;
