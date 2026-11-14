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
  frescura, ver historial de movimientos.
- `js/data.js` — **capa de datos abstraída**. Todas las páginas hablan con
  este archivo, nunca directo con JSON/localStorage. El día que se conecte
  Supabase, solo se reescribe el cuerpo de estas funciones — las páginas
  no cambian.
- `js/geo.js` — geofence (confirmación automática de visita por GPS).
- `data/seed.json` — datos de ejemplo (usuarios, rutas, clientes).
- `manifest.json` + `sw.js` + `icons/` — lo que hace la app instalable como
  PWA.

## Pedido sugerido + asistente (IBP)

- En `ibp.html`, cada tienda tiene **Ver pedido**: por cada producto que le toca
  según su formato (Small/Large Format) y la clase del producto (A/B/C), muestra
  la venta del año base en esa misma semana, el % de crecimiento y cuánto
  **pedir para superarla**: `pedido = siguiente entero > venta × (1 + %)`
  (100 × 9.9% → 110; 100 × 10% → 111). Por defecto muestra la semana siguiente
  a la actual.
- **Asistente**: avisa de productos que le tocan a la tienda y no se dejan
  ("Colocar", con cantidad inicial = mediana de tiendas del mismo formato),
  que llevan 4 semanas en cero ("Recuperar") o que cayeron más de 20% ("Bajando").
- Admin → pestaña **Ventas y productos**: importar ventas
  (`clienteId,sku,semana,unidades`), productos (`sku,nombre,clase,crecimiento`),
  ajustar el % por producto y qué clases aplican a cada formato. El formato de
  cada tienda se edita en la pestaña Clientes.
- `data/seed.json` trae productos y ventas **de ejemplo**, con algunos huecos
  a propósito para que el asistente tenga qué sugerir.

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
- Ver `bimbo-tools-especificacion.md` (carpeta raíz) para el resto de
  decisiones pendientes y el roadmap de próximas herramientas.
