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
  // Rutas e IBPs dados de alta desde admin (por número de ruta, ej. 5532).
  if (!_estado.rutasExtra) _estado.rutasExtra = [];
  if (!_estado.usuariosExtra) _estado.usuariosExtra = [];
  if (!_estado.ibpsExtraDeMSL) _estado.ibpsExtraDeMSL = {}; // mslId -> [ibpId]
  // Pedido sugerido (ver sección más abajo). Todo lo importado desde admin
  // reemplaza al seed de ejemplo.
  if (_estado.ventasImportadas === undefined) _estado.ventasImportadas = null; // { clienteId: { sku: [s1..s53] } }
  if (_estado.productosImportados === undefined) _estado.productosImportados = null; // [{ sku, nombre, clase, crecimiento }]
  if (!_estado.crecimientoOverrides) _estado.crecimientoOverrides = {}; // sku -> 0.099
  if (!_estado.configOverrides) _estado.configOverrides = {}; // { anioBase, crecimientoDefault, reglasFormato }
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
  return [..._seed.usuarios, ..._estado.usuariosExtra];
}

function getUsuario(id) {
  return getUsuarios().find((u) => u.id === id) || null;
}

function getIbpsDeMSL(mslId) {
  const msl = getUsuario(mslId);
  if (!msl) return [];
  const ids = [...(msl.ibpsACargo || []), ...(_estado.ibpsExtraDeMSL[mslId] || [])];
  return ids.map((id) => getUsuario(id)).filter(Boolean);
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

function getRutas() {
  return [..._seed.rutas, ..._estado.rutasExtra];
}

function getRuta(rutaId) {
  return getRutas().find((r) => r.id === rutaId) || null;
}

function getRutaDeIbp(ibpId) {
  return getRutas().find((r) => r.ibpId === ibpId) || null;
}

// Alta de ruta por su número (el mismo del sistema de Bimbo, ej. "5532") con
// su IBP. El id de la ruta ES el número, así los clientes importados con
// rutaId = 5532 quedan asignados solos.
function agregarRuta({ numero, ibpNombre, mslId }) {
  const num = String(numero || "").trim();
  if (!num) throw new Error("Falta el número de ruta.");
  if (getRuta(num)) throw new Error(`La ruta ${num} ya existe.`);
  const ibpId = "ibp-" + num;
  _estado.usuariosExtra.push({ id: ibpId, nombre: (ibpNombre || "").trim() || `IBP ${num}`, rol: "IBP", rutaId: num });
  _estado.rutasExtra.push({ id: num, numero: num, nombre: `Ruta ${num}`, ibpId, puntoPartida: null });
  if (mslId) _estado.ibpsExtraDeMSL[mslId] = [...(_estado.ibpsExtraDeMSL[mslId] || []), ibpId];
  _guardar();
  return getRuta(num);
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
    formato: _normFormato(cliente.formato) || "SF", // SF = Small Format, LF = Large Format
    tier: _normTier(cliente.tier), // 1, 2 o 3 (null = sin tier)
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
  // Sin punto de partida cargado, arranca desde la primera tienda del día.
  const ordenados = clientesDelDia.length
    ? ordenarPorVecinoMasCercano(ruta.puntoPartida || clientesDelDia[0], clientesDelDia)
    : [];

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
// Pedido sugerido por tienda (meta del año siguiente, misma semana)
// ----------------------------------------------------------------------------
// La información llega en 4 fuentes SEPARADAS que aquí se cruzan por llave:
//   1. Ventas            → tienda + sku + semana + unidades
//   2. Formato de tienda → tienda + SF / LF
//   3. Tier de tienda    → tienda + 1 / 2 / 3
//   4. Productos         → sku + nombre + clase (A / B / C / I = Innovación) + % crecimiento
//
// Regla del pedido: para la semana W del año meta (anioBase + 1), el IBP pide
// en la semana W-1 lo suficiente para SUPERAR lo vendido en la semana W del
// año base, más el % de crecimiento del producto.
//   meta   = venta(anioBase, W) × (1 + crecimiento)
//   pedido = siguiente entero que supera la meta
//   ej. 100 × 1.099 = 109.9 → pedir 110;  100 × 1.10 = 110 → pedir 111
// Qué productos ve cada tienda: config.reglasFormato[formato] = clases.
// ---------------------------------------------------------------------------

const CLASES = { A: "A", B: "B", C: "C", I: "Innovación" };

// Cantidad a colocar de un producto de innovación cuando nadie comparable
// lo vende todavía. Editable en admin.
const _INNOVACION_DEFAULT = {
  LF: { 1: 12, 2: 8, 3: 6 },
  SF: { 1: 6, 2: 4, 3: 2 },
};

function getConfigPedido() {
  const base = _seed.config || {};
  const o = _estado.configOverrides;
  return {
    anioBase: o.anioBase || base.anioBase || 2026,
    crecimientoDefault: o.crecimientoDefault != null ? o.crecimientoDefault : base.crecimientoDefault != null ? base.crecimientoDefault : 0.1,
    reglasFormato: o.reglasFormato || base.reglasFormato || { SF: ["A", "B", "I"], LF: ["A", "B", "C", "I"] },
    innovacion: o.innovacion || base.innovacion || _INNOVACION_DEFAULT,
    diasSinVisita: o.diasSinVisita || base.diasSinVisita || 14,
  };
}

function actualizarConfigPedido(cambios) {
  _estado.configOverrides = { ..._estado.configOverrides, ...cambios };
  _guardar();
}

// --- Normalización de archivos (CSV o Excel, encabezados como vengan) ------

function _norm(txt) {
  return String(txt == null ? "" : txt)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Busca el valor de una columna aceptando varios nombres posibles.
function _col(fila, nombres) {
  const claves = Object.keys(fila);
  for (const n of nombres) {
    const k = claves.find((c) => _norm(c) === _norm(n));
    if (k !== undefined && fila[k] !== "" && fila[k] != null) return String(fila[k]).trim();
  }
  return "";
}

const _COL_TIENDA = ["clienteId", "cliente", "tienda", "store", "storeid", "storenumber", "notienda", "numerotienda", "id"];
const _COL_SKU = ["sku", "producto", "product", "item", "codigo", "upc"];

function _normClase(valor) {
  const v = _norm(valor);
  if (v.startsWith("inn") || v === "i" || v === "new" || v === "nuevo") return "I";
  const letra = v.toUpperCase();
  return ["A", "B", "C"].includes(letra) ? letra : null;
}

function _normFormato(valor) {
  const v = _norm(valor);
  if (v === "lf" || v.startsWith("large") || v.startsWith("grande")) return "LF";
  if (v === "sf" || v.startsWith("small") || v.startsWith("chic") || v.startsWith("peque")) return "SF";
  return null;
}

function _normTier(valor) {
  const n = parseInt(String(valor).replace(/\D/g, ""), 10);
  return n >= 1 && n <= 3 ? n : null;
}

// --- Productos ---------------------------------------------------------------

function getProductos() {
  const lista = _estado.productosImportados || _seed.productos || [];
  const { crecimientoDefault } = getConfigPedido();
  return lista.map((p) => {
    const g = _estado.crecimientoOverrides[p.sku];
    return { ...p, crecimiento: g != null ? g : p.crecimiento != null ? p.crecimiento : crecimientoDefault };
  });
}

function setCrecimientoProducto(sku, crecimiento) {
  _estado.crecimientoOverrides[sku] = Number(crecimiento);
  _guardar();
}

function getProductosParaCliente(clienteId) {
  const cliente = getCliente(clienteId);
  if (!cliente) return [];
  const clases = getConfigPedido().reglasFormato[cliente.formato] || [];
  return getProductos().filter((p) => clases.includes(p.clase));
}

// --- Ventas ----------------------------------------------------------------

function _ventas() {
  return _estado.ventasImportadas || _seed.ventas || {};
}

function getVentaSemana(clienteId, sku, semana) {
  const serie = (_ventas()[clienteId] || {})[sku];
  if (!serie) return null;
  const v = serie[semana - 1];
  return v == null ? null : v;
}

// Siguiente entero que SUPERA la meta (no la iguala). El épsilon evita que
// 100 × 1.1 = 110.00000000000001 cuente como "más de 110".
function _pedidoParaSuperar(meta) {
  return Math.floor(meta + 1e-9) + 1;
}

// Semana ISO (1..53) de una fecha.
function _semanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - inicio) / 86400000 + 1) / 7);
}

