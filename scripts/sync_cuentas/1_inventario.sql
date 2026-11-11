-- ============================================================================
-- Copia de cuentas catálogo → inventario: PARTE 1 (proyecto de INVENTARIO)
-- ----------------------------------------------------------------------------
-- Las cuentas se manejan en catálogo; este proyecto (el de esta app y la de
-- inventario) recibe una copia. Se corre en el SQL Editor del proyecto de
-- INVENTARIO. Se puede volver a correr.
--
-- Lo llama la Edge Function sincronizar-cuenta (solo con la llave de
-- servicio). Por cada cuenta de catálogo con rol admin / msl / zsl / ibp:
--   - pone la MISMA contraseña de catálogo (ya cifrada, bcrypt);
--   - si no tenía perfil aquí, se lo crea con su rol:
--       admin → admin, msl / zsl → corporativo, ibp → route (sin ruta asignada);
--   - si ya tenía perfil aquí, su rol y su ruta NO se tocan.
-- Los clientes de catálogo no se copian.
-- ============================================================================

create or replace function public.sync_aplicar_cuenta(
  p_email text,
  p_hash text,
  p_confirmada boolean,
  p_nombre text,
  p_rol text,
  p_nuevo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  v_rol text;
begin
  if v_email = '' then
    return jsonb_build_object('ok', false, 'motivo', 'sin correo');
  end if;
  if coalesce(p_rol, '') not in ('admin', 'msl', 'zsl', 'ibp') then
    return jsonb_build_object('ok', false, 'motivo', 'ese rol no se copia');
  end if;

  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then
    -- La Edge Function la crea y vuelve a llamar con p_nuevo = true.
    return jsonb_build_object('ok', false, 'falta_crear', true);
  end if;

  -- Misma contraseña que en catálogo (solo si viene un hash bcrypt válido).
  if p_hash like '$2%' then
    update auth.users
    set encrypted_password = p_hash,
        email_confirmed_at = case when p_confirmada then coalesce(email_confirmed_at, now()) else email_confirmed_at end,
        updated_at = now()
    where id = v_id;
  end if;

  v_rol := case p_rol when 'admin' then 'admin' when 'ibp' then 'route' else 'corporativo' end;

  if not exists (select 1 from public.profiles where id = v_id) then
    insert into public.profiles (id, role, nombre, email, estado)
    values (v_id, v_rol::public.user_role, nullif(trim(p_nombre), ''), v_email, 'activo');
  elsif p_nuevo then
    -- Recién creada por la sincronización: se le pone su rol aunque algún
    -- trigger ya le haya creado un perfil por defecto.
    update public.profiles
    set role = v_rol::public.user_role,
        nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
        email = coalesce(email, v_email),
        estado = 'activo'
    where id = v_id;
  else
    update public.profiles
    set nombre = coalesce(nombre, nullif(trim(p_nombre), '')),
        email = coalesce(email, v_email)
    where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'nuevo', p_nuevo);
end;
$$;

revoke all on function public.sync_aplicar_cuenta(text, text, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.sync_aplicar_cuenta(text, text, boolean, text, text, boolean) to service_role;

-- Las contraseñas ahora se cambian en catálogo (se copian solas); el cambio
-- directo desde el Administrador de esta app se quita para no tener dos.
drop function if exists public.admin_cambiar_clave(text, text);
