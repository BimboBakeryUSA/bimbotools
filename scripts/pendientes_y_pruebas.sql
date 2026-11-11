-- ============================================================================
-- Tiendas pendientes + recordatorio push + ruta de pruebas + reglas por cadena
-- ----------------------------------------------------------------------------
-- Se corre en el SQL Editor del proyecto de Supabase de la app.
-- Se puede correr más de una vez (borra y vuelve a crear solo lo de pruebas).
--
--   1. Reglas del planificador: Walmart 3x, Wawa 2x, 7-Eleven semanal
--      (las demás cadenas que ya tengas guardadas se quedan igual).
--   2. Ruta de pruebas 9999 con 12 tiendas de prueba (ids PRUEBA01..12),
--      con ubicación, ventas y visitas armadas para que unas salgan pendientes.
--   3. Pendientes: tiendas activas que ya se pasaron de su frecuencia sin
--      visita marcada. Mi Territorio las muestra al abrir la app.
--   4. Recordatorio: deja un mensaje corto a cada ruta con pendientes; el
--      aviso push sale solo (trigger mensajes_notificar_push que ya existe).
--
-- Encendido por ruta: rutas_config clave "pendientes". Arranca SOLO con la
-- ruta 9999. Para todas las rutas (cuando ya lo probaste):
--   update public.rutas_config set valor = '{"todas": true, "rutas": []}' where clave = 'pendientes';
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Reglas del planificador por cadena
-- ----------------------------------------------------------------------------
-- Pone Walmart / Wawa / 7-Eleven al principio de la lista (se revisan en
-- orden) y quita las reglas viejas de esas mismas cadenas. El resto de
-- cadenas y los umbrales de venta se quedan como estén.
with actual as (
  select coalesce(
    (select valor from public.rutas_config where clave = 'reglas'),
    '{"cadenas": [], "ventaMuyAlta": null, "ventaAlta": null, "ventaBaja": null}'::jsonb
  ) as v
),
nuevas as (
  select '[
    {"nombre": "Walmart", "patron": "wal[- ]?mart", "freq": "3x", "dosVecesSobre": null, "tresVecesSobre": null},
    {"nombre": "Wawa", "patron": "\\bwawa\\b", "freq": "2x", "dosVecesSobre": null, "tresVecesSobre": null},
    {"nombre": "7-Eleven", "patron": "7[- ]?eleven|seven[- ]?eleven", "freq": "1x", "dosVecesSobre": null, "tresVecesSobre": null}
  ]'::jsonb as n
),
resto as (
  select coalesce(jsonb_agg(c order by o), '[]'::jsonb) as r
  from actual, jsonb_array_elements(coalesce(actual.v -> 'cadenas', '[]'::jsonb)) with ordinality as e(c, o)
  where lower(coalesce(c ->> 'nombre', '') || ' ' || coalesce(c ->> 'patron', '')) !~ '(wal.?mart|wawa|eleven)'
)
insert into public.rutas_config (clave, valor, actualizado_en)
select 'reglas', jsonb_set(actual.v, '{cadenas}', nuevas.n || resto.r), now()
from actual, nuevas, resto
on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();


-- ----------------------------------------------------------------------------
-- 2. Ruta de pruebas 9999
-- ----------------------------------------------------------------------------
-- Copia MSL/ZSL/DOS de una ruta de Douglas Morales Reyes para que salga en
-- su lista del planificador.
insert into public.ibps (id, propietario, manager, zsl, dos)
select '9999', 'PRUEBAS (no es ruta real)', i.manager, i.zsl, i.dos
from public.ibps i
where i.manager ilike '%douglas%'
order by i.id
limit 1
on conflict (id) do update set propietario = excluded.propietario;

-- Por si no hubo ruta de Douglas de donde copiar.
insert into public.ibps (id, propietario)
values ('9999', 'PRUEBAS (no es ruta real)')
on conflict (id) do nothing;

-- El enlace del IBP vence 7 días después de usarse; así cada corrida lo renueva.
update public.ibps set token_primer_uso = null where id = '9999';

-- Borra las tiendas de prueba anteriores (sus visitas, ventas e historial se
-- van con ellas por "on delete cascade").
delete from public.tiendas where ibp_id = '9999' and id like 'PRUEBA%';
delete from public.mensajes where ruta_id = '9999';