// La semana que se está pidiendo HOY es la siguiente a la actual.
function getSemanaObjetivoSugerida() {
  const s = _semanaISO(new Date()) + 1;
  return s > 52 ? 1 : s;
}

// --- Cantidad a colocar cuando la tienda NO tiene historial del producto ----
// 1) mediana de tiendas del mismo formato Y tier que sí lo venden esa semana
// 2) si no hay, mediana de tiendas del mismo formato
// 3) si es innovación y nadie lo vende aún: tabla config.innovacion[formato][tier]
function _mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function _ventasPares(cliente, sku, semana, mismoTier) {
  const ventas = _ventas();
  return _todosClientes()
    .filter((c) => c.id !== cliente.id && c.formato === cliente.formato && (!mismoTier || c.tier === cliente.tier))
    .map((c) => ((ventas[c.id] || {})[sku] || [])[semana - 1] || 0)
    .filter((v) => v > 0);
}

function getCantidadAColocar(clienteId, sku, semana) {
  const cliente = getCliente(clienteId);
  const producto = getProductos().find((p) => p.sku === sku);
  if (!cliente || !producto) return null;
  let med = cliente.tier ? _mediana(_ventasPares(cliente, sku, semana, true)) : null;
  let fuente = med != null ? "tiendas iguales" : null;
  if (med == null) {
    med = _mediana(_ventasPares(cliente, sku, semana, false));
    if (med != null) fuente = "mismo formato";
  }
  if (med == null && producto.clase === "I") {
    const tabla = getConfigPedido().innovacion[cliente.formato] || {};
    med = tabla[cliente.tier || 3];
    if (med != null) fuente = "tabla de innovación";
  }
  return med == null ? null : { cantidad: Math.ceil(med), fuente };
}

