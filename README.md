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

**Datos (4 fuentes separadas, se cruzan por número de tienda y SKU)** — Admin →
pestaña *Datos de venta*, cada una acepta Excel (.xlsx) o CSV con encabezados
flexibles:

1. Ventas: `tienda, sku, semana, unidades`
2. Formato de tienda: `tienda, formato` (SF / LF)
3. Tier de tienda: `tienda, tier` (1 / 2 / 3)
4. Productos: `sku, nombre, clase, crecimiento` (A / B / C / Innovación)

Cada import avisa qué tiendas no cruzan con Clientes y qué valores no reconoce.

**Pedido**: por producto que le toca a la tienda según formato + clase,
`pedido = siguiente entero > venta(año base, misma semana) × (1 + %)`
(100 × 9.9% → 110; 100 × 10% → 111).

**Asistente** (mensajes calculados, no se consumen al verlos):
- *Meta*: cuánto pedir para superar la semana del año base.
- *Innovación*: producto de innovación que la tienda no tiene → cantidad =
  mediana de tiendas del mismo formato y tier que ya lo venden; si nadie lo
  vende aún, tabla editable formato × tier.
- *Colocar*: le toca por formato y no se deja en todo el año.
- *Recuperar*: 4 semanas sin venta. *Bajando*: cayó más de 20%.

**Tiendas sin visita**: al abrir la app, el IBP ve las tiendas de su ruta con
más de 14 días sin visita (configurable en admin), de la más atrasada a la
menos, con botón "Agregar a hoy". Última visita = la más reciente entre la
fecha importada (Admin → Datos de venta → *Última visita*, opcional) y las
visitas marcadas en la app. "Ocultar por hoy" solo aplica a ese teléfono.

**Vista previa del admin** (pestaña *Mensajes del IBP*): elige IBP y semana y ve
exactamente lo mismo que el IBP, más sus notificaciones. Es solo lectura: no
marca nada como leído.

Lector de Excel: SheetJS 0.18.5 incluido en `js/vendor/` (Apache-2.0).
`data/seed.json` trae datos de ejemplo con huecos a propósito.

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
