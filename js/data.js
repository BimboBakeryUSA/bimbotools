// ============================================================================
// Capa de datos — Bimbo Tools / Optimizador de Ruta
// ----------------------------------------------------------------------------
// Fuente de datos HOY: data/seed.json + overrides guardados en localStorage.
// Fuente de datos MAÑANA (cuando se migre): Supabase (Postgres + Auth).
//
// Esta capa expone funciones con nombres estables (getClientes, marcarVisitado,
// moverCliente, etc.) para que las páginas nunca hablen directo con JSON o con
// localStorage. El día que se conecte Supabase, solo se reescribe el CUERPO de
// estas funciones — las páginas no cambian.
// ============================================================================

const SEED_URL = "data/seed.json";
const STORAGE_KEY = "bimbo_tools_estado_v1";

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

let _seed = null; // contenido crudo de seed.json (usuarios, rutas, clientes base)
let _estado = null; // overrides mutables: visitas, movimientos, notificaciones, historial

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------

async function init() {
  if (_seed) return;

  const res = await fetch(SEED_URL);
  _seed = await res.json();

  const guardado = localStorage.getItem(STORAGE_KEY);
  _estado = guardado
    ? JSON.parse(guardado)
    : {
        // clienteId -> { fecha: "YYYY-MM-DD", visitada: bool, timestamp, metodo }
        visitas: {},
        // clienteId -> "lunes" | "martes" | ... (override del día pautado esta semana)
        movimientos: {},
        // historial de cambios: [{ clienteId, de, a, quien, cuando }]
        historial: [],
        // usuarioId -> [{ mensaje, leida, cuando }]
        notificaciones: {},
        // clientes agregados/editados desde el panel admin (carga Excel/CSV o alta manual)
        clientesExtra: [],
        frescuraExtra: {}, // clienteId -> % frescura cargado por admin (sobreescribe el del seed)
        clienteOverrides: {}, // clienteId -> campos editados desde admin (nombre, direccion, rutaId, frecuencia, diasSemana...)
      };

  if (!_estado.clientesExtra) _estado.clientesExtra = [];
  if (!_estado.frescuraExtra) _estado.frescuraExtra = {};
  if (!_estado.clienteOverrides) _estado.clienteOverrides = {};
}

function _guardar() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_estado));
}

function _hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function _diaDeHoy() {
  return DIAS[new Date().getDay()];
}

// ---------------------------------------------------------------------------
// Usuarios / roles
// ---------------------------------------------------------------------------

function getUsuarios() {
  return _seed.usuarios;
}

function getUsuario(id) {
  return _seed.usuarios.find((u) => u.id === id) || null;
}

