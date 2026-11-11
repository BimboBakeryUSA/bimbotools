-- ============================================================================
-- Cuentas desde el Administrador: ver una cuenta y cambiarle la contraseña
-- ----------------------------------------------------------------------------
-- Se corre una vez en el SQL Editor del proyecto de Supabase de la app.
-- Se puede volver a correr.
--
-- Solo admin y corporativo pueden usarlas (se revisa con la sesión real, no
-- con lo que mande el navegador). La contraseña nunca se guarda en claro:
-- se guarda cifrada (bcrypt), igual que cuando la pone Supabase.
-- La cuenta es la misma para todas las apps del proyecto: cambiarla aquí la
-- cambia en todas.
-- ============================================================================

-- Datos de una cuenta por correo: si existe, si está confirmada o bloqueada,
-- cuándo entró por última vez y su rol en la app.
create or replace function public.admin_ver_cuenta(p_email text)
returns table (
  email text, nombre text, rol text, ruta text, estado text,
  confirmada boolean, bloqueada_hasta timestamptz, ultimo_ingreso timestamptz, creada timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if lower(coalesce(public.current_user_role()::text, '')) not in ('admin', 'corporativo') then
    raise exception 'solo admin o corporativo';
  end if;
  return query
    select u.email::text, p.nombre::text, p.role::text, p.route_code::text, p.estado::text,
           (u.email_confirmed_at is not null), u.banned_until, u.last_sign_in_at, u.created_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    where lower(u.email) = lower(trim(p_email));
end;
$$;

-- Pone una contraseña nueva a la cuenta de ese correo. Devuelve el correo.
create or replace function public.admin_cambiar_clave(p_email text, p_clave text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if lower(coalesce(public.current_user_role()::text, '')) not in ('admin', 'corporativo') then
    raise exception 'solo admin o corporativo';
  end if;
  if p_clave is null or length(p_clave) < 8 then
    raise exception 'la contraseña debe tener al menos 8 caracteres';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf')),
      updated_at = now()
  where lower(email) = lower(trim(p_email))
  returning email into v_email;

  if v_email is null then
    raise exception 'no hay ninguna cuenta con el correo %', trim(p_email);
  end if;
  return v_email;
end;
$$;

revoke all on function public.admin_ver_cuenta(text) from public, anon;
revoke all on function public.admin_cambiar_clave(text, text) from public, anon;
grant execute on function public.admin_ver_cuenta(text) to authenticated;
grant execute on function public.admin_cambiar_clave(text, text) to authenticated;