function getPedidoSugerido(clienteId, semana) {
  const { anioBase } = getConfigPedido();
  const lineas = getProductosParaCliente(clienteId).map((p) => {
    const venta = getVentaSemana(clienteId, p.sku, semana);
    const meta = venta != null && venta > 0 ? venta * (1 + p.crecimiento) : null;
    const colocar = meta == null ? getCantidadAColocar(clienteId, p.sku, semana) : null;
    return {
      producto: p,
      ventaBase: venta,
      meta,
      pedido: meta != null ? _pedidoParaSuperar(meta) : colocar ? colocar.cantidad : null,
      esNuevo: meta == null && !!colocar,
    };
  });
  const totalBase = lineas.reduce((a, l) => a + (l.ventaBase || 0), 0);
  const totalPedido = lineas.reduce((a, l) => a + (l.pedido || 0), 0);
  // La meta solo cuenta productos con historial; lo nuevo a colocar va aparte.
  const totalMeta = lineas.reduce((a, l) => a + (l.esNuevo ? 0 : l.pedido || 0), 0);
  const totalNuevos = totalPedido - totalMeta;
  return { semana, anioBase, anioMeta: anioBase + 1, lineas, totalBase, totalPedido, totalMeta, totalNuevos };
}

// ---------------------------------------------------------------------------
// Asistente: mensajes por tienda
// ----------------------------------------------------------------------------
// Tipos (en orden de prioridad):
//   meta            → cuánto vender esa semana para superar el año base.
//   innovacion      → producto de innovación que la tienda aún no tiene.
//   no_se_deja      → le toca por formato y no tiene venta en todo el año.
//   dejo_de_dejarse → se vendía pero lleva 4 semanas en cero.
//   bajando         → las últimas 4 semanas venden < 80% de las 4 anteriores.
// Son CALCULADOS a partir de los datos: verlos (IBP o vista previa admin) no
// los consume ni los marca como leídos.
// ---------------------------------------------------------------------------

