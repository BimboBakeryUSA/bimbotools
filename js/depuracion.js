// ============================================================================
// Capa de datos — "Mi Territorio" (mi-territorio.html), la página donde cada
// IBP decide qué tiendas siguen en su lista.
// ----------------------------------------------------------------------------
// El archivo y el nombre interno (BimboDepuracion) se quedaron como estaban
// al renombrar la página — es la misma capa de datos, solo cambió lo que ve
// el IBP.
//
// Catálogo (solo lectura): data/tiendas.json, generado una vez a partir del
// reporte "Central List / Account L4 / Route / Product Name" (12 semanas).
// Trae, por tienda: dueño de ruta, nombre, dirección y su historial de ventas
// semana a semana — usado para avisar qué tiendas llevan tiempo sin actividad.
//
// Estado (mutable): decisiones del IBP — activa/inactiva/solicitar salida,
// motivo, frecuencia de visita, notas — guardadas en localStorage bajo la
// clave `storageKey` que recibe init(). Cada página elige su propia clave:
//   - mi-territorio.html -> clave del dispositivo del IBP (su propio territorio)
//   - admin.html         -> clave separada, alimentada por los archivos que
//                            cada IBP exporta y el admin importa ahí
// Esto es igual de "local por ahora, Supabase después" que js/data.js — ver
// README para el plan de centralizar sin depender de importar/exportar.
// ============================================================================

// Todo dentro de un IIFE: este archivo se carga junto con js/data.js en la
// misma página (admin.html) y, como son <script> planos (sin módulos), sin
// esto sus variables de nivel superior (_estado, init, _guardar...)
// chocarían con las de mismo nombre en js/data.js.
(function () {
const TIENDAS_URL = "data/tiendas.json";
const DEFAULT_STORAGE_KEY = "bimbo_tools_depuracion_v1";

let _catalogo = null; // contenido crudo de data/tiendas.json
let _estado = null; // { tiendas: { [tiendaId]: { estatus, motivo, frecuencia, notas, revisadoEn } } }
let _storageKey = DEFAULT_STORAGE_KEY;

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------

async function init(storageKey) {
  _storageKey = storageKey || DEFAULT_STORAGE_KEY;

  if (!_catalogo) {
    const res = await fetch(TIENDAS_URL);
    _catalogo = await res.json();
  }

  const guardado = localStorage.getItem(_storageKey);
  _estado = guardado ? JSON.parse(guardado) : { tiendas: {} };
  if (!_estado.tiendas) _estado.tiendas = {};
}

function _guardar() {
  localStorage.setItem(_storageKey, JSON.stringify(_estado));
}

// ---------------------------------------------------------------------------
// Catálogo (rutas y tiendas, tal cual vienen del reporte)
// ---------------------------------------------------------------------------

function getRangoSemanas() {
  return _catalogo.rangoSemanas;
}

function getRutas() {
  return _catalogo.rutas.map((r) => ({ ruta: r.ruta, propietario: r.propietario, total: r.tiendas.length }));
}

function getRutaCruda(rutaId) {
  return _catalogo.rutas.find((r) => r.ruta === rutaId) || null;
}

// ---------------------------------------------------------------------------
// Estatus de depuración por tienda (activa / inactiva / borrar / sin revisar)
// ---------------------------------------------------------------------------

function _estatusPorDefecto() {
  return { estatus: null, motivo: "", frecuencia: "", notas: "", revisadoEn: null };
}

function getEstatusTienda(tiendaId) {
  return { ..._estatusPorDefecto(), ...(_estado.tiendas[tiendaId] || {}) };
}

function _tocar(tiendaId) {
  if (!_estado.tiendas[tiendaId]) _estado.tiendas[tiendaId] = _estatusPorDefecto();
  _estado.tiendas[tiendaId].revisadoEn = new Date().toISOString();
  return _estado.tiendas[tiendaId];
}

// estatus: "activa" | "inactiva" | "borrar". El motivo se pide siempre que no
// sea "activa" — se limpia si vuelve a marcarse activa.
function setEstatus(tiendaId, estatus, motivo) {
  const t = _tocar(tiendaId);
  t.estatus = estatus;
  t.motivo = estatus === "activa" ? "" : motivo || "";
  _guardar();
}

function setFrecuencia(tiendaId, frecuencia) {
  const t = _tocar(tiendaId);
  t.frecuencia = frecuencia;
  _guardar();
}

function setNotas(tiendaId, notas) {
  const t = _tocar(tiendaId);
  t.notas = notas;
  _guardar();
}

function getTiendasConEstado(rutaId) {
  const ruta = getRutaCruda(rutaId);
  if (!ruta) return [];
  return ruta.tiendas.map((t) => ({ ...t, _estatus: getEstatusTienda(t.id) }));
}

function getResumenRuta(rutaId) {
  const tiendas = getTiendasConEstado(rutaId);
  const total = tiendas.length;
  let activas = 0, inactivas = 0, borrar = 0, sinRevisar = 0;
  tiendas.forEach((t) => {
    if (!t._estatus.estatus) sinRevisar++;
    else if (t._estatus.estatus === "activa") activas++;
    else if (t._estatus.estatus === "inactiva") inactivas++;
    else if (t._estatus.estatus === "borrar") borrar++;
  });
  return { total, activas, inactivas, borrar, sinRevisar, revisadas: total - sinRevisar };
}

// ---------------------------------------------------------------------------
// Exportar / importar — puente manual mientras no hay backend compartido.
// El IBP exporta un .json con las decisiones de SU ruta; el admin lo importa
// en admin.html y ahí se acumulan todas las rutas en una sola vista maestra.
// ---------------------------------------------------------------------------

function exportarRuta(rutaId) {
  const ruta = getRutaCruda(rutaId);
  const tiendas = getTiendasConEstado(rutaId);
  return {
    tipo: "bimbo-tools-depuracion",
    version: 1,
    ruta: rutaId,
    propietario: ruta ? ruta.propietario : "",
    exportadoEn: new Date().toISOString(),
    tiendas: tiendas.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      direccion: t.direccion,
      ciudad: t.ciudad,
      estadoUS: t.estado,
      zip: t.zip,
      semanasDesdeUltimaActividad: t.semanasDesdeUltimaActividad,
      estatus: t._estatus.estatus,
      motivo: t._estatus.motivo,
      frecuencia: t._estatus.frecuencia,
      notas: t._estatus.notas,
      revisadoEn: t._estatus.revisadoEn,
    })),
  };
}

