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

- `index.html` — portada simple: enlaces a Mi Territorio y a Administrador.
  Ya no lista las rutas (con login real, listarlas públicamente no tendría
  sentido — cada quien entra a la suya, ver "Mi Territorio" abajo).
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
  **Supabase** — ver "Base de datos" abajo. También trae la sesión (login,
  entrada por token, cierre por inactividad) que usan tanto
  `mi-territorio.html` como `admin.html`. El nombre interno
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
- `scripts/edge_functions/invitar-ibp.ts` — la Edge Function que manda la
  invitación real a un IBP (ver "Autenticación" abajo), tal cual está
  desplegada en el proyecto.
- `manifest.json` + `sw.js` + `icons/` — lo que hace la app instalable como
  PWA.

## Mi Territorio (IBP)

Se llama así a propósito: es la lista de tiendas del IBP, no un trámite
administrativo genérico.

### Cómo entra un IBP

Ya no hay login obligatorio desde el primer día — pensado para que un IBP
pueda arrancar sin fricción:

1. El admin le comparte su enlace personal (con un token propio de su ruta,
   no adivinable — `admin.html` → Territorios → "Copiar enlace"). Ese
   enlace lo deja entrar directo, sin pedir contraseña — solo su correo (así
   se sabe quién es, aunque no se verifique todavía).
2. Esa entrada directa funciona repetida durante **7 días** desde la
   primera vez que se usa. Cada sesión dura hasta **6 horas de
   inactividad**; al pasarse, la próxima vez que abra el enlace vuelve a
   entrar directo (mientras siga dentro de esos 7 días).
3. Pasados los 7 días, ese enlace deja de meterlo solo — necesita una
   cuenta real. El admin le manda una invitación por correo (botón
   "Invitar" en `admin.html`, junto al correo que reportó) para que
   elija su propia contraseña; de ahí en adelante entra con
   `mi-territorio.html` a secas, sin token ni parámetro en la URL — su
   sesión ya sabe qué ruta es la suya.

Un admin o corporativo puede además abrir `mi-territorio.html?ruta=0150`
para ver cualquier ruta puntual (soporte) — eso sigue funcionando con login
normal, sin token.

Ahí, por cada tienda:

- La marca **activa** o **inactiva** — inactiva siempre pide el motivo (con
  `prompt`, obligatorio). No hay un estatus aparte de "pedir borrado": pedir
  que se elimine una tienda es simplemente marcarla inactiva y explicar por
  qué en el motivo — es la misma decisión, la diferencia es solo el motivo.
- Elige su **frecuencia de visita**: semanal, 2 veces por semana, quincenal,
  o a pedido del cliente.
- Si la tienda queda activa, marca **qué días** la visita (lunes a sábado,
  domingo no se pauta) con un selector de pastillas.