const _VENTANA = 4;
const _UMBRAL_BAJA = 0.8;

function _sumaSemanas(serie, hasta, n) {
  // suma n semanas terminando en `hasta` (inclusive), hacia atrás, con wrap 1..52
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = ((hasta - 1 - i + 52 * 2) % 52) + 1;
    total += (serie && serie[w - 1]) || 0;
  }
  return total;
}

function getSugerenciasCliente(clienteId, semana) {
  const ventasCliente = _ventas()[clienteId] || {};
  const ultima = ((semana - 2 + 52) % 52) + 1; // semana anterior a la que se pide
  const sugerencias = [];
  getProductosParaCliente(clienteId).forEach((p) => {
    const serie = ventasCliente[p.sku];
    const totalAnio = serie ? serie.reduce((a, v) => a + (v || 0), 0) : 0;
    const col = getCantidadAColocar(clienteId, p.sku, semana);
    const cant = col ? ` (~${col.cantidad} unidades)` : "";
    if (!totalAnio) {
      sugerencias.push(
        p.clase === "I"
          ? { tipo: "innovacion", producto: p, cantidad: col && col.cantidad, mensaje: `Innovación: ${p.nombre} todavía no está en esta tienda. Sugerencia: colocarlo${cant}.` }
          : { tipo: "no_se_deja", producto: p, cantidad: col && col.cantidad, mensaje: `No se está dejando ${p.nombre} y es producto ${p.clase} para este formato. Sugerencia: colocarlo${cant}.` }
      );
      return;
    }
    const reciente = _sumaSemanas(serie, ultima, _VENTANA);
    const previo = _sumaSemanas(serie, ultima - _VENTANA, _VENTANA);
    if (reciente === 0) {
      sugerencias.push({ tipo: "dejo_de_dejarse", producto: p, cantidad: col && col.cantidad, mensaje: `${p.nombre} (${CLASES[p.clase]}) lleva ${_VENTANA} semanas sin venta. Sugerencia: volver a colocarlo${cant}.` });
    } else if (previo > 0 && reciente < previo * _UMBRAL_BAJA) {
      const caida = Math.round((1 - reciente / previo) * 100);
      sugerencias.push({ tipo: "bajando", producto: p, cantidad: null, mensaje: `${p.nombre} (${CLASES[p.clase]}) bajó ${caida}% en las últimas ${_VENTANA} semanas. Revisar exhibición, frescura o espacio en anaquel.` });
    }
  });
  const prioridad = { innovacion: 0, no_se_deja: 1, dejo_de_dejarse: 2, bajando: 3 };
  const ordenClase = { A: 0, I: 1, B: 2, C: 3 };
  return sugerencias.sort((a, b) => prioridad[a.tipo] - prioridad[b.tipo] || ordenClase[a.producto.clase] - ordenClase[b.producto.clase]);
}

// Todo lo que el IBP ve de una tienda: su meta + las sugerencias.
function getMensajesCliente(clienteId, semana) {
  const pedido = getPedidoSugerido(clienteId, semana);
  const mensajes = [];
  if (pedido.totalBase > 0) {
    const crec = ((pedido.totalMeta / pedido.totalBase - 1) * 100).toFixed(1);
    const extra = pedido.totalNuevos ? ` Más ${pedido.totalNuevos} de productos nuevos a colocar (total ${pedido.totalPedido}).` : "";
    mensajes.push({
      tipo: "meta",
      mensaje: `Meta semana ${semana}: superar ${pedido.totalBase} unidades de ${pedido.anioBase}. Pedir ${pedido.totalMeta} unidades (+${crec}%).${extra}`,
    });
  }
  return [...mensajes, ...getSugerenciasCliente(clienteId, semana)];
}