insert into public.tiendas
  (id, ibp_id, nombre, direccion, ciudad, estado_us, zip, tipo_cuenta, productos,
   estatus, motivo, frecuencia, dias_visita, revisado_en, vigente)
values
  ('PRUEBA01', '9999', 'PRUEBA Walmart 1', '13059 Fair Lakes Shopping Ctr', 'Fairfax', 'VA', '22033', 'WAL-MART', 40, 'activa', null, '3x_semana', '{lunes,miercoles,viernes}', now() - interval '30 days', true),
  ('PRUEBA02', '9999', 'PRUEBA Walmart 2', '6303 Richmond Hwy', 'Alexandria', 'VA', '22306', 'WAL-MART', 38, 'activa', null, '3x_semana', '{lunes,miercoles,viernes}', now() - interval '30 days', true),
  ('PRUEBA03', '9999', 'PRUEBA Wawa 1', '4401 Fair Lakes Ct', 'Fairfax', 'VA', '22033', 'WAWA', 25, 'activa', null, '2x_semana', '{martes,viernes}', now() - interval '30 days', true),
  ('PRUEBA04', '9999', 'PRUEBA Wawa 2', '10100 Lee Hwy', 'Fairfax', 'VA', '22030', 'WAWA', 22, 'activa', null, '2x_semana', '{lunes,jueves}', now() - interval '30 days', true),
  ('PRUEBA05', '9999', 'PRUEBA 7 Eleven 1', '9600 Main St', 'Fairfax', 'VA', '22031', '7 ELEVEN INC', 18, 'activa', null, 'semanal', '{martes}', now() - interval '30 days', true),
  ('PRUEBA06', '9999', 'PRUEBA 7 Eleven 2', '3015 Nutley St', 'Fairfax', 'VA', '22031', '7 ELEVEN INC', 17, 'activa', null, 'semanal', '{jueves}', now() - interval '30 days', true),
  ('PRUEBA07', '9999', 'PRUEBA Kroger 1', '5615 Columbia Pike', 'Falls Church', 'VA', '22041', 'KROGER', 30, 'activa', null, 'quincenal', '{miercoles}', now() - interval '30 days', true),
  ('PRUEBA08', '9999', 'PRUEBA Kroger 2', '7235 Arlington Blvd', 'Falls Church', 'VA', '22042', 'KROGER', 28, 'activa', null, 'quincenal', '{lunes}', now() - interval '30 days', true),
  ('PRUEBA09', '9999', 'PRUEBA Tienda Latina', '6136 Arlington Blvd', 'Falls Church', 'VA', '22044', 'INDEPENDENT', 12, 'activa', null, 'semanal', '{viernes}', now() - interval '30 days', true),
  ('PRUEBA10', '9999', 'PRUEBA Panaderia (pedido)', '3800 Lee Hwy', 'Arlington', 'VA', '22207', 'INDEPENDENT', 6, 'activa', null, 'pedido', '{jueves}', now() - interval '30 days', true),
  ('PRUEBA11', '9999', 'PRUEBA Deli (inactiva)', '2900 Columbia Pike', 'Arlington', 'VA', '22204', 'INDEPENDENT', 3, 'inactiva', 'Prueba: cerró', null, '{}', now() - interval '30 days', true),
  ('PRUEBA12', '9999', 'PRUEBA Tienda nueva (sin revisar)', '7700 Leesburg Pike', 'Falls Church', 'VA', '22043', 'INDEPENDENT', 9, null, null, null, '{}', null, true);

-- Ubicación para el planificador (sin esperar al Census).
insert into public.rutas_geo (tienda_id, lat, lng, fuente)
values
  ('PRUEBA01', 38.8590, -77.3880, 'manual'), ('PRUEBA02', 38.7790, -77.0720, 'manual'),
  ('PRUEBA03', 38.8560, -77.3870, 'manual'), ('PRUEBA04', 38.8610, -77.3040, 'manual'),
  ('PRUEBA05', 38.8460, -77.2900, 'manual'), ('PRUEBA06', 38.8700, -77.2470, 'manual'),
  ('PRUEBA07', 38.8550, -77.1340, 'manual'), ('PRUEBA08', 38.8690, -77.2000, 'manual'),
  ('PRUEBA09', 38.8650, -77.1490, 'manual'), ('PRUEBA10', 38.8960, -77.1250, 'manual'),
  ('PRUEBA11', 38.8620, -77.0890, 'manual'), ('PRUEBA12', 38.9080, -77.2000, 'manual')
