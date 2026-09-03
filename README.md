# Bimbo Tools — Optimizador de Ruta

PWA en HTML/CSS/JS puro (sin build, sin npm). Igual que catalogo-bimbo y
bimbo-inventory-pro: se abre directo, no necesita compilar nada.

## Cómo correrlo

No hay paso de build. Solo necesita servirse por HTTP (no funciona abriendo
el `.html` directo con `file://` porque `fetch()` a `data/seed.json` y el
service worker lo bloquean los navegadores por seguridad).

Cualquiera de estas opciones sirve:

```bash
# Python (ya viene instalado en casi cualquier máquina)
python3 -m http.server 8080

# Node, si lo tienes
npx serve .
```

Luego abre `http://localhost:8080`.

## Estructura

- `index.html` — portada: lista en vivo (desde Supabase) de las rutas reales
  con su dueño de ruta, para entrar directo a Mi Territorio. Sin login real
  todavía, así que cualquiera con el link puede entrar a cualquier ruta —
  ver "Pendientes conocidos".
- `ibp.html` — demo vieja de un "optimizador de ruta diario" (lista
  ordenada, geofence automático, agregar/quitar clientes) con datos de
  ejemplo (`data/seed.json`). Ya no está enlazada desde `index.html` para no
  mezclar nombres inventados con las rutas reales — sigue accesible por URL
  directa (`ibp.html?u=ibp-1`) por si se retoma más adelante.
- `msl.html` — dashboard del Manager MSL de esa misma demo (ve todos sus
  IBPs, drill-down por IBP → ruta → cliente, con % de frescura). Mismo caso:
  datos de ejemplo, ya no enlazado desde `index.html`.
- `admin.html` — alta manual de clientes, importar CSV, cargar % de
  frescura, ver historial de movimientos, y la pestaña **Territorios**
  (ver "Mi Territorio" abajo).
- `mi-territorio.html` — página donde cada IBP decide qué tiendas siguen en
  su lista (ver "Mi Territorio" abajo).
- `js/data.js` — **capa de datos abstraída**. Todas las páginas hablan con
  este archivo, nunca directo con JSON/localStorage. El día que se conecte
  Supabase, solo se reescribe el cuerpo de estas funciones — las páginas
  no cambian.
- `js/depuracion.js` — capa de datos de "Mi Territorio". A diferencia de
  `js/data.js` (todavía local/localStorage), este archivo habla directo con
  **Supabase** — ver "Base de datos" abajo. El nombre interno
  (`depuracion.js` / `BimboDepuracion`) se quedó como estaba al renombrar la
  página, es solo la capa de datos.
- `js/geo.js` — geofence (confirmación automática de visita por GPS).
- `data/seed.json` — datos de ejemplo (usuarios, rutas, clientes) usados por
  index/ibp/msl/admin.
- `data/tiendas.json` — foto del catálogo de tiendas (dueño de ruta,
  dirección, ventas de las últimas 12 semanas) tal como se generó del
  reporte de ventas — es el insumo que se usó para sembrar Supabase (ver
  `scripts/generar_tiendas.py`); la app ya no lee este archivo directamente.
- `scripts/generar_tiendas.py` — regenera `data/tiendas.json` a partir de un
  nuevo reporte Excel "Central List / Account L4 / Route / Product Name".
- `scripts/mi_territorio_schema.sql` — el esquema de Supabase de Mi
  Territorio (tablas, RLS, funciones), tal cual se aplicó al proyecto real.
- `manifest.json` + `sw.js` + `icons/` — lo que hace la app instalable como
  PWA.

## Mi Territorio (IBP)

Se llama así a propósito: es la lista de tiendas del IBP, no un trámite
administrativo genérico. Cada IBP entra por un enlace con su número de
ruta: `mi-territorio.html?ruta=0150`. Ahí, por cada tienda:

- La marca **activa** o **inactiva** — inactiva siempre pide el motivo (con
  `prompt`, obligatorio). No hay un estatus aparte de "pedir borrado": pedir
  que se elimine una tienda es simplemente marcarla inactiva y explicar por
  qué en el motivo — es la misma decisión, la diferencia es solo el motivo.
- Elige su **frecuencia de visita**: semanal, 2 veces por semana, quincenal,
  o a pedido del cliente.