// Para la vista previa del admin: mensajes de TODAS las tiendas de un IBP.
function getMensajesIbp(ibpId, semana) {
  const ruta = getRutaDeIbp(ibpId);
  if (!ruta) return [];
  return getClientesDeRuta(ruta.id).map((c) => ({ cliente: c, mensajes: getMensajesCliente(c.id, semana) }));
}

// ---------------------------------------------------------------------------
// Tiendas sin visita
// ----------------------------------------------------------------------------
// Última visita = la más reciente entre (a) la fecha cargada por admin /
// seed (`ultimaVisita`, sirve para arrancar con el historial real) y (b) las
// visitas marcadas en la app (geofence o botón). Al marcar una visita hoy, la
// tienda sale sola de la lista.
// ---------------------------------------------------------------------------

function getUltimaVisita(clienteId) {
  const cliente = getCliente(clienteId);
  let ultima = cliente && cliente.ultimaVisita ? cliente.ultimaVisita : null;
  const prefijo = clienteId + "__";
  Object.keys(_estado.visitas).forEach((k) => {
    if (!k.startsWith(prefijo) || !_estado.visitas[k].visitada) return;
    const fecha = k.slice(prefijo.length);
    if (!ultima || fecha > ultima) ultima = fecha;
  });
  return ultima;
}

function _diasEntre(desdeISO, hasta) {
  const [y, m, d] = desdeISO.split("-").map(Number);
  const desde = new Date(y, m - 1, d);
  const h = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  return Math.round((h - desde) / 86400000);
}

// Tiendas de la ruta del IBP que llevan MÁS de `dias` días sin visita
// (default config.diasSinVisita = 14). Las que nunca se han visitado van
// primero; luego de la más atrasada a la menos.
function getClientesSinVisita(ibpId, dias) {
  const umbral = dias || getConfigPedido().diasSinVisita;
  const ruta = getRutaDeIbp(ibpId);
  if (!ruta) return [];
  const hoy = new Date();
  const diaHoy = _diaDeHoy();
  return getClientesDeRuta(ruta.id)
    .map((c) => {
      const ultima = getUltimaVisita(c.id);
      const diasSin = ultima ? _diasEntre(ultima, hoy) : null;
      return {
        cliente: c,
        ultimaVisita: ultima,
        diasSinVisita: diasSin,
        semanasSinVisita: diasSin != null ? Math.floor(diasSin / 7) : null,
        tocaHoy: _tocaEnDia(c, diaHoy),
      };
    })
    .filter((x) => x.diasSinVisita == null || x.diasSinVisita > umbral)
    .sort((a, b) => (b.diasSinVisita == null ? Infinity : b.diasSinVisita) - (a.diasSinVisita == null ? Infinity : a.diasSinVisita));
}

