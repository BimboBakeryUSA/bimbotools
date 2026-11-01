-- ============================================================================
-- Sincronización Mi Territorio con el listado oficial ZSL Diego Guzmán
-- (DOS Rebecca Crocker → ZSL Diego Guzmán → 5 MSL → 59 rutas → 1597 tiendas)
-- Aplicado en Supabase (proyecto bimbo-inventory-pro) el 2026-11-01.
-- Se deja aquí como registro; NO volver a correr tal cual.
-- ============================================================================

-- 0) Respaldo completo antes de tocar nada (schema no expuesto por la API)
create schema if not exists respaldo;
revoke all on schema respaldo from anon, authenticated;
create table respaldo.tiendas_20261101 as select * from public.tiendas;
create table respaldo.ibps_20261101 as select * from public.ibps;
create table respaldo.tiendas_historial_20261101 as select * from public.tiendas_historial;

-- 1) "Apagar" sin borrar: la tienda conserva estatus/frecuencia/dias_visita/
--    ventas/historial, solo deja de mostrarse en la app (RLS).
alter table public.tiendas
  add column vigente boolean not null default true,
  add column baja_en timestamptz,
  add column baja_motivo text;

drop policy if exists "tiendas_select" on public.tiendas;
create policy "tiendas_select" on public.tiendas for select
  using (
    vigente
    and (
      current_user_role() = any (array['admin'::user_role, 'corporativo'::user_role])
      or ibp_id = current_user_route_code()
    )
  );

-- 2) El Excel se cargó a respaldo.archivo_zsl_20261101(id, ibp_id, nombre,
--    direccion, ciudad, estado_us, tipo_cuenta) — 1597 filas, verificadas por md5.
--    Luego, en UNA transacción:
--    a) upsert de las 59 rutas en ibps (37 nuevas; MSL corregido en las 22
--       existentes; no se tocan token ni token_primer_uso)
--    b) 24 tiendas cambian de ruta (historial campo 'ibp_id'); se conserva su
--       plan. 0813323 (inactiva "no es de mi ruta" en 4339) pasa a 0150 y vuelve
--       a pendiente (historial campo 'reset').
--    c) 1004 tiendas nuevas: estatus NULL, dias_visita '{}' (pendientes).
--    d) 108 tiendas que no vienen en el listado: vigente=false, baja_en=now(),
--       baja_motivo='No viene en el listado ZSL Diego Guzmán (2026-11-01)'
--       (historial campo 'vigente').

-- Para reactivar una tienda apagada:
--   update public.tiendas set vigente=true, baja_en=null, baja_motivo=null where id='XXXXXXX';
-- Para ver las apagadas:
--   select id, ibp_id, nombre, estatus, dias_visita, baja_motivo from public.tiendas where not vigente;
