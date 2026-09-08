// ============================================================================
// Capa de datos — "Mi Territorio" (mi-territorio.html), la página donde cada
// IBP decide qué tiendas siguen en su lista.
// ----------------------------------------------------------------------------
// El archivo y el nombre interno (BimboDepuracion) se quedaron como estaban
// desde que la página se llamaba "depuración" — es la misma capa de datos,
// solo cambió lo que ve el IBP.
//
// A diferencia de js/data.js (que todavía es local/localStorage), este
// archivo SÍ habla con un backend real: Supabase (proyecto "bimbo-inventory-pro",
// tablas con prefijo propio para no chocar con esa otra app — ver
// scripts/mi_territorio_schema.sql). Todas las tiendas, decisiones (activa/
// inactiva/motivo/frecuencia) y ventas semanales viven ahí, compartidas entre
// todos los IBPs y el admin en vivo — ya no hay exportar/importar .json.
//
// Escritura desde el navegador: solo a través de funciones de Postgres
// (set_tienda_estatus / set_tienda_frecuencia / set_tienda_dias /
// set_tienda_reset) — la tabla en sí no acepta UPDATE directo con la llave
// pública (ver políticas de RLS en el esquema). Cada una de esas funciones
// deja rastro en tiendas_historial (quién — route/admin/corporativo —
// cambió qué y cuándo), consultable con getHistorial().
//
// Autenticación real: ya no hay lectura pública de las tablas — un "route"
// solo ve/edita su propia ruta (profiles.route_code), admin/corporativo ven
// todo. La sesión se resuelve de una de estas formas:
//   - Sesión ya iniciada (login real, o una entrada por token anterior que
//     sigue viva) — getSesionValida() la valida y la cierra sola si pasaron
//     30 días sin actividad (ver INACTIVIDAD_LIMITE_MS). El token de
//     Supabase ya se guarda solo en localStorage (persiste al cerrar el
//     navegador/PWA); este límite es solo un tope de seguridad adicional,
//     no lo que mantiene la sesión — por eso el IBP sigue logueado aunque
//     cierre y abra la app varios días seguidos.
//   - Entrada directa por token de ruta (primeros 7 días desde el primer
//     uso) — reclamarRutaPorToken() crea una sesión anónima y liga el
//     perfil a esa ruta.
//   - Login con correo/contraseña — iniciarSesion().
// ============================================================================