on conflict (tienda_id) do update set lat = excluded.lat, lng = excluded.lng, fuente = excluded.fuente, actualizado_en = now();

-- Ventas en las 12 semanas más recientes que ya hay en la base.
insert into public.ventas_semanales (tienda_id, semana, unidades)
select t.id, s.semana, 10 + t.productos + (s.n % 4) * 3
from public.tiendas t
cross join (
  select semana, row_number() over () as n
  from (
    select semana from public.ventas_semanales
    group by semana
    order by split_part(semana, '/', 2)::int desc, split_part(semana, '/', 1)::int desc
    limit 12
  ) x
) s
where t.ibp_id = '9999' and t.id like 'PRUEBA%' and t.estatus = 'activa'
on conflict (tienda_id, semana) do nothing;

-- Visitas marcadas, contadas desde hoy (hora del Este):
--   al día:     Walmart 1 (3 en la semana), Wawa 1 (2), 7 Eleven 1 (hace 3 días),
--               Kroger 1 (hace 5 días)
--   pendientes: Walmart 2 (1 de 3), Wawa 2 (1 de 2), 7 Eleven 2 (hace 9 días),
--               Kroger 2 (hace 16 días), Tienda Latina (nunca)
insert into public.visitas (tienda_id, fecha, origen)
select v.tienda_id, (now() at time zone 'America/New_York')::date - v.hace, 'admin_carga'
from (values
  ('PRUEBA01', 1), ('PRUEBA01', 3), ('PRUEBA01', 5),
  ('PRUEBA02', 6),
  ('PRUEBA03', 2), ('PRUEBA03', 5),
  ('PRUEBA04', 4),
  ('PRUEBA05', 3),
  ('PRUEBA06', 9),
  ('PRUEBA07', 5),
  ('PRUEBA08', 16)
) as v(tienda_id, hace)
on conflict (tienda_id, fecha) do nothing;


-- ----------------------------------------------------------------------------
-- 3. Pendientes
-- ----------------------------------------------------------------------------
-- Encendido: arranca solo con la ruta de pruebas.
insert into public.rutas_config (clave, valor)
values ('pendientes', '{"todas": false, "rutas": ["9999"]}')
on conflict (clave) do nothing;

create or replace function public._pendientes_activo(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (valor ->> 'todas')::boolean or (valor -> 'rutas') ? p_ruta
     from public.rutas_config where clave = 'pendientes'),
    false
  );
$$;

-- Reglas (hoy = fecha del Este; la visita de hoy cuenta):
--   semanal:  más de 7 días sin visita
--   quincenal: más de 14 días sin visita
--   2x / 3x:  en los últimos 7 días (más hoy) tiene menos visitas de las que tocan
-- Si nunca se ha visitado, se cuenta desde que el IBP la activó (revisado_en),
-- para no marcar como pendiente una tienda recién activada.
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
           count(*) filter (where vi.fecha between (select d from hoy) - 7 and (select d from hoy))::int as n7
    from public.visitas vi
    join t on t.id = vi.tienda_id
    where vi.fecha <= (select d from hoy)
    group by vi.tienda_id
  )
  select t.id, t.nombre, t.direccion, t.ciudad, t.frecuencia, t.dias_visita, v.ultima,
         ((select d from hoy) - coalesce(v.ultima, t.desde, (select d from hoy)))::int,
         coalesce(v.n7, 0), t.necesarias
  from t left join v on v.tienda_id = t.id
  where case
    when t.frecuencia = 'quincenal' then (select d from hoy) - coalesce(v.ultima, t.desde, (select d from hoy)) > 14
    when t.frecuencia = 'semanal' then (select d from hoy) - coalesce(v.ultima, t.desde, (select d from hoy)) > 7
    else coalesce(t.desde, (select d from hoy)) <= (select d from hoy) - 7 and coalesce(v.n7, 0) < t.necesarias
  end
  order by (select d from hoy) - coalesce(v.ultima, t.desde, (select d from hoy)) desc, t.nombre;
$$;

revoke all on function public._pendientes_activo(text) from public, anon, authenticated;
revoke all on function public._tiendas_pendientes(text) from public, anon, authenticated;