function getIbpsDeMSL(mslId) {
  const msl = getUsuario(mslId);
  if (!msl) return [];
  return msl.ibpsACargo.map((id) => getUsuario(id)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Clientes y rutas
// ---------------------------------------------------------------------------

function _todosClientes() {
  const combinados = [..._seed.clientes, ..._estado.clientesExtra];
  return combinados.map((c) => {
    let resultado = c;
    // frescura cargada por admin, por encima de la del seed
    if (_estado.frescuraExtra[c.id] !== undefined) resultado = { ...resultado, frescura: _estado.frescuraExtra[c.id] };
    // ediciones hechas desde el panel admin (nombre, dirección, ruta, frecuencia, días...)
    if (_estado.clienteOverrides[c.id]) resultado = { ...resultado, ..._estado.clienteOverrides[c.id] };
    return resultado;
  });
}

function getClientes() {
  return _todosClientes();
}

function getCliente(id) {
  return _todosClientes().find((c) => c.id === id) || null;
}

function getRuta(rutaId) {
  return _seed.rutas.find((r) => r.id === rutaId) || null;
}

function getRutas() {
  return _seed.rutas;
}

function getRutaDeIbp(ibpId) {
  return _seed.rutas.find((r) => r.ibpId === ibpId) || null;
}

function getClientesDeRuta(rutaId) {
  return _todosClientes().filter((c) => c.rutaId === rutaId);
}

// ---------------------------------------------------------------------------
// Alta de clientes (panel admin): manual o por importación CSV/Excel.
// La geocodificación real (dirección -> lat/lng) queda pendiente de una API
// key; por ahora se pide lat/lng directo en el import, o quedan en 0,0
// marcados para corrección manual.
// ---------------------------------------------------------------------------

function agregarClienteAdmin(cliente) {
  const nuevo = {
    id: cliente.id || "c" + Date.now() + Math.floor(Math.random() * 1000),
    nombre: cliente.nombre,
    direccion: cliente.direccion || "",
    lat: cliente.lat != null ? Number(cliente.lat) : 0,
    lng: cliente.lng != null ? Number(cliente.lng) : 0,
    rutaId: cliente.rutaId,
    frecuencia: cliente.frecuencia || "semanal",
    diasSemana: cliente.diasSemana || ["lunes"],
    ultimaVisita: cliente.ultimaVisita || null,
    frescura: cliente.frescura != null ? Number(cliente.frescura) : null,
    geocodificacionPendiente: !cliente.lat || !cliente.lng,
  };
  _estado.clientesExtra.push(nuevo);
  _guardar();
  return nuevo;
}

function cargarFrescuraAdmin(clienteId, porcentaje) {
  _estado.frescuraExtra[clienteId] = Number(porcentaje);
  _guardar();
}

// Edición rápida desde el panel admin: un click, un cambio, se guarda al
// toque (sin formulario ni botón "guardar" aparte). `cambios` es un objeto
// parcial, ej. { diasSemana: ["lunes","jueves"] } o { rutaId: "ruta-sur" }.
function actualizarCliente(clienteId, cambios) {
  _estado.clienteOverrides[clienteId] = { ..._estado.clienteOverrides[clienteId], ...cambios };
  _guardar();
}

// Días efectivos de un cliente esta semana: si tiene un movimiento manual
// (agregar/quitar de hoy, ver más abajo) ese override manda; si no, sus días
// pautados normales. Un cliente BISEMANAL tiene 2 días aquí (ej. lunes y
// jueves) — por eso aparece dos veces en la semana, una por día.
function _diasEfectivos(clienteId) {
  if (_estado.movimientos[clienteId]) return _estado.movimientos[clienteId];
  const cliente = getCliente(clienteId);
  return cliente ? cliente.diasSemana : [];
}

function _tocaEnDia(cliente, dia) {
  return _diasEfectivos(cliente.id).includes(dia);
}

// Fecha calendario (YYYY-MM-DD) que le corresponde a un nombre de día
// ("lunes".."sabado") DENTRO de la semana actual — para poder saber si la
// visita de ese día específico ya se registró (soporta bisemanal: lunes y
// jueves son fechas distintas, con su propio registro de visita).
const _ORDEN_DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function _fechaDeDiaEstaSemana(dia) {
  const idx = _ORDEN_DIAS.indexOf(dia);
  if (idx === -1) return null;
  const lunes = _lunesDeEstaSemana();
  const fecha = new Date(lunes);
  fecha.setDate(lunes.getDate() + idx);
  return fecha.toISOString().slice(0, 10);
}

function _visitaKey(clienteId, fechaISO) {
  return `${clienteId}__${fechaISO}`;
}

function getDiasSemana() {
  // lunes a sábado — domingo no se pauta (día de descanso)
  return ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
}

function getDiaDeHoy() {
  return _diaDeHoy();
}

// ---------------------------------------------------------------------------
// Distancia (haversine) — usado por el ordenador de ruta mientras no haya
// una API de ruteo real conectada (ver ordenarPorVecinoMasCercano más abajo).
// ---------------------------------------------------------------------------

function _distanciaKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// PENDIENTE: reemplazar por Google Directions/Distance Matrix (o Route
// Optimization API) cuando haya API key. Por ahora usa vecino más cercano
// en línea recta, partiendo del punto de arranque de la ruta.
function ordenarPorVecinoMasCercano(puntoPartida, clientes) {
  const restantes = [...clientes];
  const ordenados = [];
  let actual = puntoPartida;

  while (restantes.length) {
    let mejorIdx = 0;
    let mejorDist = Infinity;
    restantes.forEach((c, i) => {
      const d = _distanciaKm(actual, c);
      if (d < mejorDist) {
        mejorDist = d;
        mejorIdx = i;
      }
    });
    const [siguiente] = restantes.splice(mejorIdx, 1);
    ordenados.push(siguiente);
    actual = siguiente;
  }
  return ordenados;
}

// ---------------------------------------------------------------------------
// Ruta del día
// ---------------------------------------------------------------------------

// Devuelve la ruta de un día para un IBP: clientes que tocan ese día (por
// frecuencia o por movimiento manual), ordenados por cercanía, con su estado
// de visita. Si no se pasa `dia`, usa el día real de hoy. Pasar otro día
// (lunes..sabado) sirve para PREVISUALIZAR la semana, no para marcar visitas:
// las visitas y el geofence solo aplican al día real (ver ibp.html).
function getRutaDelDia(ibpId, dia) {
  const diaConsultado = dia || _diaDeHoy();
  const ruta = getRutaDeIbp(ibpId);
  if (!ruta) return { ruta: null, paradas: [], dia: diaConsultado };

  const esHoyReal = diaConsultado === _diaDeHoy();
  const fechaDelDia = _fechaDeDiaEstaSemana(diaConsultado);
  const clientesDelDia = getClientesDeRuta(ruta.id).filter((c) => _tocaEnDia(c, diaConsultado));
  const ordenados = ordenarPorVecinoMasCercano(ruta.puntoPartida, clientesDelDia);

  const paradas = ordenados.map((c, i) => {
    const visita = fechaDelDia ? _estado.visitas[_visitaKey(c.id, fechaDelDia)] : null;
    const visitada = !!(visita && visita.visitada);
    return {
      orden: i + 1,
      cliente: c,
      visitada,
      metodoVisita: visitada ? visita.metodo : null,
      horaVisita: visitada ? visita.timestamp : null,
    };
  });

  return { ruta, paradas, dia: diaConsultado, esHoyReal };
}

// ---------------------------------------------------------------------------
// Confirmar visita (geofence automático o botón manual)
// ---------------------------------------------------------------------------

function marcarVisitado(clienteId, metodo = "manual") {
  const fecha = _hoyISO();
  _estado.visitas[_visitaKey(clienteId, fecha)] = {
    fecha,
    visitada: true,
    metodo, // "geofence" | "manual"
    timestamp: new Date().toISOString(),
  };
  _guardar();
}

function desmarcarVisitado(clienteId) {
  delete _estado.visitas[_visitaKey(clienteId, _hoyISO())];
  _guardar();
}

// ---------------------------------------------------------------------------
// Mover cliente entre días (agregar a hoy quitándolo de su día pautado, o
// sacarlo de hoy). Sigue la regla acordada: se mueve automático y se notifica
// a quien corresponda — nunca pide confirmación previa.
// ---------------------------------------------------------------------------

function agregarClienteAHoy(clienteId, quienHizoElCambio) {
  const cliente = getCliente(clienteId);
  if (!cliente) return;

  const diasAntes = _diasEfectivos(clienteId);
  const diaHoy = _diaDeHoy();
  if (diasAntes.includes(diaHoy)) return; // ya estaba hoy, nada que hacer

  // Nota: mover un cliente reemplaza TODO su patrón de la semana por "hoy"
  // (simplificación — si es bisemanal, su segundo día pautado también se
  // pierde esta semana; pendiente afinar movimientos por ocurrencia).
  _estado.movimientos[clienteId] = [diaHoy];
  _registrarMovimiento(cliente, diasAntes.join(" y ") || "sin día", diaHoy, quienHizoElCambio);
  _guardar();
}

function quitarClienteDeHoy(clienteId, quienHizoElCambio) {
  const cliente = getCliente(clienteId);
  if (!cliente) return;

  const diaHoy = _diaDeHoy();
  // Lo dejamos marcado como "atrasado": no le asignamos día nuevo automático
  // (queda pendiente de definir si se reprograma solo o no — ver spec §3.6).
  _estado.movimientos[clienteId] = ["atrasado"];
  _registrarMovimiento(cliente, diaHoy, "atrasado", quienHizoElCambio);
  _guardar();
}

function _registrarMovimiento(cliente, de, a, quien) {
  const cuando = new Date().toISOString();
  _estado.historial.push({ clienteId: cliente.id, clienteNombre: cliente.nombre, de, a, quien, cuando });

  // Notificar al IBP dueño de la ruta del cliente (aunque el cambio lo haya
  // hecho el MSL) — nunca al revés, y nunca pide confirmación antes.
  const ruta = getRuta(cliente.rutaId);
  if (ruta) {
    _notificar(
      ruta.ibpId,
      `${cliente.nombre} se movió de "${de}" a "${a}" (cambio hecho por ${quien}).`
    );
  }
}

function _notificar(usuarioId, mensaje) {
  if (!_estado.notificaciones[usuarioId]) _estado.notificaciones[usuarioId] = [];
  _estado.notificaciones[usuarioId].unshift({
    mensaje,
    leida: false,
    cuando: new Date().toISOString(),
  });
}

function getNotificaciones(usuarioId) {
  return _estado.notificaciones[usuarioId] || [];
}

function marcarNotificacionesLeidas(usuarioId) {
  (_estado.notificaciones[usuarioId] || []).forEach((n) => (n.leida = true));
  _guardar();
}

function getHistorial() {
  return [..._estado.historial].reverse();
}

// ---------------------------------------------------------------------------
// % de Frescura — cargado por admin, nunca calculado a partir de ventas
// crudas (Doug entrega el % ya calculado por cliente).
// ---------------------------------------------------------------------------

function getFrescuraCliente(clienteId) {
  const c = getCliente(clienteId);
  return c ? c.frescura : null;
}

function getFrescuraRuta(rutaId) {
  const clientes = getClientesDeRuta(rutaId);
  if (!clientes.length) return null;
  const suma = clientes.reduce((acc, c) => acc + (c.frescura || 0), 0);
  return suma / clientes.length;
}

function getFrescuraIbp(ibpId) {
  const ruta = getRutaDeIbp(ibpId);
  return ruta ? getFrescuraRuta(ruta.id) : null;
}

function semaforoFrescura(valor) {
  if (valor === null || valor === undefined) return "gris";
  if (valor >= 0.9) return "verde";
  if (valor >= 0.8) return "amarillo";
  return "rojo";
}

// ---------------------------------------------------------------------------
// Cumplimiento (para el dashboard del MSL)
// ---------------------------------------------------------------------------

function getCumplimientoIbp(ibpId) {
  const { paradas } = getRutaDelDia(ibpId);
  const total = paradas.length;
  const visitadas = paradas.filter((p) => p.visitada).length;
  return { total, visitadas, pendientes: total - visitadas };
}

// ---------------------------------------------------------------------------
// Progreso SEMANAL (para el dashboard del MSL — no solo "hoy").
// Un cliente BISEMANAL cuenta 2 veces (una por cada día pautado) — el total
// semanal es de OCURRENCIAS esperadas esta semana, no de clientes únicos.
// Cada ocurrencia se ubica en su fecha real de la semana, así que la visita
// del lunes y la del jueves de un mismo cliente se registran por separado.
// ---------------------------------------------------------------------------

function _lunesDeEstaSemana() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0=domingo..6=sabado
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + offset);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

// Desglose día por día de la semana (para mostrar el mini gráfico Lun/Mar/
// .../Sáb con cuántos de los clientes pautados ese día ya se visitaron).
function getProgresoSemanalPorDia(ibpId) {
  const ruta = getRutaDeIbp(ibpId);
  if (!ruta) return [];
  const diaHoy = _diaDeHoy();
  return getDiasSemana().map((dia) => {
    const { paradas } = getRutaDelDia(ibpId, dia);
    const visitados = paradas.filter((p) => p.visitada).length;
    return { dia, total: paradas.length, visitados, esHoy: dia === diaHoy };
  });
}

function getProgresoSemanalRuta(rutaId) {
  const ruta = getRuta(rutaId);
  if (!ruta) return { total: 0, visitados: 0, pendientes: 0 };
  let total = 0;
  let visitados = 0;
  getDiasSemana().forEach((dia) => {
    const clientesDia = getClientesDeRuta(rutaId).filter((c) => _tocaEnDia(c, dia));
    const fechaDelDia = _fechaDeDiaEstaSemana(dia);
    clientesDia.forEach((c) => {
      total++;
      const v = _estado.visitas[_visitaKey(c.id, fechaDelDia)];
      if (v && v.visitada) visitados++;
    });
  });
  return { total, visitados, pendientes: total - visitados };
}

function getProgresoSemanalIbp(ibpId) {
  const ruta = getRutaDeIbp(ibpId);
  return ruta ? getProgresoSemanalRuta(ruta.id) : { total: 0, visitados: 0, pendientes: 0 };
}

// ---------------------------------------------------------------------------
// Exportado global simple (sin bundler / sin módulos ES por compatibilidad
// directa desde <script> normal en cada página).
// ---------------------------------------------------------------------------

window.BimboData = {
  init,
  getUsuarios,
  getUsuario,
  getIbpsDeMSL,
  getClientes,
  getCliente,
  getRuta,
  getRutas,
  getRutaDeIbp,
  getClientesDeRuta,
  agregarClienteAdmin,
  actualizarCliente,
  cargarFrescuraAdmin,
  getRutaDelDia,
  getDiasSemana,
  getDiaDeHoy,
  marcarVisitado,
  desmarcarVisitado,
  agregarClienteAHoy,
  quitarClienteDeHoy,
  getNotificaciones,
  marcarNotificacionesLeidas,
  getHistorial,
  getFrescuraCliente,
  getFrescuraRuta,
  getFrescuraIbp,
  semaforoFrescura,
  getCumplimientoIbp,
  getProgresoSemanalRuta,
  getProgresoSemanalIbp,
  getProgresoSemanalPorDia,
};