(function () {
const SUPABASE_URL = "https://obfikwhukpzelsghowcq.supabase.co";
const SUPABASE_KEY = "sb_publishable_-qW3XyldNJgpOk6BLReC3A_HIyZHrHM";

// Llave pública VAPID — debe coincidir con la privada embebida en la Edge
// Function enviar-push (scripts/edge_functions/enviar-push.ts). No es
// secreta (viaja al navegador por diseño del protocolo Web Push).
const VAPID_PUBLIC_KEY = "BLFPiseSMlKivquERfG16C4lrY3k-CAedeuECWfscLcJ1VV4XlgcIfAtk0zqeedelXzuS66NfLnrfCruwRHwGhc";

// Sesión cerrada sola tras 30 días sin actividad (clics/teclas) en la
// página — antes eran 6h, muy poco para un IBP que no abre la app a diario;
// el token real ya vive en localStorage y sobrevive a cerrar el navegador
// solo, este límite es un tope de seguridad, no el mecanismo de "recordarme".
const INACTIVIDAD_LIMITE_MS = 30 * 24 * 60 * 60 * 1000;
const LS_ULTIMA_ACTIVIDAD = "bimboUltimaActividad";

// Días de visita posibles — domingo no se pauta, igual que en js/data.js.
const DIAS_SEMANA = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

// Ventana de semanas del reporte — ya NO va hardcodeada: se calcula sola a
// partir de lo que haya en ventas_semanales (función semanas_recientes en
// Postgres), así que subir el reporte de la próxima semana corre la
// ventana sin tocar código. Se carga una vez en init().
let SEMANAS_ETIQUETAS = [];
let SEMANA_INDICE = new Map();

let _client = null;

async function init() {
  if (_client) return;
  // supabase-js viene por CDN (ver <script> en las páginas que usan este
  // módulo) y expone el global `supabase` con createClient.
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  // Cualquier interacción cuenta como actividad, para el cierre de sesión
  // por inactividad — así ninguna página que use este módulo tiene que
  // acordarse de reportarlo por su cuenta.
  ["click", "keydown"].forEach((ev) => document.addEventListener(ev, marcarActividad, { passive: true }));

  const { data, error } = await _client.rpc("semanas_recientes", { p_cantidad: 12 });
  if (!error && data) {
    SEMANAS_ETIQUETAS = data;
    SEMANA_INDICE = new Map(SEMANAS_ETIQUETAS.map((s, i) => [s, i]));
  }
}

// ---------------------------------------------------------------------------
// Sesión / autenticación
// ---------------------------------------------------------------------------

function marcarActividad() {
  try {
    localStorage.setItem(LS_ULTIMA_ACTIVIDAD, String(Date.now()));
  } catch (e) {
    // localStorage puede fallar (modo privado, cuota) — no es crítico.
  }
}

function _pasoElLimiteDeInactividad() {
  try {
    const ultima = Number(localStorage.getItem(LS_ULTIMA_ACTIVIDAD) || 0);
    return !!ultima && Date.now() - ultima > INACTIVIDAD_LIMITE_MS;
  } catch (e) {
    return false;
  }
}

// Revisa si hay una sesión de Supabase viva. Si la hay pero ya pasaron 30
// días sin actividad en la página, la cierra ella misma (para que el
// siguiente intento de entrar pida login/token de nuevo). Devuelve la
// sesión (o null).
async function getSesionValida() {
  const { data } = await _client.auth.getSession();
  const sesion = data && data.session;
  if (!sesion) return null;
  if (_pasoElLimiteDeInactividad()) {
    await _client.auth.signOut();
    return null;
  }
  marcarActividad();
  return sesion;
}

async function iniciarSesion(email, password) {
  const { error } = await _client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login: ${error.message}`);
  marcarActividad();
}

async function cerrarSesion() {
  await _client.auth.signOut();
  try {
    localStorage.removeItem(LS_ULTIMA_ACTIVIDAD);
  } catch (e) {}
}

// Entrada directa por el token de una ruta (mi-territorio.html?t=...) —
// primeros 7 días desde el primer uso de ese token. Crea una sesión anónima
// si hace falta y liga el perfil a esa ruta (role=route, estado=activo).
// Devuelve { ruta, propietario } de la ruta reclamada.
async function reclamarRutaPorToken(token, email) {
  let sesion = (await _client.auth.getSession()).data.session;
  if (!sesion) {
    const { error: errAnon } = await _client.auth.signInAnonymously();
    if (errAnon) throw new Error(`signInAnonymously: ${errAnon.message}`);
  }
  const { data, error } = await _client.rpc("reclamar_ruta_por_token", {
    p_token: token,
    p_email: email || null,
  });
  if (error) throw new Error(`reclamar_ruta_por_token: ${error.message}`);
  marcarActividad();
  return data && data[0] ? data[0] : null;
}

// Perfil (rol/ruta/nombre) del usuario ya autenticado — null si no hay sesión.
async function getPerfilActual() {
  const { data: userData } = await _client.auth.getUser();
  const uid = userData && userData.user && userData.user.id;
  if (!uid) return null;
  const { data, error } = await _client
    .from("profiles")
    .select("id, nombre, role, route_code, email")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return data;
}

// Todos los perfiles "route" (uno por sesión ligada a una ruta) — para que
// admin.html sepa qué correo se reportó en cada ruta durante su semana de
// prueba por token, y a quién invitar. Solo lo pueden ver admin/corporativo
// (RLS de profiles ya existente en bimbo-inventory-pro).
async function getPerfilesRoute() {
  return _checar(
    await _client
      .from("profiles")
      .select("id, nombre, route_code, email, estado, created_at")
      .eq("role", "route")
      .order("created_at", { ascending: false }),
    "profiles"
  );
}

// supabase-js, cuando una Edge Function responde con un status que no es
// 2xx, solo pone en error.message un texto genérico ("Edge Function
// returned a non-2xx status code") — el motivo real que sí mandamos
// nosotros (jsonResponse({error: "..."})) va en el cuerpo de la respuesta,
// que hay que leer aparte (error.context es la Response cruda).
async function _mensajeDeErrorFuncion(error) {
  if (error && error.context && typeof error.context.json === "function") {
    try {
      const cuerpo = await error.context.json();
      if (cuerpo && cuerpo.error) return cuerpo.error;
    } catch (e) {
      // el cuerpo no era JSON (ej. la función se cayó sin responder nada) —
      // nos quedamos con el mensaje genérico de abajo.
    }
  }
  return (error && error.message) || "error desconocido";
}

// Invita por correo a un IBP a crear su cuenta permanente — solo
// admin/corporativo (la función de servidor vuelve a validar esto, no basta
// con que el botón esté oculto en la interfaz). Requiere sesión real.
async function invitarIbp(email, rutaId, nombre) {
  const { data, error } = await _client.functions.invoke("invitar-ibp", {
    body: { email, route_code: rutaId, nombre: nombre || null },
  });
  if (error) throw new Error(`invitar-ibp: ${await _mensajeDeErrorFuncion(error)}`);
  if (data && data.error) throw new Error(`invitar-ibp: ${data.error}`);
  return data;
}

// Para alguien que YA tiene cuenta (correo/contraseña) — le asigna la ruta
// sin invitación ni tocar su contraseña, así entra con su usuario regular.
// Si no existe ninguna cuenta con ese correo, la Edge Function lo rechaza
// (usar invitarIbp en ese caso).
async function asignarRutaACuenta(email, rutaId, nombre) {
  const { data, error } = await _client.functions.invoke("asignar-ruta", {
    body: { email, route_code: rutaId, nombre: nombre || null },
  });
  if (error) throw new Error(`asignar-ruta: ${await _mensajeDeErrorFuncion(error)}`);
  if (data && data.error) throw new Error(`asignar-ruta: ${data.error}`);
  return data;
}

// ---------------------------------------------------------------------------
// Carga del catálogo desde el reporte semanal (admin.html) — solo
// admin/corporativo (RLS + columnas otorgadas del lado de la base lo
// exigen). NUNCA toca estatus/motivo/frecuencia/dias_visita/revisado_en de
// una tienda ni el token de una ruta — eso está bloqueado a nivel de
// permisos de columna en Postgres, no solo por convención aquí.
// ---------------------------------------------------------------------------

const TAMANO_LOTE = 500;

async function _upsertPorLotes(tabla, filas, onConflict) {
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    const { error } = await _client.from(tabla).upsert(lote, { onConflict });
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

// ibps: [{id, propietario, manager}], tiendas: [{id, ibp_id, nombre, ...}],
// ventas: [{tienda_id, semana, unidades}] — ya agregados/calculados por
// quien llama (ver admin.html, que parsea el Excel).
async function cargarCatalogo(ibps, tiendas, ventas) {
  await _upsertPorLotes("ibps", ibps, "id");
  await _upsertPorLotes("tiendas", tiendas, "id");
  await _upsertPorLotes("ventas_semanales", ventas, "tienda_id,semana");
  // La ventana de semanas pudo haberse corrido con datos nuevos.
  const { data, error } = await _client.rpc("semanas_recientes", { p_cantidad: 12 });
  if (!error && data) {
    SEMANAS_ETIQUETAS = data;
    SEMANA_INDICE = new Map(SEMANAS_ETIQUETAS.map((s, i) => [s, i]));
  }
}

function _checar(resultado, contexto) {
  if (resultado.error) {
    console.error(contexto, resultado.error);
    throw new Error(`${contexto}: ${resultado.error.message}`);
  }
  return resultado.data;
}

function getDiasSemana() {
  return DIAS_SEMANA;
}

function getRangoSemanas() {
  return {
    desde: SEMANAS_ETIQUETAS[0],
    hasta: SEMANAS_ETIQUETAS[SEMANAS_ETIQUETAS.length - 1],
    etiquetas: SEMANAS_ETIQUETAS,
  };
}

// Arma el arreglo de 12 posiciones (una por semana) para una tienda a partir
// de las filas de ventas_semanales que le correspondan (las semanas en 0 no
// se guardan en la base, así que empezamos todo en 0 y solo llenamos lo que
// haya).
function _construirSemanas(ventasDeLaTienda) {
  const semanas = new Array(SEMANAS_ETIQUETAS.length).fill(0);
  ventasDeLaTienda.forEach((v) => {
    const idx = SEMANA_INDICE.get(v.semana);
    if (idx != null) semanas[idx] = v.unidades;
  });
  return semanas;
}

function _calcularActividad(semanas) {
  const conActividad = [];
  semanas.forEach((v, i) => {
    if (v !== 0) conActividad.push(i);
  });
  if (!conActividad.length) {
    return { semanasConActividad: 0, ultimaSemanaConActividad: null, semanasDesdeUltimaActividad: semanas.length };
  }
  const ultimoIdx = Math.max(...conActividad);
  return {
    semanasConActividad: conActividad.length,
    ultimaSemanaConActividad: SEMANAS_ETIQUETAS[ultimoIdx],
    semanasDesdeUltimaActividad: semanas.length - 1 - ultimoIdx,
  };
}

// Junta tiendas + sus ventas (ya traídas por separado) y calcula los campos
// derivados (semanas, alertas de actividad). Ordena las más urgentes primero.
function _enriquecerYOrdenar(tiendas, ventasPorTienda) {
  const enriquecidas = tiendas.map((t) => {
    const semanas = _construirSemanas(ventasPorTienda.get(t.id) || []);
    return { ...t, semanas, ...(_calcularActividad(semanas)) };
  });
  enriquecidas.sort((a, b) => {
    if (b.semanasDesdeUltimaActividad !== a.semanasDesdeUltimaActividad) {
      return b.semanasDesdeUltimaActividad - a.semanasDesdeUltimaActividad;
    }
    return a.nombre.localeCompare(b.nombre);
  });
  return enriquecidas;
}

// Supabase/PostgREST limita cada respuesta a 1000 filas por defecto — sin
// paginar, con 360 tiendas x ~8 filas de venta cada una (2895 filas en
// total) la mayoría se quedaba sin traer, y esas tiendas se veían como
// "sin actividad" aunque sí tuvieran ventas (bug real: el admin veía 259
// tiendas "sin actividad 4+ semanas" en vez de las 39 que corresponden).
// Se pagina en bloques hasta traer todo.
async function _ventasDeTiendas(tiendaIds) {
  const porTienda = new Map();
  if (!tiendaIds.length) return porTienda;
  const TAMANO_PAGINA = 1000;
  let desde = 0;
  for (;;) {
    const { data, error } = await _client
      .from("ventas_semanales")
      .select("tienda_id, semana, unidades")
      .in("tienda_id", tiendaIds)
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (error) {
      console.error("ventas_semanales", error);
      throw new Error(`ventas_semanales: ${error.message}`);
    }
    data.forEach((v) => {
      if (!porTienda.has(v.tienda_id)) porTienda.set(v.tienda_id, []);
      porTienda.get(v.tienda_id).push(v);
    });
    if (data.length < TAMANO_PAGINA) break; // última página
    desde += TAMANO_PAGINA;
  }
  return porTienda;
}

// ---------------------------------------------------------------------------
// Rutas (IBPs)
// ---------------------------------------------------------------------------

async function getRutas() {
  const ibps = _checar(
    await _client.from("ibps").select("id, propietario, token, token_primer_uso").order("id"),
    "ibps"
  );
  const tiendas = _checar(await _client.from("tiendas").select("id, ibp_id"), "tiendas (conteo)");
  const conteo = new Map();
  tiendas.forEach((t) => conteo.set(t.ibp_id, (conteo.get(t.ibp_id) || 0) + 1));
  return ibps.map((i) => ({
    ruta: i.id,
    propietario: i.propietario,
    token: i.token,
    tokenPrimerUso: i.token_primer_uso,
    total: conteo.get(i.id) || 0,
  }));
}

async function getRutaInfo(rutaId) {
  const { data, error } = await _client.from("ibps").select("id, propietario").eq("id", rutaId).maybeSingle();
  if (error) throw new Error(`ibps: ${error.message}`);
  return data ? { ruta: data.id, propietario: data.propietario } : null;
}

// Solo lectura (a diferencia de reclamarRutaPorToken, que sí escribe en
// profiles) — para cuando un admin/corporativo YA logueado abre el enlace
// con token de una ruta (ej. el botón "Abrir" de admin.html) y solo quiere
// ver esa ruta, sin que se le reclame el token ni se le toque su propio
// perfil. Bajo RLS, un admin/corporativo puede leer cualquier ibps por
// token; un "route" solo vería la suya (no se usa esta función para ellos).
async function getRutaPorToken(token) {
  const { data, error } = await _client.from("ibps").select("id, propietario").eq("token", token).maybeSingle();
  if (error) throw new Error(`ibps: ${error.message}`);
  return data ? { ruta: data.id, propietario: data.propietario } : null;
}

// ---------------------------------------------------------------------------
// Tiendas de una ruta, con su estatus y ventas ya calculadas
// ---------------------------------------------------------------------------

async function getTiendasConEstado(rutaId) {
  const tiendas = _checar(
    await _client
      .from("tiendas")
      .select("id, nombre, direccion, ciudad, estado_us, zip, tipo_cuenta, productos, estatus, motivo, frecuencia, dias_visita, revisado_en")
      .eq("ibp_id", rutaId),
    "tiendas"
  );
  const ventasPorTienda = await _ventasDeTiendas(tiendas.map((t) => t.id));
  return _enriquecerYOrdenar(tiendas, ventasPorTienda);
}

function getResumenRuta(tiendas) {
  const total = tiendas.length;
  let activas = 0, inactivas = 0, sinRevisar = 0;
  tiendas.forEach((t) => {
    if (!t.estatus) sinRevisar++;
    else if (t.estatus === "activa") activas++;
    else if (t.estatus === "inactiva") inactivas++;
  });
  return { total, activas, inactivas, sinRevisar, revisadas: total - sinRevisar };
}

// ---------------------------------------------------------------------------
// Decisiones del IBP — solo a través de las funciones de Postgres (RLS no
// deja UPDATE directo a la tabla desde la llave pública).
// ---------------------------------------------------------------------------

// estatus: "activa" | "inactiva". El motivo se pide siempre que no sea
// "activa" (cubre tanto "está pausada" como "quiero que se elimine" — ver
// nota en README sobre por qué ya no hay un tercer estatus de "borrar").
//
// Quién hizo el cambio (route/admin/corporativo + su nombre) ya NO lo manda
// el navegador — la función de Postgres lo deriva de la sesión real
// (profiles, vía auth.uid()) y valida que un "route" solo toque tiendas de
// su propia ruta. Ver getHistorial() para consultar ese registro.
async function setEstatus(tiendaId, estatus, motivo) {
  const { error } = await _client.rpc("set_tienda_estatus", {
    p_tienda_id: tiendaId,
    p_estatus: estatus,
    p_motivo: estatus === "activa" ? null : motivo || null,
  });
  if (error) throw new Error(`set_tienda_estatus: ${error.message}`);
}

async function setFrecuencia(tiendaId, frecuencia) {
  const { error } = await _client.rpc("set_tienda_frecuencia", {
    p_tienda_id: tiendaId,
    p_frecuencia: frecuencia,
  });
  if (error) throw new Error(`set_tienda_frecuencia: ${error.message}`);
}

// dias: arreglo de días ("lunes".."sabado") en que se visita la tienda.
async function setDias(tiendaId, dias) {
  const { error } = await _client.rpc("set_tienda_dias", {
    p_tienda_id: tiendaId,
    p_dias: dias,
  });
  if (error) throw new Error(`set_tienda_dias: ${error.message}`);
}

// Reinicio total de una tienda — solo admin.html, y solo admin/corporativo
// (la función de Postgres rechaza a un "route" aunque lo intente). La deja
// "sin revisar", como si nunca la hubieran tocado.
async function resetTienda(tiendaId) {
  const { error } = await _client.rpc("set_tienda_reset", { p_tienda_id: tiendaId });
  if (error) throw new Error(`set_tienda_reset: ${error.message}`);
}

// Historial de cambios de una tienda (más reciente primero) — quién
// (route/admin/corporativo + nombre), qué campo, valor antes/después y
// cuándo. Solo se usa desde admin.html.
async function getHistorial(tiendaId) {
  return _checar(
    await _client
      .from("tiendas_historial")
      .select("id, actor, actor_nombre, campo, valor_anterior, valor_nuevo, creado_en")
      .eq("tienda_id", tiendaId)
      .order("creado_en", { ascending: false }),
    "tiendas_historial"
  );
}

// ---------------------------------------------------------------------------
// Visitas: marca real de que una tienda se visitó en una fecha (agenda del
// IBP) — distinto de dias_visita (el plan). El propio IBP marca/desmarca la
// suya vía las funciones de Postgres; admin.html puede cargar un archivo con
// las ya visitadas (INSERT directo, mismo patrón que cargarCatalogo).
// ---------------------------------------------------------------------------

async function marcarVisitada(tiendaId, fecha) {
  const { error } = await _client.rpc("marcar_tienda_visitada", { p_tienda_id: tiendaId, p_fecha: fecha });
  if (error) throw new Error(`marcar_tienda_visitada: ${error.message}`);
}

async function desmarcarVisitada(tiendaId, fecha) {
  const { error } = await _client.rpc("desmarcar_tienda_visitada", { p_tienda_id: tiendaId, p_fecha: fecha });
  if (error) throw new Error(`desmarcar_tienda_visitada: ${error.message}`);
}

// tiendaIds ya visitadas en esa fecha (para pintar el estado en la agenda).
async function getVisitasDeFecha(tiendaIds, fecha) {
  if (!tiendaIds.length) return new Map();
  const { data, error } = await _client
    .from("visitas")
    .select("tienda_id, visitada_en")
    .eq("fecha", fecha)
    .in("tienda_id", tiendaIds);
  if (error) throw new Error(`visitas: ${error.message}`);
  return new Map(data.map((v) => [v.tienda_id, v.visitada_en]));
}

// admin.html: carga masiva de visitas ya hechas desde un archivo — filas
// [{tienda_id, fecha}] ya armadas por quien llama.
async function cargarVisitas(filas) {
  const conOrigen = filas.map((f) => ({ ...f, origen: "admin_carga" }));
  await _upsertPorLotes("visitas", conOrigen, "tienda_id,fecha");
}

// ---------------------------------------------------------------------------
// Mensajes: admin/corporativo -> una ruta puntual. El IBP los ve (y los
// marca leídos) en su agenda, con aviso emergente si hay alguno sin leer.
// ---------------------------------------------------------------------------

async function enviarMensaje(rutaId, texto, nombreRemitente) {
  const { data: userData } = await _client.auth.getUser();
  const uid = userData && userData.user && userData.user.id;
  const { error } = await _client
    .from("mensajes")
    .insert({ ruta_id: rutaId, texto, creado_por: uid || null, creado_por_nombre: nombreRemitente || null });
  if (error) throw new Error(`mensajes: ${error.message}`);
}

// Mensajes de una ruta, más reciente primero.
async function getMensajes(rutaId) {
  return _checar(
    await _client
      .from("mensajes")
      .select("id, texto, creado_por_nombre, creado_en, leido_en")
      .eq("ruta_id", rutaId)
      .order("creado_en", { ascending: false }),
    "mensajes"
  );
}

async function marcarMensajeLeido(mensajeId) {
  const { error } = await _client.from("mensajes").update({ leido_en: new Date().toISOString() }).eq("id", mensajeId);
  if (error) throw new Error(`mensajes: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Notificaciones push (Web Push) — para que los mensajes le lleguen al IBP
// como notificación real aunque no tenga la página abierta (hoy probado
// contra Android/Chrome, ver README). El registro del Service Worker ya se
// hace en cada página; aquí solo se pide permiso, se suscribe y se guarda.
// ---------------------------------------------------------------------------

function _urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  return Uint8Array.from([...binario].map((c) => c.charCodeAt(0)));
}

function soportaPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// true si ya hay permiso concedido y una suscripción activa guardada.
async function tieneNotificacionesActivas() {
  if (!soportaPush() || Notification.permission !== "granted") return false;
  const registro = await navigator.serviceWorker.getRegistration();
  if (!registro) return false;
  const sub = await registro.pushManager.getSubscription();
  return !!sub;
}

// Pide permiso (si hace falta), crea/recupera la suscripción del navegador
// y la guarda ligada a esta ruta.
async function activarNotificacionesPush(rutaId) {
  if (!soportaPush()) throw new Error("Este navegador no soporta notificaciones push.");

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error("No se dio permiso de notificaciones.");

  const registro = await navigator.serviceWorker.ready;
  let sub = await registro.pushManager.getSubscription();
  if (!sub) {
    sub = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await _client
    .from("push_subscripciones")
    .upsert(
      { ruta_id: rutaId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: "endpoint,ruta_id" }
    );
  if (error) throw new Error(`push_subscripciones: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Vista maestra (admin.html) — todas las tiendas de todas las rutas, en vivo.
// ---------------------------------------------------------------------------

async function getTodasConEstado() {
  const tiendas = _checar(
    await _client
      .from("tiendas")
      .select("id, ibp_id, nombre, direccion, ciudad, estado_us, zip, productos, estatus, motivo, frecuencia, dias_visita, revisado_en")
      .order("ibp_id"),
    "tiendas"
  );
  const ibps = _checar(await _client.from("ibps").select("id, propietario"), "ibps");
  const propietarios = new Map(ibps.map((i) => [i.id, i.propietario]));
  const ventasPorTienda = await _ventasDeTiendas(tiendas.map((t) => t.id));

  return tiendas.map((t) => {
    const semanas = _construirSemanas(ventasPorTienda.get(t.id) || []);
    return {
      ...t,
      ruta: t.ibp_id,
      propietario: propietarios.get(t.ibp_id) || "",
      ...(_calcularActividad(semanas)),
    };
  });
}

window.BimboDepuracion = {
  init,
  getDiasSemana,
  getRangoSemanas,
  getRutas,
  getRutaInfo,
  getTiendasConEstado,
  getResumenRuta,
  setEstatus,
  setFrecuencia,
  setDias,
  resetTienda,
  getHistorial,
  getTodasConEstado,
  // Sesión / autenticación
  marcarActividad,
  getSesionValida,
  iniciarSesion,
  cerrarSesion,
  reclamarRutaPorToken,
  getRutaPorToken,
  getPerfilActual,
  getPerfilesRoute,
  invitarIbp,
  asignarRutaACuenta,
  cargarCatalogo,
  marcarVisitada,
  desmarcarVisitada,
  getVisitasDeFecha,
  cargarVisitas,
  enviarMensaje,
  getMensajes,
  marcarMensajeLeido,
  tieneNotificacionesActivas,
  activarNotificacionesPush,
};
})();