// Fecha de "última visita" desde Excel/CSV: acepta 2026-10-24, 10/24/2026,
// 10/24/26 (formato EE.UU., mes primero).
function _normFecha(valor) {
  const v = String(valor || "").trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const anio = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${anio}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function importarUltimasVisitas(filas) {
  return _importarAtributoTienda(filas, "ultimaVisita", ["ultimaVisita", "ultima visita", "fecha", "lastvisit", "last visit", "fechavisita"], _normFecha);
}

// ---------------------------------------------------------------------------
// Importaciones (filas = objetos {encabezado: valor}, de CSV o Excel)
// Cada una reporta las tiendas/skus que no cruzan con lo ya cargado.
// ---------------------------------------------------------------------------

function _idsClientes() {
  return new Set(_todosClientes().map((c) => c.id));
}

// Ventas: una fila por tienda + producto + semana.
function importarVentas(filas) {
  const ventas = {};
  const ids = _idsClientes();
  const sinMatch = new Set();
  let ok = 0;
  filas.forEach((f) => {
    const tienda = _col(f, _COL_TIENDA);
    const sku = _col(f, _COL_SKU);
    const semana = parseInt(_col(f, ["semana", "week", "wk", "sem"]), 10);
    const unidades = Number(_col(f, ["unidades", "units", "venta", "ventas", "qty", "cantidad"]));
    if (!tienda || !sku || !(semana >= 1 && semana <= 53) || isNaN(unidades)) return;
    if (!ids.has(tienda)) sinMatch.add(tienda);
    ventas[tienda] = ventas[tienda] || {};
    ventas[tienda][sku] = ventas[tienda][sku] || [];
    ventas[tienda][sku][semana - 1] = unidades;
    ok++;
  });
  _estado.ventasImportadas = ventas;
  _guardar();
  return { filas: ok, sinMatch: [...sinMatch] };
}

// Formato (SF/LF) o Tier (1/2/3) por tienda: tienda + valor.
function _importarAtributoTienda(filas, campo, columnas, normalizar) {
  const ids = _idsClientes();
  const sinMatch = [];
  const invalidos = [];
  let ok = 0;
  filas.forEach((f) => {
    const tienda = _col(f, _COL_TIENDA);
    const crudo = _col(f, columnas);
    if (!tienda) return;
    const valor = normalizar(crudo);
    if (valor == null) return invalidos.push(`${tienda}: "${crudo}"`);
    if (!ids.has(tienda)) return sinMatch.push(tienda);
    _estado.clienteOverrides[tienda] = { ..._estado.clienteOverrides[tienda], [campo]: valor };
    ok++;
  });
  _guardar();
  return { filas: ok, sinMatch, invalidos };
}

function importarFormatos(filas) {
  return _importarAtributoTienda(filas, "formato", ["formato", "format", "tipo", "tipotienda", "storeformat"], _normFormato);
}

function importarTiers(filas) {
  return _importarAtributoTienda(filas, "tier", ["tier", "nivel", "categoria"], _normTier);
}

// Productos activos: sku, nombre, clase (A/B/C/Innovación), crecimiento.
// crecimiento acepta "9.9", "9.9%" o "0.099" (si es > 1 se toma como %).
function importarProductos(filas) {
  const invalidos = [];
  const productos = [];
  filas.forEach((f) => {
    const sku = _col(f, _COL_SKU);
    if (!sku) return;
    const claseCruda = _col(f, ["clase", "tipo", "class", "division", "categoria"]);
    const clase = _normClase(claseCruda);
    if (!clase) return invalidos.push(`${sku}: "${claseCruda}"`);
    const gCrudo = _col(f, ["crecimiento", "growth", "porcentaje", "crec"]);
    let g = gCrudo !== "" ? Number(gCrudo.replace("%", "").replace(",", ".")) : null;
    if (g != null && g > 1) g = g / 100;
    productos.push({ sku, nombre: _col(f, ["nombre", "descripcion", "description", "name"]) || sku, clase, crecimiento: g == null || isNaN(g) ? null : g });
  });
  _estado.productosImportados = productos;
  _estado.crecimientoOverrides = {};
  _guardar();
  return { filas: productos.length, invalidos };
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
  agregarRuta,
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
  getConfigPedido,
  actualizarConfigPedido,
  getProductos,
  setCrecimientoProducto,
  getProductosParaCliente,
  getVentaSemana,
  getSemanaObjetivoSugerida,
  getPedidoSugerido,
  getSugerenciasCliente,
  getMensajesCliente,
  getMensajesIbp,
  getCantidadAColocar,
  importarFormatos,
  importarTiers,
  importarUltimasVisitas,
  getUltimaVisita,
  getClientesSinVisita,
  CLASES,
  importarVentas,
  importarProductos,
};
