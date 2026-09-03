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

- `index.html` — selector de rol (IBP / MSL / Admin). Sin login real todavía.
- `ibp.html` — ruta del día del IBP: lista ordenada, geofence automático,
  botón manual, agregar/quitar clientes.
- `msl.html` — dashboard del Manager MSL: ve todos sus IBPs, drill-down por
  IBP → ruta → cliente, con % de frescura.
- `admin.html` — alta manual de clientes, importar CSV, cargar % de
  frescura, ver historial de movimientos, y la pestaña **Territorios**
  (ver "Mi Territorio" abajo).
- `mi-territorio.html` — página donde cada IBP decide qué tiendas siguen en
  su lista (ver "Mi Territorio" abajo).
- `js/data.js` — **capa de datos abstraída**. Todas las páginas hablan con
  este archivo, nunca directo con JSON/localStorage. El día que se conecte
  Supabase, solo se reescribe el cuerpo de estas funciones — las páginas
  no cambian.
- `js/depuracion.js` — capa de datos de "Mi Territorio" (catálogo de tiendas
  + estatus guardado en localStorage). Mismo patrón que `js/data.js`, archivo
  separado porque trabaja sobre otro dataset (`data/tiendas.json`); el nombre
  interno (`depuracion.js` / `BimboDepuracion`) se quedó como estaba al
  renombrar la página, es solo la capa de datos.
- `js/geo.js` — geofence (confirmación automática de visita por GPS).
- `data/seed.json` — datos de ejemplo (usuarios, rutas, clientes) usados por
  index/ibp/msl/admin.
- `data/tiendas.json` — catálogo real de tiendas por ruta (dueño de ruta,
  dirección, ventas de las últimas 12 semanas), generado desde el reporte de
  ventas — ver `scripts/generar_tiendas.py`.
- `scripts/generar_tiendas.py` — regenera `data/tiendas.json` a partir de un
  nuevo reporte Excel "Central List / Account L4 / Route / Product Name".
- `manifest.json` + `sw.js` + `icons/` — lo que hace la app instalable como
  PWA.

## Mi Territorio (IBP)

Se llama así a propósito: no es un trámite de "depuración" que le hacen al
IBP, es su territorio y él decide. Cada IBP entra por un enlace con su
número de ruta: `mi-territorio.html?ruta=0150`. Ahí, por cada tienda:

- La marca **activa**, **la pausa** o **la saca de su territorio** — pausar
  y sacar siempre piden el motivo (con `prompt`, obligatorio).
- Elige su **frecuencia de visita**: semanal, quincenal o a pedido del
  cliente.
- Ve un aviso automático (⚠️) cuando la tienda lleva 4+ semanas sin ventas
  en el periodo del reporte, para priorizar cuáles definir primero.

Las decisiones se guardan solas en el dispositivo del IBP (localStorage,
igual que el resto de la app hoy). Cuando termina, el IBP descarga un
`.json` con sus decisiones ("Descargar mis decisiones") y se lo manda a su
manager. El admin sube esos archivos en `admin.html` → pestaña
**Territorios**, donde se ven consolidados en una vista general de todas
las rutas, con filtros y exportación a CSV.

Los enlaces por territorio (para mandarle a cada IBP el suyo) también están
ahí, en la misma pestaña.

**Por qué así y no directo a una base compartida:** es el mismo estado
actual del resto de la app (local, sin backend) — ver "Pendientes conocidos"
abajo. El importar/exportar es el puente mientras tanto; el día que haya
Supabase, esto se vuelve automático (cada IBP guarda directo en la base y el
admin ve todo en vivo, sin subir archivos).

## Estado actual (demo funcional)

Todo corre en el navegador con datos de ejemplo + `localStorage` (para que
las visitas marcadas, clientes movidos y notificaciones sobrevivan al
refrescar la página). No hay backend todavía.

## Pendientes conocidos

- **Supabase**: la organización llegó al límite de proyectos gratis: hay que
  pausar/eliminar uno de los dos existentes (`bimbo-inventory-pro` o
  `catalogo-bimbo`) o subir de plan antes de crear el proyecto de este.
- **Google Maps API key**: hoy el orden de la ruta usa vecino-más-cercano en
  línea recta (`js/data.js` → `ordenarPorVecinoMasCercano`). Cuando haya key,
  cambiar esa función por una llamada a Directions/Distance Matrix o Route
  Optimization API.
- **Geocodificación de direcciones**: el alta manual y el CSV piden lat/lng
  directo por ahora; si faltan, el cliente queda marcado como "pendiente
  geocodificar" en el panel admin.
- **Autenticación real** por rol (hoy se simula eligiendo el usuario desde
  `index.html`).
- **Mi Territorio centralizado**: hoy cada IBP guarda sus decisiones local y
  se consolidan importando archivos `.json` en `admin.html` — con Supabase
  esto sería automático y en vivo (ver sección de arriba).
- `data/tiendas.json` es una foto de un reporte de ventas (12 semanas hasta
  la W35/2026) — para refrescarlo con un reporte más reciente, correr
  `scripts/generar_tiendas.py` de nuevo.
- Ver `bimbo-tools-especificacion.md` (carpeta raíz) para el resto de
  decisiones pendientes y el roadmap de próximas herramientas.