// Combina un archivo exportado por un IBP dentro del namespace actual
// (pensado para usarse desde admin.html). Si ya había algo guardado para esa
// tienda, se queda con lo más reciente (por revisadoEn) para no pisar una
// edición más nueva hecha directo en el panel admin.
function importarExportacion(payload) {
  if (!payload || !Array.isArray(payload.tiendas)) return { importadas: 0, total: 0 };
  let importadas = 0;
  payload.tiendas.forEach((t) => {
    if (!t.id) return;
    if (!t.estatus && !t.frecuencia && !t.notas) return; // el IBP no tocó esta tienda, nada que importar
    const actual = _estado.tiendas[t.id];
    const fechaActual = actual && actual.revisadoEn ? new Date(actual.revisadoEn).getTime() : 0;
    const fechaNueva = t.revisadoEn ? new Date(t.revisadoEn).getTime() : 0;
    if (actual && fechaActual >= fechaNueva) return;
    _estado.tiendas[t.id] = {
      estatus: t.estatus || null,
      motivo: t.motivo || "",
      frecuencia: t.frecuencia || "",
      notas: t.notas || "",
      revisadoEn: t.revisadoEn || null,
      _rutaOrigen: payload.ruta,
      _propietarioOrigen: payload.propietario,
    };
    importadas++;
  });
  _guardar();
  return { importadas, total: payload.tiendas.length };
}

// Todas las tiendas de todas las rutas del catálogo, con el estatus guardado
// en el namespace actual — para la vista maestra del admin.
function getTodasConEstado() {
  const out = [];
  _catalogo.rutas.forEach((r) => {
    r.tiendas.forEach((t) => out.push({ ...t, _estatus: getEstatusTienda(t.id) }));
  });
  return out;
}

window.BimboDepuracion = {
  init,
  getRangoSemanas,
  getRutas,
  getRutaCruda,
  getEstatusTienda,
  getTiendasConEstado,
  setEstatus,
  setFrecuencia,
  setNotas,
  getResumenRuta,
  exportarRuta,
  importarExportacion,
  getTodasConEstado,
};
})();