-- Lo que llama la app: { "activo": bool, "tiendas": [...] }. El IBP solo ve
-- la suya; admin/corporativo y managers (DOS, ZSL, MSL) cualquier ruta.
create or replace function public.pendientes_de_ruta(p_ruta text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol text := lower(coalesce(public.current_user_role()::text, ''));
begin
  if not (v_rol in ('admin', 'corporativo', 'dos', 'zsl', 'msl')
          or (v_rol = 'route' and public.current_user_route_code() = p_ruta)) then
    raise exception 'no tienes acceso a esta ruta';
  end if;
  if not public._pendientes_activo(p_ruta) then
    return jsonb_build_object('activo', false, 'tiendas', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'activo', true,
    'tiendas', coalesce((select jsonb_agg(to_jsonb(p)) from public._tiendas_pendientes(p_ruta) p), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pendientes_de_ruta(text) from public;
grant execute on function public.pendientes_de_ruta(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. Recordatorio (mensaje + push)
-- ----------------------------------------------------------------------------
-- Una ruta (p_ruta) o todas las encendidas (p_ruta null). Un mensaje por ruta
-- con pendientes, máximo uno al día. Devuelve cuántos mensajes dejó.
create or replace function public.enviar_recordatorios_pendientes(p_ruta text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_lista text;
  v_n integer;
  v_texto text;
  v_enviados integer := 0;
  v_etiqueta jsonb := '{"semanal": "semanal", "quincenal": "quincenal", "2x_semana": "2x semana", "3x_semana": "3x semana"}';
begin
  for r in
    select i.id from public.ibps i
    where (p_ruta is null or i.id = p_ruta) and public._pendientes_activo(i.id)
  loop
    -- Ya se le mandó hoy: no repetir.
    if exists (
      select 1 from public.mensajes m
      where m.ruta_id = r.id and m.creado_por_nombre = 'Recordatorio automático'
        and (m.creado_en at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date
    ) then
      continue;
    end if;

    select count(*), string_agg(
             p.nombre || ' (' || coalesce(v_etiqueta ->> p.frecuencia, p.frecuencia) ||
             case when p.frecuencia in ('2x_semana', '3x_semana')
                  then ', ' || p.visitas_semana || ' de ' || p.visitas_necesarias || ' esta semana'
                  else ', ' || p.dias_sin_visita || ' días' end || ')',
             '; ' order by p.dias_sin_visita desc)
      into v_n, v_lista
    from (select * from public._tiendas_pendientes(r.id) limit 5) p;

    if v_n = 0 then
      continue;
    end if;
    select count(*) into v_n from public._tiendas_pendientes(r.id);

    v_texto := 'Tienes ' || v_n || case when v_n = 1 then ' tienda pendiente: ' else ' tiendas pendientes: ' end
               || v_lista || case when v_n > 5 then '; y ' || (v_n - 5) || ' más.' else '.' end
               || ' Ábrelas en Mi Territorio.';

    insert into public.mensajes (ruta_id, texto, creado_por_nombre)
    values (r.id, v_texto, 'Recordatorio automático');
    v_enviados := v_enviados + 1;
  end loop;
  return v_enviados;
end;
$$;

revoke all on function public.enviar_recordatorios_pendientes(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Para probar
-- ----------------------------------------------------------------------------
-- Ver las pendientes de la ruta de pruebas (deben salir 5):
--   select nombre, frecuencia, dias_sin_visita, visitas_semana, visitas_necesarias
--   from public._tiendas_pendientes('9999');
--
-- Mandar el recordatorio a la ruta de pruebas (máximo uno al día; para
-- repetirlo, borra antes: delete from public.mensajes where ruta_id = '9999';):
--   select public.enviar_recordatorios_pendientes('9999');
--
-- Recordatorio automático todos los días (lunes a sábado, 6:30 am del Este).
-- Requiere la extensión pg_cron (Database → Extensions → pg_cron). Solo
-- manda a las rutas encendidas en rutas_config "pendientes":
--   select cron.schedule('recordatorio-pendientes', '30 11 * * 1-6',
--     $cron$ select public.enviar_recordatorios_pendientes(); $cron$);
--   (11:30 UTC = 6:30 am en invierno; en verano sale a las 7:30 am.)
-- Para quitarlo: select cron.unschedule('recordatorio-pendientes');

-- Enlace para entrar como el IBP de la ruta de pruebas (ábrelo en una
-- ventana de incógnito o en otro teléfono, NO en el navegador donde ya
-- entraste con tu cuenta):
-- (Va después de la dirección donde está publicada la app.)
select 'mi-territorio.html?t=' || token as enlace_ruta_pruebas
from public.ibps where id = '9999';
