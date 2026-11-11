-- ============================================================================
-- Cuentas desde el Administrador: ver una cuenta por correo
-- ----------------------------------------------------------------------------
-- Se corre una vez en el SQL Editor del proyecto de Supabase de la app.
-- Se puede volver a correr.
--
-- Solo admin y corporativo pueden usarla (se revisa con la sesión real, no
-- con lo que mande el navegador).
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

-- Las contraseñas ya no se cambian desde esta app: se manejan en catálogo y
-- se copian solas (scripts/sync_cuentas/). Si quedó la función vieja, se quita.
drop function if exists public.admin_cambiar_clave(text, text);

revoke all on function public.admin_ver_cuenta(text) from public, anon;
grant execute on function public.admin_ver_cuenta(text) to authenticated;
