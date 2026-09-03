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
// Escritura desde el navegador: solo a través de dos funciones de Postgres
// (set_tienda_estatus / set_tienda_frecuencia) — la tabla en sí no acepta
// UPDATE directo con la llave pública (ver políticas de RLS en el esquema).
// ============================================================================

(function () {
const SUPABASE_URL = "https://obfikwhukpzelsghowcq.supabase.co";
const SUPABASE_KEY = "sb_publishable_-qW3XyldNJgpOk6BLReC3A_HIyZHrHM";

// Semanas del reporte con el que se sembró la base (12 semanas, W24–W35 de
// 2026). Si se carga un reporte más nuevo con otro rango, actualizar esta
// lista junto con scripts/generar_tiendas.py.
const SEMANAS_ETIQUETAS = [
  "24/2026", "25/2026", "26/2026", "27/2026", "28/2026", "29/2026",
  "30/2026", "31/2026", "32/2026", "33/2026", "34/2026", "35/2026",
];
const SEMANA_INDICE = new Map(SEMANAS_ETIQUETAS.map((s, i) => [s, i]));

let _client = null;

async function init() {
  if (_client) return;
  // supabase-js viene por CDN (ver <script> en las páginas que usan este
  // módulo) y expone el global `supabase` con createClient.
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

function _checar(resultado, contexto) {
  if (resultado.error) {
    console.error(contexto, resultado.error);
    throw new Error(`${contexto}: ${resultado.error.message}`);
  }
  return resultado.data;
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

async function _ventasDeTiendas(tiendaIds) {
  const porTienda = new Map();
  if (!tiendaIds.length) return porTienda;
  const datos = _checar(
    await _client.from("ventas_semanales").select("tienda_id, semana, unidades").in("tienda_id", tiendaIds),
    "ventas_semanales"
  );
  datos.forEach((v) => {
    if (!porTienda.has(v.tienda_id)) porTienda.set(v.tienda_id, []);
    porTienda.get(v.tienda_id).push(v);
  });
  return porTienda;
}

// ---------------------------------------------------------------------------
// Rutas (IBPs)
// ---------------------------------------------------------------------------

async function getRutas() {
  const ibps = _checar(await _client.from("ibps").select("id, propietario").order("id"), "ibps");
  const tiendas = _checar(await _client.from("tiendas").select("id, ibp_id"), "tiendas (conteo)");
  const conteo = new Map();
  tiendas.forEach((t) => conteo.set(t.ibp_id, (conteo.get(t.ibp_id) || 0) + 1));
  return ibps.map((i) => ({ ruta: i.id, propietario: i.propietario, total: conteo.get(i.id) || 0 }));
}

async function getRutaInfo(rutaId) {
  const { data, error } = await _client.from("ibps").select("id, propietario").eq("id", rutaId).maybeSingle();
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
      .select("id, nombre, direccion, ciudad, estado_us, zip, tipo_cuenta, productos, estatus, motivo, frecuencia, revisado_en")
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

// ---------------------------------------------------------------------------
// Vista maestra (admin.html) — todas las tiendas de todas las rutas, en vivo.
// ---------------------------------------------------------------------------

async function getTodasConEstado() {
  const tiendas = _checar(
    await _client
      .from("tiendas")
      .select("id, ibp_id, nombre, direccion, ciudad, estado_us, zip, productos, estatus, motivo, frecuencia, revisado_en")
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
  getRangoSemanas,
  getRutas,
  getRutaInfo,
  getTiendasConEstado,
  getResumenRuta,
  setEstatus,
  setFrecuencia,
  getTodasConEstado,
};
})();