**Activar es obligatorio hacerlo completo**: no existe una tienda "activa"
sin frecuencia y sin al menos un día — si al tocar "Activa" falta alguno de
los dos, no se guarda nada todavía. La tarjeta entra en un modo guiado:
resalta el campo que falta, hace scroll y foco automático hacia él ("Paso 1
de 2 — elige la frecuencia", luego "Paso 2 de 2 — elige al menos un día") y
recién cuando ambos quedan elegidos se guarda el estatus activa de una vez.
Si en medio de ese proceso el IBP toca "Inactiva", se cancela la activación
pendiente sin dejar nada a medias (como no se había guardado nada aún, no
hay qué deshacer). Si la tienda ya tenía frecuencia y días de una vez
anterior, tocar "Activa" la reactiva directo, sin pasos de por medio. Es la
misma lógica en el modal de edición de `admin.html`. Nota: esto se aplica a
nivel de interfaz (igual que el motivo obligatorio de "inactiva"), no como
restricción a prueba de balas en la base de datos — mismo criterio que el
resto de la app hoy.
- Ve un aviso automático (⚠️) cuando la tienda lleva 4+ semanas sin ventas
  en el periodo del reporte, para priorizar cuáles revisar primero.

Arriba de la lista, un resumen **"Tiendas activas por día"** (lunes a
sábado) cuenta en vivo cuántas tiendas activas se visitan cada día — se
recalcula solo cada vez que el IBP marca una tienda activa o le cambia los
días, para que sepa de un vistazo cómo se le está acomodando la semana. Es
una barra fija (`position: sticky`, igual que el encabezado): vive en su
lugar mientras se ve el tope de la página, y en cuanto el scroll la
alcanza se queda pegada debajo del encabezado ocupando todo el ancho del
teléfono — vuelve sola a su lugar al subir, sin nada de JavaScript de por
medio.

Los cambios se guardan **directo en la base de datos, al toque** — ya no hay
que exportar ni mandarle nada a nadie.

### Vista del admin (`admin.html` → pestaña Territorios)

El admin ve todo en vivo: vista general de todas las rutas (con filtros y
exportación a CSV) y los enlaces por territorio para mandarle a cada IBP el
suyo. A diferencia del IBP, el admin **puede editar cualquier tienda
directamente** desde un botón "Editar" en la tabla — mismo control
(activa/inactiva + motivo, frecuencia, días) que ve el IBP, más dos cosas
que el IBP no tiene:

- **Reiniciar tienda**: borra estatus, motivo, frecuencia y días de un
  golpe — la deja "sin revisar", como si nadie la hubiera tocado. Pensado
  para cuando el admin hace pruebas, o para deshacer un error del IBP antes
  de dejarlo seguir solo.
- **Historial de cambios**: quién cambió qué y cuándo (IBP, o Admin +
  nombre — ver abajo), con el valor antes/después de cada cambio. Solo lo
  ve el admin, dentro del mismo modal de edición.

`admin.html` exige login real (correo/contraseña) de una cuenta `admin` o
`corporativo` — ambos roles ven y editan todo por igual. Quién hizo cada
cambio (columna `actor_nombre` en `tiendas_historial`) ya no lo escribe
nadie a mano: se toma de la sesión real (`profiles.nombre`/`email`), del
lado del servidor — ver "Autenticación" abajo.

## Base de datos (Supabase)

Mi Territorio usa Supabase — tablas `ibps`, `tiendas` (incluye
`dias_visita`, el arreglo de días en que se visita cada tienda activa),
`ventas_semanales` y `tiendas_historial` (el historial de cambios que ve el
admin — quién, qué campo, valor antes/después y cuándo; esquema completo en
`scripts/mi_territorio_schema.sql`). Vive dentro del
proyecto **`bimbo-inventory-pro`** (mismo Supabase, tablas con nombre
propio): la organización tiene tope de 2 proyectos activos en el plan free
y ya estaban ocupados por `bimbo-inventory-pro` y `catalogo-bimbo`, así que
se reusó ese en vez de crear uno nuevo. Si más adelante hace falta separarlo
a su propio proyecto, es cuestión de correr ese mismo `.sql` ahí y copiar
los datos — son tablas Postgres normales, no hay nada que las ate para
siempre a estar juntas.

### Autenticación (real, compartida con el resto de la suite)

Mi Territorio usa el mismo sistema de cuentas que ya tenía
`bimbo-inventory-pro` (`auth.users` de Supabase + tabla `profiles` con
`role`: `admin` / `corporativo` / `route`, y `route_code` para saber a qué
ruta pertenece un `route`). No se inventó nada nuevo — se reutilizan tal
cual las funciones `current_user_role()`/`current_user_route_code()` que ya
usan `products`/`scan_sessions` en esa misma app.

**Lectura (RLS):** ya no hay lectura pública. Un `route` solo ve
`ibps`/`tiendas`/`ventas_semanales` de su propia ruta (`route_code`);
`admin`/`corporativo` ven todo; sin sesión, cero filas. `tiendas_historial`
solo lo ven `admin`/`corporativo` (el IBP no ve el historial).

**Escritura:** sigue sin haber `UPDATE` directo a las tablas — pasa por
funciones de Postgres (`set_tienda_estatus`, `set_tienda_frecuencia`,
`set_tienda_dias`, `set_tienda_reset`), cada una dejando su registro en
`tiendas_historial`. La diferencia con antes: quién hizo el cambio ya no lo
manda el navegador — la función lo deriva del lado del servidor a partir de
la sesión real, y valida que un `route` solo pueda tocar tiendas de su
propia ruta (si intenta otra, lo rechaza). `set_tienda_reset` es exclusivo
de `admin`/`corporativo`.

**Entrada directa por token** (ver "Cómo entra un IBP" arriba): cada ruta
tiene un token propio, no adivinable, guardado en `ibps.token`. La función
`reclamar_ruta_por_token` valida que no hayan pasado más de 7 días desde su
primer uso y, si es válido, crea una sesión anónima real de Supabase y le
asigna `role: route` + esa ruta en `profiles` — desde ahí funciona igual
que cualquier sesión logueada, sujeta a las mismas reglas de RLS de arriba.

**Invitar a un IBP a registrarse:** botón en `admin.html`, respaldado por
una Edge Function (`invitar-ibp`) que corre del lado del servidor — es la
única pieza que usa la llave de servicio de Supabase (nunca viaja al
navegador), y antes de hacer nada verifica que quien la llama sea
`admin`/`corporativo`.

**Refrescar el catálogo** (nuevo reporte de ventas): correr
`scripts/generar_tiendas.py` para regenerar `data/tiendas.json`, y de ahí
pedirle a Claude (con acceso a Supabase) que aplique el refresh a las tablas
— hoy no hay un botón para hacerlo solo, es un paso asistido.

## Estado actual

- **Mi Territorio** (`mi-territorio.html`, `index.html`, y la pestaña
  Territorios de `admin.html`): en vivo sobre Supabase, con autenticación
  real (ver arriba) — esto ya no es una demo local.
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
- **Autenticación real**: resuelto para Mi Territorio (ver "Autenticación"
  arriba) — lectura y escritura ya están atadas a la sesión real, no a
  quien tenga un link. La demo vieja (`ibp.html`/`msl.html`) sigue sin
  login, simula el rol eligiendo el usuario de una lista — no se migró
  (ver siguiente punto).
- **Vista admin vs. vista IBP**: resuelto — con la sesión real, un `route`
  siempre ve su propia ruta (nunca lo que venga en la URL) y un
  `admin`/`corporativo` puede además soportar cualquier ruta puntual con
  `?ruta=`. `admin.html` tiene su propia forma de editar (modal con
  historial + reinicio).
- **`profiles.estado` (`pendiente`/`activo`)**: existe en el esquema
  compartido pero Mi Territorio no lo usa como filtro todavía — una cuenta
  `route` creada por `reclamar_ruta_por_token` o por la invitación del admin
  nace `activo` directo (el token o la invitación ya son la vetación). Si
  más adelante se necesita un flujo de aprobación manual adicional, ese
  campo ya está listo para usarse como gate.
- El resto de la app (ibp/msl/admin fuera de Territorios) todavía no
  se migra a Supabase — sigue en `localStorage`.
- Ver `bimbo-tools-especificacion.md` (carpeta raíz) para el resto de
  decisiones pendientes y el roadmap de próximas herramientas.