- Si la tienda queda activa, marca **qué días** la visita (lunes a sábado,
  domingo no se pauta) con un selector de pastillas — ese campo solo aparece
  para tiendas activas.
- Ve un aviso automático (⚠️) cuando la tienda lleva 4+ semanas sin ventas
  en el periodo del reporte, para priorizar cuáles revisar primero.

Los cambios se guardan **directo en la base de datos, al toque** — ya no hay
que exportar ni mandarle nada a nadie. El admin ve todo en vivo en
`admin.html` → pestaña **Territorios** (vista general de todas las rutas,
con filtros y exportación a CSV) y ahí también están los enlaces por
territorio para mandarle a cada IBP el suyo.

## Base de datos (Supabase)

Mi Territorio usa Supabase — tablas `ibps`, `tiendas` (incluye
`dias_visita`, el arreglo de días en que se visita cada tienda activa) y
`ventas_semanales` (esquema completo en `scripts/mi_territorio_schema.sql`).
Vive dentro del
proyecto **`bimbo-inventory-pro`** (mismo Supabase, tablas con nombre
propio): la organización tiene tope de 2 proyectos activos en el plan free
y ya estaban ocupados por `bimbo-inventory-pro` y `catalogo-bimbo`, así que
se reusó ese en vez de crear uno nuevo. Si más adelante hace falta separarlo
a su propio proyecto, es cuestión de correr ese mismo `.sql` ahí y copiar
los datos — son tablas Postgres normales, no hay nada que las ate para
siempre a estar juntas.

**Seguridad (RLS):** la app no tiene login todavía, así que las tres tablas
tienen lectura abierta con la llave pública (`sb_publishable_...`, ya
embebida en `js/depuracion.js` — es la llave anónima, pensada para vivir en
el cliente). La escritura NO es un `UPDATE` directo a la tabla: pasa por dos
funciones de Postgres (`set_tienda_estatus`, `set_tienda_frecuencia`,
`set_tienda_dias`) que son las únicas con permiso de escritura. Esto acota
lo que cualquiera con el link puede tocar a exactamente el
estatus/motivo/frecuencia/días de visita de una tienda — nunca el catálogo
(nombre, dirección, ventas), que solo se actualiza vía migración.

**Refrescar el catálogo** (nuevo reporte de ventas): correr
`scripts/generar_tiendas.py` para regenerar `data/tiendas.json`, y de ahí
pedirle a Claude (con acceso a Supabase) que aplique el refresh a las tablas
— hoy no hay un botón para hacerlo solo, es un paso asistido.

## Estado actual

- **Mi Territorio** (`mi-territorio.html`, la lista de rutas en `index.html`,
  y la pestaña Territorios de `admin.html`): en vivo sobre Supabase — esto ya
  no es una demo local.
- `ibp.html`, `msl.html`, y el resto de `admin.html` (Clientes, Importar CSV,
  % Frescura, Historial) siguen siendo la demo vieja del "optimizador de
  ruta diario", con datos de ejemplo + `localStorage`, sin backend.

## Pendientes conocidos

- **Google Maps API key**: hoy el orden de la ruta usa vecino-más-cercano en
  línea recta (`js/data.js` → `ordenarPorVecinoMasCercano`). Cuando haya key,
  cambiar esa función por una llamada a Directions/Distance Matrix o Route
  Optimization API.
- **Geocodificación de direcciones**: el alta manual y el CSV piden lat/lng
  directo por ahora; si faltan, el cliente queda marcado como "pendiente
  geocodificar" en el panel admin.
- **Autenticación real**: hoy cualquiera con el link de una ruta puede
  entrar a Mi Territorio y marcar sus tiendas — no hay verificación de que
  sea el IBP dueño de esa ruta. Cuando exista login, restringir el UPDATE
  por usuario en vez de dejarlo abierto a quien tenga el link. La demo vieja
  (`ibp.html`/`msl.html`) también simula el rol eligiendo el usuario de una
  lista, sin login real.
- El resto de la app (ibp/msl/admin fuera de Territorios) todavía no
  se migra a Supabase — sigue en `localStorage`.
- Ver `bimbo-tools-especificacion.md` (carpeta raíz) para el resto de
  decisiones pendientes y el roadmap de próximas herramientas.
