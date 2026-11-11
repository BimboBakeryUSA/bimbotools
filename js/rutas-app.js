// ============================================================================
// rutas.html — Planificador de rutas semana A/B.
// Datos: Supabase vía js/depuracion.js (tiendas, ventas, rutas_geo,
// rutas_plan, rutas_config). Cálculo: js/ruteo.js (sin IA, todo local).
// ============================================================================

(function () {
  const D = window.AppDatos;
  const R = window.Ruteo;
  const I = window.RutasIdioma;
  const T = (es, vars) => I.T(es, vars);
  const LS_IDIOMA = "rutasIdioma";
  const $ = (id) => document.getElementById(id);
  const LS_RUTA = "rutasUltimaRuta";
  const COLORES = ["", "#c0392b", "#1f6fb2", "#2e8a4e", "#c77a00", "#7a4bb0", "#00838f", "#6d4c41"];
  const TODOS_DIAS = [1, 2, 3, 4, 5, 6, 7];
  const DIAS_DEFECTO = [1, 2, 3, 4, 5];
  const CORTO_ES = ["", "L", "M", "Mi", "J", "V", "S", "D"];
  const CORTO_EN = ["", "M", "T", "W", "Th", "F", "Sa", "Su"];
  let CORTO = CORTO_ES;

  const S = {
    perfil: null,
    soloLectura: true,
    rutas: [],
    reglas: JSON.parse(JSON.stringify(R.REGLAS_DEFECTO)),
    ruta: null,
    tiendas: [],
    porId: new Map(),
    geo: new Map(),
    plan: null, // { inicio, warehouse, whDias, frecuencias, slots, fijadas:Set }
    // Warehouses ya registrados (rutas_config "warehouses"), para no volver a
    // escribir la dirección en cada ruta: [{ id, nombre, direccion, ciudad, estado_us, zip, lat, lng }]
    warehouses: [],
    dias: [1, 2, 3, 4, 5],
    semana: "A",
    ocultos: new Set(),
    sucio: false,
    mapa: null,
    capa: null,
    ajustarMapa: true,
    tiendasTodas: null,
  };

  // --------------------------------------------------------------------------
  // Utilidades
  // --------------------------------------------------------------------------

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".rt-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "rt-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  function descargar(nombre, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function csvCampo(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // Parser CSV sencillo con comillas (para el resultado del Census).
  function parsearCsv(texto) {
    const filas = [];
    let fila = [], campo = "", comillas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (comillas) {
        if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') comillas = false;
        else campo += c;
      } else if (c === '"') comillas = true;
      else if (c === ",") { fila.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        fila.push(campo); filas.push(fila); fila = []; campo = "";
      } else campo += c;
    }
    if (campo || fila.length) { fila.push(campo); filas.push(fila); }
    return filas.filter((f) => f.some((x) => x.trim() !== ""));
  }

  function parsearLatLng(texto) {
    const m = String(texto || "").match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }

  const esNum = (v) => v != null && v !== "" && Number.isFinite(Number(v));
  const esPunto = (p) => !!p && esNum(p.lat) && esNum(p.lng);

  // Días válidos (1..7), sin repetir y en orden.
  function limpiarDias(dias) {
    if (!Array.isArray(dias)) return [];
    return [...new Set(dias.map(Number).filter((d) => TODOS_DIAS.includes(d)))].sort((a, b) => a - b);
  }

  function nombreDias(dias) {
    return dias.map((d) => R.DIAS[d].slice(0, 3)).join("/");
  }

  // Punto de salida de un día (slot "A1"...): el warehouse si ese día el IBP
  // carga ahí; si no, el punto de salida manual (o ninguno).
  function salidaDe(k) {
    const w = S.plan && S.plan.warehouse;
    if (w && esPunto(w) && S.plan.whDias.includes(Number(k[1]))) return { lat: +w.lat, lng: +w.lng };
    return (S.plan && S.plan.inicio) || null;
  }

  function marcarSucio(v = true) {
    S.sucio = v;
    const el = $("estadoGuardado");
    el.classList.toggle("sucio", v);
    if (v) el.textContent = "Cambios sin guardar";
  }

  function errorTablasFaltantes(e) {
    return /rutas_(geo|plan|config)/.test(e.message) && /(does not exist|schema cache|not find)/i.test(e.message);
  }

  // --------------------------------------------------------------------------
  // Sesión
  // --------------------------------------------------------------------------

  // Regla con el texto que arma Ruteo ("Venta > 400", "Resto (semanal)"...).
  function traducirRegla(r) {
    const m = /^Venta ([<>]) (.+)$/.exec(r || "");
    return m ? T(`Venta ${m[1]} {n}`, { n: m[2] }) : T(r || "");
  }

  function aplicarIdioma(idioma) {
    I.setIdioma(idioma);
    CORTO = I.idioma === "en" ? CORTO_EN : CORTO_ES;
    $("btnIdioma").textContent = I.idioma === "en" ? "ES" : "EN";
    $("btnIdioma").setAttribute("aria-label", I.idioma === "en" ? "Español" : "English");
    $("btnIdioma").title = I.idioma === "en" ? "Cambiar a español" : "Switch to English";
    try { localStorage.setItem(LS_IDIOMA, I.idioma); } catch (e) {}
    if (S.plan) {
      renderBarraPlan();
      renderTodo();
      if (!$("tabReglas").hidden) renderReglas();
      if (!$("tabFeriados").hidden) renderFeriados();
      renderAvisoFeriado();
      if (S.sucio) marcarSucio();
    }
  }

  $("btnIdioma").onclick = () => aplicarIdioma(I.idioma === "en" ? "es" : "en");

  async function iniciar() {
    I.iniciar();
    let guardado = "es";
    try { guardado = localStorage.getItem(LS_IDIOMA) || "es"; } catch (e) {}
    aplicarIdioma(guardado);
    await D.init();
    const sesion = await D.getSesionValida();
    if (!sesion) return mostrarLogin();
    await arrancar();
  }

  function mostrarLogin(msg) {
    $("pantallaLogin").hidden = false;
    $("app").hidden = true;
    $("loginError").textContent = msg || "";
  }

  $("btnLogin").onclick = async () => {
    try {
      await D.iniciarSesion($("loginEmail").value.trim(), $("loginPassword").value);
      await arrancar();
    } catch (e) {
      $("loginError").textContent = "Correo o contraseña incorrectos.";
    }
  };
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnLogin").click(); });

  async function arrancar() {
    S.perfil = await D.getPerfilActual();
    if (!S.perfil) return mostrarLogin("Tu cuenta no tiene perfil en la app.");
    // Solo admin y corporativo (managers: DOS, ZSL, MSL). Nadie más.
    if (!["admin", "corporativo", "dos", "zsl", "msl"].includes(String(S.perfil.role || "").toLowerCase())) {
      await D.cerrarSesion().catch(() => {});
      return mostrarLogin("Esta página es solo para managers.");
    }
    S.soloLectura = false;
    $("pantallaLogin").hidden = true;
    $("app").hidden = false;
    document.body.classList.toggle("solo-lectura", S.soloLectura);

    try {
      const guardadas = await D.getConfigRutas("reglas");
      if (guardadas && guardadas.cadenas) S.reglas = guardadas;
      else if (!S.soloLectura) toast("Todavía no hay reglas de frecuencia: defínelas en la pestaña Reglas.");
      const wh = await D.getConfigRutas("warehouses");
      if (Array.isArray(wh)) S.warehouses = wh.filter((w) => w && w.id);
    } catch (e) {
      if (errorTablasFaltantes(e)) {
        $("estadoGuardado").textContent = "Falta crear las tablas del planificador: corre scripts/rutas_schema.sql en Supabase.";
        $("estadoGuardado").classList.add("sucio");
      } else console.error(e);
    }

    if (S.soloLectura) {
      S.rutas = [{ ruta: S.perfil.route_code, propietario: "", msl: "", total: 0 }];
      ["btnCalcular", "btnReordenar", "btnSoltar", "btnGuardar", "btnGuardarReglas", "btnAgregarRegla",
        "btnCensusTodas", "btnOsm", "btnWarehouse"].forEach((id) => ($(id).hidden = true));
    } else {
      S.rutas = await D.getRutas();
    }
    await cargarFeriados();
    llenarSelectores();
    let ultima = null;
    try { ultima = localStorage.getItem(LS_RUTA); } catch (e) {}
    if (ultima && S.rutas.some((r) => r.ruta === ultima)) {
      $("selRuta").value = ultima;
      await cargarRuta(ultima);
    } else if (S.soloLectura) {
      await cargarRuta(S.perfil.route_code);
    }
  }

  function llenarSelectores() {
    const msls = [...new Set(S.rutas.map((r) => r.msl).filter(Boolean))].sort();
    $("selMsl").innerHTML = `<option value="">Todos</option>` + msls.map((m) => `<option>${esc(m)}</option>`).join("");
    $("selMsl").parentElement.hidden = !msls.length;
    llenarRutas();
  }

  function llenarRutas() {
    const msl = $("selMsl").value;
    const lista = S.rutas.filter((r) => !msl || r.msl === msl);
    $("selRuta").innerHTML = lista
      .map((r) => `<option value="${esc(r.ruta)}">${esc(r.ruta)}${r.propietario ? " · " + esc(r.propietario) : ""}${r.total ? ` (${r.total})` : ""}</option>`)
      .join("");
  }
  $("selMsl").onchange = llenarRutas;

  $("btnCargar").onclick = async () => {
    if ((S.sucio || (S.esp && S.esp.sucio)) && !window.confirm(T("Hay cambios sin guardar en esta ruta. ¿Cargar otra de todos modos?"))) return;
    await cargarRuta($("selRuta").value);
  };

  window.addEventListener("beforeunload", (e) => {
    if (S.sucio || (S.esp && S.esp.sucio)) { e.preventDefault(); e.returnValue = ""; }
  });

  // --------------------------------------------------------------------------
  // Carga de una ruta
  // --------------------------------------------------------------------------

  function frecuenciaBase(t) {
    if (t.estatus === "inactiva") return { freq: "fuera", regla: "Inactiva (IBP)" };
    if (t.frecuencia === "pedido") return { freq: "fuera", regla: "Por pedido (IBP)" };
    return R.frecuenciaPorRegla(t, S.reglas);
  }

  async function cargarRuta(id) {
    if (!id) return;
    $("estadoGuardado").textContent = "Cargando…";
    $("estadoGuardado").classList.remove("sucio");
    try {
      const tiendas = await D.getTiendasConEstado(id);
      let geo = new Map(), plan = null;
      try {
        geo = await D.getGeo(tiendas.map((t) => t.id));
        plan = await D.getPlanRuta(id);
      } catch (e) {
        if (!errorTablasFaltantes(e)) throw e;
        toast("Faltan las tablas del planificador en Supabase (scripts/rutas_schema.sql). Puedes calcular, pero no guardar.");
      }
      S.ruta = id;
      try { localStorage.setItem(LS_RUTA, id); } catch (e) {}
      S.geo = geo;
      S.tiendas = tiendas.map((t) => {
        const semanas = t.semanas || [];
        const ventaSem = semanas.length ? semanas.reduce((a, b) => a + b, 0) / semanas.length : 0;
        const x = { ...t, ventaSem };
        const base = frecuenciaBase(x);
        x.freqRegla = base.freq;
        x.regla = base.regla;
        return x;
      });
      S.tiendas.sort((a, b) => a.nombre.localeCompare(b.nombre));
      S.porId = new Map(S.tiendas.map((t) => [t.id, t]));

      const p = plan || {};
      // rutas_plan.inicio guarda { lat, lng, warehouse:{...}, warehouseDias, dias }
      // (ver scripts/rutas_schema.sql).
      const ini = p.inicio || {};
      let wh = ini.warehouse && typeof ini.warehouse === "object" ? ini.warehouse : null;
      if (typeof ini.warehouse === "string") wh = S.warehouses.find((w) => w.id === ini.warehouse) || null;
      S.plan = {
        inicio: esPunto(ini) ? { lat: +ini.lat, lng: +ini.lng } : null,
        warehouse: wh,
        whDias: [],
        frecuencias: p.frecuencias || {},
        slots: {},
        fijadas: new Set((p.fijadas || []).filter((x) => S.porId.has(x))),
      };
      S.tiendas.forEach((t) => (t.freq = S.plan.frecuencias[t.id] || t.freqRegla));
      const slotsGuardados = p.slots || {};
      // Días que trabaja la ruta: los guardados; si no hay, lunes a viernes
      // (más los días que ya traiga el plan viejo).
      let dias = limpiarDias(ini.dias);
      if (!dias.length) {
        const usados = Object.keys(slotsGuardados).filter((k) => (slotsGuardados[k] || []).length).map((k) => Number(k[1]));
        dias = limpiarDias(DIAS_DEFECTO.concat(usados));
      }
      S.dias = dias;
      if (wh) S.plan.whDias = limpiarDias(ini.warehouseDias).filter((d) => dias.includes(d));
      asegurarSlots();
      Object.keys(slotsGuardados).forEach((k) => {
        if (S.plan.slots[k]) S.plan.slots[k] = slotsGuardados[k].filter((x) => S.porId.has(x));
      });
      S.ajustarMapa = true;
      marcarSucio(false);
      $("estadoGuardado").textContent = plan
        ? T("Plan guardado {fecha}{por}", { fecha: new Date(plan.actualizado_en).toLocaleString(I.locale), por: plan.actualizado_por ? T(" por {a}", { a: plan.actualizado_por }) : "" })
        : "Esta ruta todavía no tiene plan guardado.";
      $("vistaRuta").hidden = false;
      $("lnkTerritorio").href = `mi-territorio.html?ruta=${encodeURIComponent(id)}`;
      await cargarPlanesEspeciales();
      renderBarraPlan();
      renderTodo();
      renderAvisoFeriado();
      if (!$("tabFeriados").hidden) renderFeriados();
      const faltan = S.tiendas.filter((t) => !S.geo.has(t.id));
      if (faltan.length && !S.soloLectura && !ubicando) {
        await ubicarRutaActual(faltan, !plan);
      } else if (!plan && !S.soloLectura && S.tiendas.some((t) => S.geo.has(t.id))) {
        calcular();
      }
    } catch (e) {
      console.error(e);
      $("estadoGuardado").textContent = T("No se pudo cargar la ruta: {e}", { e: e.message });
    }
  }

  function asegurarSlots() {
    ["A", "B"].forEach((w) => S.dias.forEach((d) => { if (!S.plan.slots[`${w}${d}`]) S.plan.slots[`${w}${d}`] = []; }));
    Object.keys(S.plan.slots).forEach((k) => { if (!S.dias.includes(Number(k[1]))) delete S.plan.slots[k]; });
  }

  function posiciones() {
    const pos = {};
    S.geo.forEach((g, id) => (pos[id] = { lat: g.lat, lng: g.lng }));
    return pos;
  }

  function sinAsignar() {
    return S.tiendas.filter((t) => t.freq !== "fuera" && !R.patronActual(t.id, t.freq, S.dias, S.plan.slots));
  }

  // --------------------------------------------------------------------------
  // Operaciones sobre el plan
  // --------------------------------------------------------------------------

  function quitarDePlan(id) {
    const tocados = [];
    Object.keys(S.plan.slots).forEach((k) => {
      const i = S.plan.slots[k].indexOf(id);
      if (i >= 0) { S.plan.slots[k].splice(i, 1); tocados.push(k); }
    });
    return tocados;
  }

  function aplicarPatron(id, patron, fijar) {
    const tocados = quitarDePlan(id);
    patron.slots.forEach((k) => { S.plan.slots[k].push(id); tocados.push(k); });
    S.plan.slots = R.reordenarSlots(S.plan.slots, [...new Set(tocados)], posiciones(), salidaDe);
    if (fijar) S.plan.fijadas.add(id);
    marcarSucio();
  }

  // Ubica una tienda en el patrón que menos distancia agrega (sin fijarla).
  function ponerMejor(id) {
    const t = S.porId.get(id);
    if (!t || t.freq === "fuera") return;
    const pos = posiciones();
    const ps = R.patrones(t.freq, S.dias);
    if (!ps.length) return;
    if (!pos[id]) {
      const menos = ps.slice().sort((a, b) => carga(a) - carga(b))[0];
      return aplicarPatron(id, menos, false);
    }
    const meta = totalVisitas() / (S.dias.length * 2);
    let mejor = null, cMejor = Infinity;
    ps.forEach((p) => {
      let c = 0;
      p.slots.forEach((k) => {
        const otros = S.plan.slots[k].filter((x) => x !== id && pos[x]).map((x) => pos[x]);
        if (salidaDe(k)) otros.push(salidaDe(k));
        c += otros.length ? Math.min(...otros.map((q) => R.millas(pos[id], q))) * 2 : 10;
        c += 3 * Math.max(0, S.plan.slots[k].length + 1 - meta);
      });
      if (c < cMejor) { cMejor = c; mejor = p; }
    });
    aplicarPatron(id, mejor, false);
  }

  function carga(p) {
    return p.slots.reduce((s, k) => s + (S.plan.slots[k] || []).length, 0);
  }

  function totalVisitas() {
    return Object.values(S.plan.slots).reduce((s, a) => s + a.length, 0);
  }

  function calcular() {
    const fijadas = {};
    S.plan.fijadas.forEach((id) => {
      const t = S.porId.get(id);
      if (!t) return;
      const p = R.patronActual(id, t.freq, S.dias, S.plan.slots);
      if (p) fijadas[id] = p.slots;
    });
    const max = Number($("numMax").value) || null;
    const res = R.calcularPlan(
      S.tiendas.map((t) => ({ id: t.id, freq: t.freq, lat: S.geo.has(t.id) ? S.geo.get(t.id).lat : null, lng: S.geo.has(t.id) ? S.geo.get(t.id).lng : null })),
      { dias: S.dias, inicio: salidaDe, fijadas, maxPorDia: max }
    );
    S.plan.slots = res.slots;
    asegurarSlots();
    marcarSucio();
    renderTodo();
    const msgSin = res.sinUbicar.length ? T(" {n} tiendas sin ubicación quedaron sin asignar.", { n: res.sinUbicar.length }) : "";
    const msgDias = res.sinDias.length ? T(" {n} tiendas no caben en los días de trabajo ({dias}) con su frecuencia.", { n: res.sinDias.length, dias: nombreDias(S.dias) }) : "";
    toast(T("Plan calculado.") + msgSin + msgDias);
  }

  $("btnCalcular").onclick = calcular;
  $("btnReordenar").onclick = () => {
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), salidaDe);
    marcarSucio();
    renderTodo();
    toast("Orden de cada día recalculado.");
  };
  $("btnSoltar").onclick = () => {
    S.plan.fijadas.clear();
    marcarSucio();
    renderTodo();
    toast("Ninguna tienda queda fijada. El próximo cálculo puede moverlas todas.");
  };

  $("btnGuardar").onclick = async () => {
    try {
      const cuando = await D.guardarPlanRuta(
        S.ruta,
        {
          inicio: { ...(S.plan.inicio || {}), warehouse: S.plan.warehouse || null, warehouseDias: S.plan.whDias, dias: S.dias },
          frecuencias: S.plan.frecuencias, slots: S.plan.slots, fijadas: [...S.plan.fijadas] },
        S.perfil.nombre || S.perfil.email
      );
      marcarSucio(false);
      $("estadoGuardado").textContent = T("Guardado {fecha}", { fecha: new Date(cuando).toLocaleString(I.locale) });
      const n = sinAsignar().length;
      toast(n ? T("Guardado. Ojo: {n} tiendas siguen sin asignar.", { n }) : "Plan guardado.");
    } catch (e) {
      console.error(e);
      toast(errorTablasFaltantes(e) ? "No se guardó: faltan las tablas del planificador en Supabase." : T("No se guardó: {e}", { e: e.message }));
    }
  };

  // Cambia los días que trabaja la ruta y reubica las tiendas que quedaron
  // fuera (o cuyo patrón ya no es válido con los días nuevos).
  function cambiarDias(nuevos) {
    nuevos = limpiarDias(nuevos);
    if (!nuevos.length || nuevos.join() === S.dias.join()) return false;
    const quitados = S.dias.filter((d) => !nuevos.includes(d));
    const afectadas = new Set(quitados.flatMap((d) => [...(S.plan.slots[`A${d}`] || []), ...(S.plan.slots[`B${d}`] || [])]));
    S.dias = nuevos;
    S.plan.whDias = S.plan.whDias.filter((d) => nuevos.includes(d));
    quitados.forEach((d) => S.ocultos.delete(d));
    asegurarSlots();
    // Tiendas cuyo patrón ya no es válido con los días nuevos → se reubican.
    S.tiendas.forEach((t) => {
      if (t.freq === "fuera") return;
      if (afectadas.has(t.id) || !R.patronActual(t.id, t.freq, S.dias, S.plan.slots)) {
        quitarDePlan(t.id);
        S.plan.fijadas.delete(t.id);
        ponerMejor(t.id);
      }
    });
    marcarSucio();
    const sinDias = S.tiendas.filter((t) => t.freq !== "fuera" && !R.patrones(t.freq, S.dias).length);
    if (sinDias.length) toast(T("{n} tiendas no caben en {dias} con su frecuencia (ej. 3x semana necesita 3 días de trabajo).", { n: sinDias.length, dias: nombreDias(S.dias) }));
    return true;
  }

  function renderBarraPlan() {
    $("txtInicio").value = S.plan.inicio ? `${S.plan.inicio.lat}, ${S.plan.inicio.lng}` : "";
    $("txtInicio").disabled = S.soloLectura;
    $("btnWarehouse").textContent = S.plan.warehouse ? "Cambiar warehouse" : "Agregar warehouse";
    $("diasCarga").innerHTML = TODOS_DIAS.map((d) =>
      `<button type="button" data-dia="${d}" aria-pressed="${S.dias.includes(d)}" title="${R.DIAS[d]}" ${S.soloLectura ? "disabled" : ""}>${CORTO[d]}</button>`
    ).join("");
  }

  $("diasCarga").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dia]");
    if (!b || S.soloLectura) return;
    const d = Number(b.dataset.dia);
    const nuevos = S.dias.includes(d) ? S.dias.filter((x) => x !== d) : S.dias.concat(d);
    if (!nuevos.length) return toast("La ruta necesita al menos un día de trabajo.");
    cambiarDias(nuevos);
    renderBarraPlan();
    renderTodo();
  });

  // --------------------------------------------------------------------------
  // Warehouse: una parada más de la ruta, en los días que el IBP carga ahí.
  // --------------------------------------------------------------------------

  function ponerDiasWarehouse(dias) {
    S.plan.whDias = limpiarDias(dias).filter((d) => S.dias.includes(d));
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), salidaDe);
    marcarSucio();
    renderTodo();
  }

  function quitarWarehouse() {
    S.plan.warehouse = null;
    S.plan.whDias = [];
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), salidaDe);
    marcarSucio();
    renderBarraPlan();
    renderTodo();
  }

  function abrirFormWarehouse() {
    const f = $("formWarehouse");
    const otros = S.warehouses.filter((w) => esPunto(w));
    $("selWhGuardado").innerHTML = `<option value="">— Uno nuevo (escribe la dirección) —</option>` +
      otros.map((w) => `<option value="${esc(w.id)}">${esc(w.nombre)} · ${esc(w.direccion)}, ${esc(w.ciudad)}</option>`).join("");
    $("lblWhGuardado").hidden = !otros.length;
    const w = S.plan.warehouse;
    $("selWhGuardado").value = w && otros.some((x) => x.id === w.id) ? w.id : "";
    $("whNombre").value = w ? w.nombre || "" : "";
    $("whDireccion").value = w ? w.direccion || "" : "";
    $("whCiudad").value = w ? w.ciudad || "" : "";
    $("whEstado").value = w ? w.estado_us || "" : "";
    $("whZip").value = w ? w.zip || "" : "";
    $("whCoords").value = "";
    $("whMensaje").textContent = "";
    f.hidden = false;
    $(otros.length ? "selWhGuardado" : "whNombre").focus();
  }

  $("btnWarehouse").onclick = () => ($("formWarehouse").hidden ? abrirFormWarehouse() : ($("formWarehouse").hidden = true));
  $("btnWhCancelar").onclick = () => ($("formWarehouse").hidden = true);
  $("selWhGuardado").onchange = () => {
    const w = S.warehouses.find((x) => x.id === $("selWhGuardado").value);
    ["whNombre", "whDireccion", "whCiudad", "whEstado", "whZip"].forEach((id, i) => {
      $(id).value = w ? w[["nombre", "direccion", "ciudad", "estado_us", "zip"][i]] || "" : "";
    });
  };

  async function ubicarDireccion(w) {
    let p = await censusJsonp(w);
    if (p && esPunto(p)) return p;
    try { p = await buscarOsm(w); } catch (e) { p = null; }
    return p && esPunto(p) ? p : null;
  }

  $("formWarehouse").onsubmit = async (e) => {
    e.preventDefault();
    const guardado = S.warehouses.find((x) => x.id === $("selWhGuardado").value);
    const w = {
      id: guardado ? guardado.id : `wh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      nombre: $("whNombre").value.trim(),
      direccion: $("whDireccion").value.trim(),
      ciudad: $("whCiudad").value.trim(),
      estado_us: $("whEstado").value.trim().toUpperCase(),
      zip: $("whZip").value.trim(),
      lat: null,
      lng: null,
    };
    if (!w.nombre) return ($("whMensaje").textContent = "Ponle un nombre al warehouse.");
    const txt = $("whCoords").value.trim();
    let punto = txt ? parsearLatLng(txt) : null;
    if (txt && !punto) return ($("whMensaje").textContent = "Las coordenadas van como “lat, lng”, por ejemplo 38.8462, -77.3064.");
    const mismaDireccion = guardado && ["direccion", "ciudad", "estado_us", "zip"].every((c) => (guardado[c] || "") === w[c]);
    if (!punto && mismaDireccion && esPunto(guardado)) punto = { lat: +guardado.lat, lng: +guardado.lng };
    if (!punto) {
      if (!w.direccion || !(w.zip || (w.ciudad && w.estado_us))) return ($("whMensaje").textContent = "Escribe dirección y ZIP (o ciudad y estado), o pega las coordenadas.");
      $("btnWhAgregar").disabled = true;
      $("whMensaje").textContent = "Buscando la dirección…";
      punto = await ubicarDireccion(w);
      $("btnWhAgregar").disabled = false;
      if (!punto) return ($("whMensaje").textContent = "No encontré esa dirección. Revísala o pega las coordenadas (Google Maps, clic derecho sobre el warehouse).");
    }
    w.lat = punto.lat;
    w.lng = punto.lng;
    const cambio = !S.plan.warehouse || S.plan.warehouse.id !== w.id;
    S.plan.warehouse = w;
    // Un warehouse nuevo en la ruta empieza sin días: el usuario lo pone en los que el IBP carga.
    if (cambio) S.plan.whDias = [];
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), salidaDe);
    $("formWarehouse").hidden = true;
    S.ajustarMapa = true;
    marcarSucio();
    renderBarraPlan();
    renderTodo();
    toast(T("{w} agregado. Arrástralo a los días que el IBP va a cargar (o usa sus botones de días). Luego Guardar.", { w: w.nombre }));
    // Queda registrado para elegirlo en otras rutas sin volver a escribirlo.
    S.warehouses = S.warehouses.filter((x) => x.id !== w.id).concat(w);
    try { await D.guardarConfigRutas("warehouses", S.warehouses); } catch (err) { console.error(err); }
  };

  $("txtInicio").onchange = () => {
    const txt = $("txtInicio").value.trim();
    const p = txt ? parsearLatLng(txt) : null;
    if (txt && !p) return toast("Escribe el punto de salida como “lat, lng”, por ejemplo 38.8462, -77.3064.");
    S.plan.inicio = p;
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), salidaDe);
    S.ajustarMapa = true;
    marcarSucio();
    renderTodo();
  };

  document.querySelectorAll(".rt-semana button").forEach((b) => {
    b.onclick = () => {
      S.semana = b.dataset.semana;
      document.querySelectorAll(".rt-semana button").forEach((x) => x.setAttribute("aria-selected", x === b));
      renderPlan();
    };
  });

  document.querySelectorAll(".rt-tabs button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".rt-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      ["plan", "tiendas", "ubicaciones", "reglas", "feriados"].forEach((t) => ($("tab" + t[0].toUpperCase() + t.slice(1)).hidden = t !== b.dataset.tab));
      if (b.dataset.tab === "plan" && S.mapa) setTimeout(() => S.mapa.invalidateSize(), 50);
      if (b.dataset.tab === "reglas") renderReglas();
      if (b.dataset.tab === "feriados") renderFeriados();
    };
  });

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  function renderTodo() {
    renderStats();
    renderPlan();
    renderTabla();
    renderUbicaciones();
  }

  function renderStats() {
    const enPlan = S.tiendas.filter((t) => t.freq !== "fuera");
    const conGeo = enPlan.filter((t) => S.geo.has(t.id)).length;
    const visitas = totalVisitas();
    const mi = R.millasDeSlots(S.plan.slots, posiciones(), salidaDe);
    const millasSem = Object.values(mi).reduce((a, b) => a + b, 0) / 2;
    const sin = sinAsignar().length;
    const items = [
      [enPlan.length, "tiendas en ruta"],
      [`${conGeo}/${enPlan.length}`, "con ubicación"],
      [visitas, "visitas en 2 semanas"],
      [(visitas / (S.dias.length * 2)).toFixed(1), "paradas por día"],
      [`~${Math.round(millasSem)}`, "millas por semana"],
    ];
    if (sin) items.push([sin, "sin asignar"]);
    $("stats").innerHTML = items.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
  }

  function chipFreq(f) {
    const c = R.veces(f) ? "x2" : f === "q" ? "q" : "";
    return `<span class="rt-chip ${c}">${R.ETIQUETA_FREQ[f]}</span>`;
  }

  function htmlParada(t, n, slot) {
    const opciones = R.patrones(t.freq, S.dias, true)
      .map((p) => `<option value="${p.clave}">${esc(p.etiqueta)}</option>`)
      .join("");
    const editable = !S.soloLectura;
    return `<div class="rt-parada" draggable="${editable}" data-id="${esc(t.id)}" data-slot="${slot || ""}">
      <span class="n">${n || "–"}</span>
      <div>
        <div class="s">${esc(t.nombre)}</div>
        <div class="a">${esc(t.direccion)}, ${esc(t.ciudad)}</div>
        ${chipFreq(t.freq)}<span class="rt-chip">$${Math.round(t.ventaSem)}${T("/sem")}</span>${S.plan.fijadas.has(t.id) ? '<span class="rt-chip fija">Fijada</span>' : ""}${S.geo.has(t.id) ? "" : '<span class="rt-chip warn">Sin ubicación</span>'}
        ${editable ? `<select class="rt-mover" data-id="${esc(t.id)}" aria-label="Mover ${esc(t.nombre)}"><option value="">Mover a…</option>${opciones}<option value="__quitar">Quitar del plan</option></select>` : ""}
      </div>
      ${editable && slot ? `<div class="flechas"><button data-sube="${esc(t.id)}" aria-label="Subir">▲</button><button data-baja="${esc(t.id)}" aria-label="Bajar">▼</button></div>` : "<span></span>"}
    </div>`;
  }

  function renderPlan() {
    const mi = R.millasDeSlots(S.plan.slots, posiciones(), salidaDe);
    const cont = $("dias");
    const sin = sinAsignar();
    const w = S.plan.warehouse;
    cont.style.setProperty("--n", S.dias.length + (sin.length ? 1 : 0) + (w ? 1 : 0));
    let html = "";
    const ed = !S.soloLectura;
    if (w) {
      const botones = S.dias.map((d) => `<button type="button" data-whdia="${d}" aria-pressed="${S.plan.whDias.includes(d)}" title="${R.DIAS[d]}" ${ed ? "" : "disabled"}>${CORTO[d]}</button>`).join("");
      html += `<section class="rt-dia warehouse" data-slot="__wh"><h3>Warehouse<small>${S.plan.whDias.length ? esc(nombreDias(S.plan.whDias)) : "sin días"}</small></h3>
        <div class="rt-parada wh" draggable="${ed}" data-wh="1" data-slot="__wh">
          <span class="n">W</span>
          <div>
            <div class="s">${esc(w.nombre)}</div>
            <div class="a">${esc([w.direccion, w.ciudad, w.estado_us].filter(Boolean).join(", "))}</div>
            <div class="rt-nota" style="font-size:11px; margin-top:4px;">Días que el IBP carga aquí:</div>
            <div class="rt-diaschk">${botones}</div>
            ${ed ? `<button type="button" class="btn btn-secondary btn-small" data-wh-quitar style="margin-top:6px;">Quitar de la ruta</button>` : ""}
          </div>
          <span></span>
        </div>
        <p class="rt-nota" style="font-size:11px; margin:6px 0 0;">Arrástralo a cada día que el IBP va a cargar.</p></section>`;
    }
    if (sin.length) {
      html += `<section class="rt-dia sinasignar" data-slot=""><h3>Sin asignar<small>${sin.length}</small></h3>${sin.map((t) => htmlParada(t, null, null)).join("")}</section>`;
    }
    S.dias.forEach((d) => {
      const k = `${S.semana}${d}`;
      const ids = S.plan.slots[k] || [];
      const tarjetaWh = w && S.plan.whDias.includes(d)
        ? `<div class="rt-parada wh" draggable="${ed}" data-wh="1" data-slot="${k}"><span class="n">W</span><div><div class="s">${esc(w.nombre)}</div><div class="a">Carga · salida del día</div></div>${ed ? `<div class="flechas"><button data-wh-quitar-dia="${d}" aria-label="${esc(T("Quitar el warehouse de {dia}", { dia: R.DIAS[d] }))}" title="${esc(T("Quitar de este día"))}">✕</button></div>` : "<span></span>"}</div>`
        : "";
      html += `<section class="rt-dia" style="--c:${COLORES[d]}" data-slot="${k}"><h3>${R.DIAS[d]}<small>${T("{n} paradas · ~{mi} mi", { n: ids.length, mi: Math.round(mi[k] || 0) })}</small></h3>${tarjetaWh}${ids
        .map((id, i) => S.porId.get(id) ? htmlParada(S.porId.get(id), i + 1, k) : "")
        .join("")}</section>`;
    });
    cont.innerHTML = html;
    renderMapa();
  }

  // Mover con el selector (sirve en celular)
  $("dias").addEventListener("change", (e) => {
    const sel = e.target.closest(".rt-mover");
    if (!sel || !sel.value) return;
    const id = sel.dataset.id;
    const t = S.porId.get(id);
    if (sel.value === "__quitar") {
      quitarDePlan(id);
      S.plan.fijadas.delete(id);
      marcarSucio();
    } else {
      const p = R.patrones(t.freq, S.dias, true).find((x) => x.clave === sel.value);
      if (p) aplicarPatron(id, p, true);
    }
    renderTodo();
  });

  // Flechas: cambiar el orden dentro del día
  $("dias").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sube], button[data-baja]");
    if (!b) return;
    const id = b.dataset.sube || b.dataset.baja;
    const slot = b.closest(".rt-parada").dataset.slot;
    const arr = S.plan.slots[slot];
    const i = arr.indexOf(id);
    const j = b.dataset.sube ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    marcarSucio();
    renderPlan();
    renderStats();
  });

  // Botones del warehouse (días, quitar)
  $("dias").addEventListener("click", (e) => {
    if (S.soloLectura) return;
    const b = e.target.closest("button[data-whdia], button[data-wh-quitar-dia], button[data-wh-quitar]");
    if (!b) return;
    if (b.dataset.whdia) {
      const d = Number(b.dataset.whdia);
      ponerDiasWarehouse(S.plan.whDias.includes(d) ? S.plan.whDias.filter((x) => x !== d) : S.plan.whDias.concat(d));
    } else if (b.dataset.whQuitarDia) {
      ponerDiasWarehouse(S.plan.whDias.filter((x) => x !== Number(b.dataset.whQuitarDia)));
    } else if (window.confirm(T("¿Quitar {w} de esta ruta?", { w: S.plan.warehouse.nombre }))) {
      quitarWarehouse();
    }
  });

  // Arrastrar y soltar entre días
  let arrastrando = null;
  $("dias").addEventListener("dragstart", (e) => {
    const el = e.target.closest(".rt-parada");
    if (!el || S.soloLectura) return;
    arrastrando = { id: el.dataset.id, slot: el.dataset.slot, wh: el.dataset.wh === "1" };
    el.classList.add("arrastrando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", el.dataset.id);
  });
  $("dias").addEventListener("dragend", (e) => {
    const el = e.target.closest(".rt-parada");
    if (el) el.classList.remove("arrastrando");
    document.querySelectorAll(".rt-dia.sobre").forEach((x) => x.classList.remove("sobre"));
  });
  $("dias").addEventListener("dragover", (e) => {
    const col = e.target.closest(".rt-dia");
    if (!col || !arrastrando) return;
    e.preventDefault();
    document.querySelectorAll(".rt-dia.sobre").forEach((x) => x !== col && x.classList.remove("sobre"));
    col.classList.add("sobre");
  });
  $("dias").addEventListener("drop", (e) => {
    const col = e.target.closest(".rt-dia");
    if (!col || !arrastrando) return;
    e.preventDefault();
    col.classList.remove("sobre");
    const { id, slot: origen, wh } = arrastrando;
    arrastrando = null;
    const destino = col.dataset.slot;
    if (wh) {
      // Warehouse: soltarlo en un día lo agrega a ese día (si venía de otro
      // día, se mueve); soltarlo fuera de los días lo quita del día de origen.
      const dOrigen = origen && origen !== "__wh" ? Number(origen[1]) : null;
      let dias = S.plan.whDias.slice();
      if (!destino || destino === "__wh") {
        if (dOrigen) dias = dias.filter((x) => x !== dOrigen);
      } else {
        const d = Number(destino[1]);
        if (dOrigen && dOrigen !== d) dias = dias.filter((x) => x !== dOrigen);
        if (!dias.includes(d)) dias.push(d);
      }
      return ponerDiasWarehouse(dias);
    }
    if (destino === "__wh") return toast("Ahí solo va el warehouse. Suelta la tienda en un día.");
    const t = S.porId.get(id);
    if (!destino) {
      quitarDePlan(id);
      S.plan.fijadas.delete(id);
      marcarSucio();
      return renderTodo();
    }
    if (destino === origen) {
      // Reordenar dentro del mismo día: queda antes de la tienda donde se soltó.
      const objetivo = e.target.closest(".rt-parada");
      const arr = S.plan.slots[destino];
      arr.splice(arr.indexOf(id), 1);
      const idx = objetivo && objetivo.dataset.id !== id ? arr.indexOf(objetivo.dataset.id) : arr.length;
      arr.splice(idx < 0 ? arr.length : idx, 0, id);
      marcarSucio();
      renderPlan();
      return renderStats();
    }
    const p = patronMovido(t, origen, destino);
    if (!p) return;
    aplicarPatron(id, p, true);
    renderTodo();
  });

  // Patrón nuevo al arrastrar una visita de `origen` a `destino` (slots
  // "A1"...). En 2x..5x solo cambia el día arrastrado y los otros se quedan
  // (L+J arrastrando el jueves al martes = L+M), igual en semana A y B.
  function patronMovido(t, origen, destino) {
    const etiqueta = R.ETIQUETA_FREQ[t.freq].toLowerCase();
    const todos = R.patrones(t.freq, S.dias, true);
    if (!todos.length) {
      toast(T("Con los días de trabajo {dias} no cabe una tienda {freq}.", { dias: nombreDias(S.dias), freq: etiqueta }));
      return null;
    }
    const dDest = Number(destino[1]);
    if (R.veces(t.freq) && origen) {
      const actual = R.patronActual(t.id, t.freq, S.dias, S.plan.slots);
      if (actual) {
        const dias = actual.clave.split("+").map(Number);
        const dOrig = Number(origen[1]);
        if (dias.includes(dDest)) {
          toast(T("{tienda} ya va el {dia}.", { tienda: t.nombre, dia: I.idioma === "en" ? R.DIAS[dDest] : R.DIAS[dDest].toLowerCase() }));
          return null;
        }
        const nuevos = dias.map((d) => (d === dOrig ? dDest : d)).sort((a, b) => a - b);
        return todos.find((p) => p.clave === nuevos.join("+")) || null;
      }
    }
    // Desde "Sin asignar" (o semanal/quincenal): el mejor patrón que incluya ese día.
    return R.patronConSlot(t.freq, S.dias, destino) || todos.find((p) => p.slots.includes(destino)) || null;
  }

  function renderMapa() {
    if (!window.L) return;
    if (!S.mapa) {
      S.mapa = L.map("mapa", { scrollWheelZoom: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(S.mapa);
      S.capa = L.layerGroup().addTo(S.mapa);
      S.mapa.setView([38.9, -77.3], 9);
    }
    S.capa.clearLayers();
    const pos = posiciones();
    const limites = [];
    S.dias.forEach((d) => {
      if (S.ocultos.has(d)) return;
      const k = `${S.semana}${d}`;
      const ids = (S.plan.slots[k] || []).filter((id) => pos[id]);
      const puntos = ids.map((id) => [pos[id].lat, pos[id].lng]);
      const sal = salidaDe(k);
      if (sal && puntos.length) puntos.unshift([sal.lat, sal.lng]);
      if (puntos.length > 1) L.polyline(puntos, { color: COLORES[d], weight: 3, opacity: 0.75 }).addTo(S.capa);
      ids.forEach((id, i) => {
        const t = S.porId.get(id);
        const icono = L.divIcon({ className: "", html: `<div class="rt-num-icono" style="background:${COLORES[d]}">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
        L.marker([pos[id].lat, pos[id].lng], { icon: icono, title: t.nombre })
          .bindPopup(`<b>${esc(t.nombre)}</b><br>${esc(t.direccion)}, ${esc(t.ciudad)}<br>${R.DIAS[d]} · ${T("Parada {n}", { n: i + 1 })}<br>${R.ETIQUETA_FREQ[t.freq]} · $${Math.round(t.ventaSem)}${T("/sem")}`)
          .addTo(S.capa);
        limites.push([pos[id].lat, pos[id].lng]);
      });
    });
    sinAsignar().forEach((t) => {
      if (!pos[t.id]) return;
      L.circleMarker([pos[t.id].lat, pos[t.id].lng], { radius: 7, color: "#666", fillColor: "#bbb", fillOpacity: 0.9, weight: 2 })
        .bindPopup(`<b>${esc(t.nombre)}</b><br>Sin asignar`)
        .addTo(S.capa);
      limites.push([pos[t.id].lat, pos[t.id].lng]);
    });
    const w = S.plan.warehouse;
    if (w && esPunto(w)) {
      L.marker([+w.lat, +w.lng], { icon: L.divIcon({ className: "", html: '<div class="rt-inicio-icono"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), title: w.nombre })
        .bindPopup(`<b>${esc(w.nombre)}</b><br>${T("Warehouse · carga {dias}", { dias: S.plan.whDias.length ? esc(nombreDias(S.plan.whDias)) : T("— sin días asignados") })}`)
        .addTo(S.capa);
      limites.push([+w.lat, +w.lng]);
    }
    if (S.plan.inicio) {
      L.marker([S.plan.inicio.lat, S.plan.inicio.lng], { icon: L.divIcon({ className: "", html: '<div class="rt-inicio-icono" style="background:var(--gray)"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), title: "Salida" })
        .bindPopup(w ? "Salida los días sin warehouse" : "Punto de salida")
        .addTo(S.capa);
      limites.push([S.plan.inicio.lat, S.plan.inicio.lng]);
    }
    if (S.ajustarMapa && limites.length) {
      S.mapa.invalidateSize();
      S.mapa.fitBounds(limites, { padding: [24, 24] });
      S.ajustarMapa = false;
    }
    $("leyenda").innerHTML = S.dias
      .map((d) => `<button data-dia="${d}" aria-pressed="${!S.ocultos.has(d)}"><i style="background:${COLORES[d]}"></i>${R.DIAS[d]}</button>`)
      .join("");
  }

  $("leyenda").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dia]");
    if (!b) return;
    const d = Number(b.dataset.dia);
    S.ocultos.has(d) ? S.ocultos.delete(d) : S.ocultos.add(d);
    renderMapa();
  });

  // --------------------------------------------------------------------------
  // Tabla de tiendas y frecuencias
  // --------------------------------------------------------------------------

  function diasDeTienda(id) {
    return Object.keys(S.plan.slots)
      .filter((k) => S.plan.slots[k].includes(id))
      .sort()
      .map((k) => `${k[0]}·${R.DIAS[Number(k[1])].slice(0, 3)}`)
      .join(", ");
  }

  function renderTabla() {
    const filas = S.tiendas
      .map((t) => {
        const opciones = ["5x", "4x", "3x", "2x", "1x", "q", "fuera"]
          .map((f) => `<option value="${f}" ${t.freq === f ? "selected" : ""}>${R.ETIQUETA_FREQ[f]}${f === t.freqRegla ? T(" (regla)") : ""}</option>`)
          .join("");
        const ibp = [T(t.estatus || "sin revisar"), t.frecuencia || "", (t.dias_visita || []).join("/")].filter(Boolean).join(" · ");
        return `<tr>
          <td><b>${esc(t.nombre)}</b><br><span class="rt-nota">${esc(t.id)} · ${esc(t.direccion)}, ${esc(t.ciudad)}</span></td>
          <td>${esc(t.tipo_cuenta)}</td>
          <td class="num">$${Math.round(t.ventaSem)}</td>
          <td>${esc(traducirRegla(t.regla))}</td>
          <td>${S.soloLectura ? R.ETIQUETA_FREQ[t.freq] : `<select data-freq="${esc(t.id)}">${opciones}</select>`}</td>
          <td>${esc(diasDeTienda(t.id)) || '<span class="rt-nota">—</span>'}</td>
          <td class="rt-nota">${esc(ibp)}</td>
          <td>${S.geo.has(t.id) ? '<span class="rt-ok">Sí</span>' : '<span class="rt-no">No</span>'}</td>
        </tr>`;
      })
      .join("");
    $("tablaTiendas").innerHTML = `<thead><tr><th>Tienda</th><th>Cuenta</th><th>Venta/sem</th><th>Regla</th><th>Frecuencia</th><th>Días en el plan</th><th>Mi Territorio (IBP)</th><th>Ubicación</th></tr></thead><tbody>${filas}</tbody>`;
  }

  $("tablaTiendas").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-freq]");
    if (!sel) return;
    const t = S.porId.get(sel.dataset.freq);
    t.freq = sel.value;
    if (t.freq === t.freqRegla) delete S.plan.frecuencias[t.id];
    else S.plan.frecuencias[t.id] = t.freq;
    const tocados = quitarDePlan(t.id);
    S.plan.fijadas.delete(t.id);
    S.plan.slots = R.reordenarSlots(S.plan.slots, tocados, posiciones(), salidaDe);
    if (t.freq !== "fuera") ponerMejor(t.id);
    marcarSucio();
    renderTodo();
    toast(T("{tienda}: {freq}.", { tienda: t.nombre, freq: R.ETIQUETA_FREQ[t.freq] }));
  });

  // --------------------------------------------------------------------------
  // Ubicaciones
  // --------------------------------------------------------------------------

  function renderUbicaciones() {
    const total = S.tiendas.length;
    const con = S.tiendas.filter((t) => S.geo.has(t.id)).length;
    const porFuente = {};
    S.geo.forEach((g) => (porFuente[g.fuente] = (porFuente[g.fuente] || 0) + 1));
    $("ubiResumen").textContent = T("{con} de {total} tiendas de esta ruta tienen ubicación", { con, total }) +
      (con ? ` (${Object.entries(porFuente).map(([f, n]) => `${n} ${f === "census" ? "Census" : f === "osm" ? "OpenStreetMap" : "manual"}`).join(", ")}).` : ".");
    const filas = S.tiendas
      .slice()
      .sort((a, b) => Number(S.geo.has(a.id)) - Number(S.geo.has(b.id)) || a.nombre.localeCompare(b.nombre))
      .map((t) => {
        const g = S.geo.get(t.id);
        const fuente = g ? (g.fuente === "census" ? "Census" : g.fuente === "osm" ? "OpenStreetMap" : "Manual") : '<span class="rt-no">Falta</span>';
        const valor = g ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}` : "";
        return `<tr><td><b>${esc(t.nombre)}</b><br><span class="rt-nota">${esc(t.id)}</span></td>
          <td>${esc(t.direccion)}, ${esc(t.ciudad)}, ${esc(t.estado_us)} ${esc(t.zip)}</td>
          <td>${fuente}</td>
          <td>${S.soloLectura ? esc(valor) : `<input type="text" data-geo="${esc(t.id)}" value="${esc(valor)}" placeholder="lat, lng" style="width:190px" />`}</td></tr>`;
      })
      .join("");
    $("tablaUbicaciones").innerHTML = `<thead><tr><th>Tienda</th><th>Dirección</th><th>Fuente</th><th>Coordenadas</th></tr></thead><tbody>${filas}</tbody>`;
  }

  $("tablaUbicaciones").addEventListener("change", async (e) => {
    const inp = e.target.closest("input[data-geo]");
    if (!inp) return;
    const id = inp.dataset.geo;
    const p = parsearLatLng(inp.value);
    if (!p) return toast("Pega las coordenadas como “lat, lng”, por ejemplo 39.0123, -77.4567.");
    try {
      await D.guardarGeo([{ tienda_id: id, lat: p.lat, lng: p.lng, fuente: "manual" }]);
      S.geo.set(id, { tienda_id: id, lat: p.lat, lng: p.lng, fuente: "manual" });
      S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots).filter((k) => S.plan.slots[k].includes(id)), posiciones(), salidaDe);
      S.ajustarMapa = true;
      renderTodo();
      toast("Ubicación guardada.");
    } catch (err) {
      toast(T("No se guardó la ubicación: {e}", { e: err.message }));
    }
  });

  function archivoCensus(tiendas) {
    // Formato del Census batch: Unique ID, Street address, City, State, ZIP — sin encabezado.
    return tiendas.map((t) => [t.id, t.direccion, t.ciudad, t.estado_us, t.zip].map(csvCampo).join(",")).join("\n") + "\n";
  }

  $("btnCensusRuta").onclick = () => {
    const faltan = S.tiendas.filter((t) => !S.geo.has(t.id));
    if (!faltan.length) return toast("Todas las tiendas de esta ruta ya tienen ubicación.");
    descargar(`census_ruta_${S.ruta}.csv`, archivoCensus(faltan), "text/csv");
  };

  $("btnCensusTodas").onclick = async () => {
    $("ubiMensaje").textContent = "Preparando el archivo de todas las rutas…";
    try {
      const todas = S.tiendasTodas || (S.tiendasTodas = await D.getTiendasBasicas());
      const geo = await D.getGeo(todas.map((t) => t.id));
      const faltan = todas.filter((t) => !geo.has(t.id));
      if (!faltan.length) return ($("ubiMensaje").textContent = "Todas las tiendas ya tienen ubicación.");
      descargar(`census_todas_${faltan.length}.csv`, archivoCensus(faltan), "text/csv");
      $("ubiMensaje").textContent = T("Archivo con {n} tiendas sin ubicación (el Census acepta hasta 10,000 por archivo).", { n: faltan.length });
    } catch (e) {
      $("ubiMensaje").textContent = T("No se pudo preparar el archivo: {e}", { e: e.message });
    }
  };

  $("fileCensus").onchange = async (e) => {
    const archivo = e.target.files[0];
    e.target.value = "";
    if (!archivo) return;
    $("ubiMensaje").textContent = "Leyendo el resultado del Census…";
    try {
      const filas = parsearCsv(await archivo.text());
      // Columnas del resultado: ID, dirección enviada, Match/No_Match/Tie,
      // Exact/Non_Exact, dirección encontrada, "lon,lat", TIGER id, lado.
      const encontrados = [];
      let sinMatch = 0;
      filas.forEach((f) => {
        const id = (f[0] || "").trim();
        if (!id || !/^match$/i.test((f[2] || "").trim())) { if (id) sinMatch++; return; }
        const [lng, lat] = String(f[5] || "").split(",").map(Number);
        if (isFinite(lat) && isFinite(lng) && lat && lng) encontrados.push({ tienda_id: id, lat, lng, fuente: "census" });
        else sinMatch++;
      });
      if (!encontrados.length) {
        $("ubiMensaje").textContent = "El archivo no trae coordenadas reconocibles. Revisa que sea el resultado del Census (Address Batch).";
        return;
      }
      const todas = S.tiendasTodas || (S.tiendasTodas = await D.getTiendasBasicas());
      const existentes = new Set(todas.map((t) => t.id));
      const validos = encontrados.filter((g) => existentes.has(g.tienda_id));
      const actuales = await D.getGeo(validos.map((g) => g.tienda_id));
      const aGuardar = validos.filter((g) => !actuales.has(g.tienda_id) || actuales.get(g.tienda_id).fuente !== "manual");
      await D.guardarGeo(aGuardar);
      S.geo = await D.getGeo(S.tiendas.map((t) => t.id));
      S.ajustarMapa = true;
      renderTodo();
      const manuales = validos.length - aGuardar.length;
      $("ubiMensaje").textContent =
        T("Guardadas {n} ubicaciones del Census.", { n: aGuardar.length }) +
        (sinMatch ? T(" {n} direcciones no tuvieron coincidencia (búscalas en OpenStreetMap o ponlas a mano).", { n: sinMatch }) : "") +
        (manuales ? T(" {n} no se tocaron porque ya tenían ubicación manual.", { n: manuales }) : "") +
        (encontrados.length - validos.length ? T(" {n} códigos no existen en la base.", { n: encontrados.length - validos.length }) : "");
    } catch (err) {
      console.error(err);
      $("ubiMensaje").textContent = T("No se pudo importar: {e}", { e: err.message });
    }
  };

  // OpenStreetMap (Nominatim): máximo 1 consulta por segundo.
  let osmCorriendo = false;
  function limpiarCalle(dir) {
    return String(dir || "")
      .replace(/^(\d+)[A-Z]\b/i, "$1") // "1421Q CENTREVILLE SQ" -> "1421 CENTREVILLE SQ"
      .replace(/\s+(STE|SUITE|UNIT|#)\s*\S+$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function buscarOsm(t) {
    const base = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us";
    const calle = limpiarCalle(t.direccion);
    const urls = [
      `${base}&street=${encodeURIComponent(calle)}&city=${encodeURIComponent(t.ciudad)}&state=${encodeURIComponent(t.estado_us)}&postalcode=${encodeURIComponent(t.zip)}`,
      `${base}&q=${encodeURIComponent(`${calle}, ${t.ciudad}, ${t.estado_us} ${t.zip}`)}`,
    ];
    for (let i = 0; i < urls.length; i++) {
      if (i) await esperar(1100);
      const r = await fetch(urls[i], { headers: { "Accept-Language": "en" } });
      if (!r.ok) continue;
      const data = await r.json();
      if (data && data[0]) return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
    }
    return null;
  }

  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

  // --------------------------------------------------------------------------
  // Ubicación automática: Census (JSONP, una dirección a la vez — el Census no
  // acepta CORS, así que es la vía que su documentación indica para páginas
  // web) y OpenStreetMap como respaldo para las que el Census no encuentre.
  // --------------------------------------------------------------------------

  let jsonpN = 0;
  function censusJsonp(t) {
    return new Promise((ok) => {
      const cb = `__census${Date.now()}_${jsonpN++}`;
      const params = new URLSearchParams({
        street: limpiarCalle(t.direccion),
        city: t.ciudad || "",
        state: t.estado_us || "",
        zip: t.zip || "",
        benchmark: "Public_AR_Current",
        format: "jsonp",
        callback: cb,
      });
      const s = document.createElement("script");
      let listo = false;
      const fin = (valor) => {
        if (listo) return;
        listo = true;
        clearTimeout(timer);
        delete window[cb];
        s.remove();
        ok(valor);
      };
      const timer = setTimeout(() => fin(null), 20000);
      window[cb] = (data) => {
        const m = data && data.result && data.result.addressMatches && data.result.addressMatches[0];
        fin(m && m.coordinates ? { lat: Number(m.coordinates.y), lng: Number(m.coordinates.x) } : null);
      };
      s.onerror = () => fin(null);
      s.src = `https://geocoding.geo.census.gov/geocoder/locations/address?${params}`;
      document.head.appendChild(s);
    });
  }

  let ubicando = null; // { cancelado: bool }

  /**
   * Busca coordenadas para `tiendas`: Census (4 a la vez) y luego
   * OpenStreetMap (1 por segundo) para las que falten. Guarda en Supabase.
   * progreso(hechas, total, encontradas, fase)
   * Devuelve { encontradas, noEncontradas: [tiendas], cancelado }.
   */
  async function geocodificar(tiendas, progreso) {
    if (ubicando) ubicando.cancelado = true;
    const yo = { cancelado: false };
    ubicando = yo;
    const pendientes = [];
    const encontradas = [];
    let hechas = 0, porGuardar = [];

    const guardar = async () => {
      if (!porGuardar.length) return;
      const lote = porGuardar;
      porGuardar = [];
      try { await D.guardarGeo(lote); } catch (e) { console.error(e); }
    };
    const anotar = (t, p, fuente) => {
      const fila = { tienda_id: t.id, lat: p.lat, lng: p.lng, fuente };
      porGuardar.push(fila);
      encontradas.push(fila);
      if (S.porId.has(t.id)) S.geo.set(t.id, fila);
    };

    // Census, 4 en paralelo
    const cola = tiendas.slice();
    const trabajador = async () => {
      while (cola.length && !yo.cancelado) {
        const t = cola.shift();
        const p = await censusJsonp(t);
        if (p && isFinite(p.lat) && isFinite(p.lng)) anotar(t, p, "census");
        else pendientes.push(t);
        hechas++;
        progreso(hechas, tiendas.length, encontradas.length, "Census");
        if (porGuardar.length >= 25) await guardar();
      }
    };
    await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
    await guardar();

    // OpenStreetMap para las que faltan (Nominatim pide máx. 1 por segundo)
    const noEncontradas = [];
    for (let i = 0; i < pendientes.length && !yo.cancelado; i++) {
      const t = pendientes[i];
      let p = null;
      try { p = await buscarOsm(t); } catch (e) { p = null; }
      if (p && isFinite(p.lat) && isFinite(p.lng)) anotar(t, p, "osm");
      else noEncontradas.push(t);
      progreso(i + 1, pendientes.length, encontradas.length, "OpenStreetMap");
      if (porGuardar.length >= 10) await guardar();
      await esperar(1100);
    }
    await guardar();
    if (ubicando === yo) ubicando = null;
    return { encontradas: encontradas.length, noEncontradas, cancelado: yo.cancelado };
  }

  async function ubicarRutaActual(faltan, calcularAlTerminar) {
    const ruta = S.ruta;
    const est = $("estadoGuardado");
    const res = await geocodificar(faltan, (h, n, enc, fase) => {
      if (S.ruta !== ruta) return;
      est.textContent = T("Ubicando tiendas ({fase}): {h} de {n}…", { fase, h, n });
    });
    if (res.cancelado || S.ruta !== ruta) return;
    S.ajustarMapa = true;
    const msg = res.noEncontradas.length
      ? T("{n} tiendas ubicadas. {m} sin ubicación: ponlas a mano en la pestaña Ubicaciones.", { n: res.encontradas, m: res.noEncontradas.length })
      : T("{n} tiendas ubicadas.", { n: res.encontradas });
    est.textContent = msg;
    if (calcularAlTerminar && S.tiendas.some((t) => S.geo.has(t.id))) {
      calcular();
      toast(T("{msg} Plan calculado: revísalo y presiona Guardar.", { msg }));
    } else {
      // Las tiendas recién ubicadas que ya estaban en el plan: recalcular el orden.
      S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), salidaDe);
      renderTodo();
      toast(msg);
    }
  }

  $("btnUbicarTodas").onclick = async () => {
    if (ubicando) return toast("Ya hay una búsqueda de ubicaciones en curso.");
    $("btnUbicarTodas").disabled = true;
    $("progreso").hidden = false;
    $("ubiMensaje").textContent = "Revisando qué tiendas no tienen ubicación…";
    try {
      const todas = S.tiendasTodas || (S.tiendasTodas = await D.getTiendasBasicas());
      const geo = await D.getGeo(todas.map((t) => t.id));
      const faltan = todas.filter((t) => !geo.has(t.id));
      if (!faltan.length) {
        $("ubiMensaje").textContent = "Todas las tiendas de todas las rutas ya tienen ubicación.";
        return;
      }
      const res = await geocodificar(faltan, (h, n, enc, fase) => {
        $("progreso").firstElementChild.style.width = `${(h / n) * 100}%`;
        $("ubiMensaje").textContent = T("{fase}: {h} de {n} · {enc} ubicadas. Deja la página abierta.", { fase, h, n, enc });
      });
      S.ajustarMapa = true;
      renderTodo();
      $("ubiMensaje").textContent = res.cancelado
        ? T("Búsqueda interrumpida. Lo ya encontrado quedó guardado; presiona de nuevo para seguir.")
        : T("Listo: {n} de {total} tiendas ubicadas.", { n: res.encontradas, total: faltan.length }) +
          (res.noEncontradas.length ? T(" Sin ubicación ({n}): {lista}. Ponlas a mano.", { n: res.noEncontradas.length, lista: res.noEncontradas.slice(0, 30).map((t) => t.nombre).join(", ") + (res.noEncontradas.length > 30 ? "…" : "") }) : "");
    } catch (e) {
      console.error(e);
      $("ubiMensaje").textContent = T("No se pudo completar: {e}", { e: e.message });
    } finally {
      $("btnUbicarTodas").disabled = false;
      $("progreso").hidden = true;
    }
  };

  $("btnOsm").onclick = async () => {
    if (osmCorriendo) { osmCorriendo = false; return; }
    const faltan = S.tiendas.filter((t) => !S.geo.has(t.id));
    if (!faltan.length) return toast("Todas las tiendas de esta ruta ya tienen ubicación.");
    osmCorriendo = true;
    $("btnOsm").textContent = T("Detener búsqueda");
    $("progreso").hidden = false;
    let hechas = 0, encontradas = 0;
    const noEncontradas = [];
    for (const t of faltan) {
      if (!osmCorriendo) break;
      try {
        const p = await buscarOsm(t);
        if (p) {
          await D.guardarGeo([{ tienda_id: t.id, lat: p.lat, lng: p.lng, fuente: "osm" }]);
          S.geo.set(t.id, { tienda_id: t.id, lat: p.lat, lng: p.lng, fuente: "osm" });
          encontradas++;
        } else noEncontradas.push(t.nombre);
      } catch (e) {
        noEncontradas.push(t.nombre);
      }
      hechas++;
      $("progreso").firstElementChild.style.width = `${(hechas / faltan.length) * 100}%`;
      $("ubiMensaje").textContent = T("Buscando {h} de {n}… ({enc} encontradas)", { h: hechas, n: faltan.length, enc: encontradas });
      await esperar(1100);
    }
    osmCorriendo = false;
    $("btnOsm").textContent = T("Buscar en OpenStreetMap las que faltan");
    $("progreso").hidden = true;
    S.ajustarMapa = true;
    renderTodo();
    $("ubiMensaje").textContent = T("OpenStreetMap encontró {enc} de {h}.", { enc: encontradas, h: hechas }) +
      (noEncontradas.length ? T(" Sin resultado: {lista}. Ponlas a mano desde Google Maps.", { lista: noEncontradas.join(", ") }) : "");
  };

  // --------------------------------------------------------------------------
  // Reglas
  // --------------------------------------------------------------------------

  function renderReglas() {
    const opciones = (f) => ["5x", "4x", "3x", "2x", "1x", "q"].map((x) => `<option value="${x}" ${x === f ? "selected" : ""}>${R.ETIQUETA_FREQ[x]}</option>`).join("");
    const dis = S.soloLectura ? "disabled" : "";
    $("reglasCadenas").innerHTML = S.reglas.cadenas
      .map((c, i) => `<div class="rt-regla-fila" data-i="${i}">
        <input data-campo="nombre" value="${esc(c.nombre)}" aria-label="Cadena" ${dis} />
        <input data-campo="patron" value="${esc(c.patron)}" aria-label="Patrón" ${dis} />
        <select data-campo="freq" aria-label="Frecuencia" ${dis}>${opciones(c.freq)}</select>
        <input data-campo="dosVecesSobre" type="number" min="0" value="${c.dosVecesSobre == null ? "" : c.dosVecesSobre}" placeholder="—" aria-label="2x si venta mayor a" ${dis} />
        <input data-campo="tresVecesSobre" type="number" min="0" value="${c.tresVecesSobre == null ? "" : c.tresVecesSobre}" placeholder="—" aria-label="3x si venta mayor a" ${dis} />
        ${S.soloLectura ? "<span></span>" : `<button class="btn btn-secondary btn-small" data-quitar="${i}">Quitar</button>`}
      </div>`)
      .join("");
    $("numMuyAlta").value = S.reglas.ventaMuyAlta == null ? "" : S.reglas.ventaMuyAlta;
    $("numAlta").value = S.reglas.ventaAlta == null ? "" : S.reglas.ventaAlta;
    $("numBaja").value = S.reglas.ventaBaja == null ? "" : S.reglas.ventaBaja;
    $("numMuyAlta").disabled = $("numAlta").disabled = $("numBaja").disabled = S.soloLectura;
  }

  function leerReglas() {
    const cadenas = [...document.querySelectorAll(".rt-regla-fila[data-i]")].map((fila) => {
      const v = (c) => fila.querySelector(`[data-campo="${c}"]`).value.trim();
      const dos = v("dosVecesSobre");
      const tres = v("tresVecesSobre");
      return { nombre: v("nombre"), patron: v("patron"), freq: v("freq"), dosVecesSobre: dos === "" ? null : Number(dos), tresVecesSobre: tres === "" ? null : Number(tres) };
    }).filter((c) => c.nombre && c.patron);
    for (const c of cadenas) {
      try { new RegExp(c.patron, "i"); } catch (e) { throw new Error(T("El patrón de {c} no es válido.", { c: c.nombre })); }
    }
    const num = (id) => ($(id).value.trim() === "" ? null : Number($(id).value));
    return { cadenas, ventaMuyAlta: num("numMuyAlta"), ventaAlta: num("numAlta"), ventaBaja: num("numBaja") };
  }

  $("reglasCadenas").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-quitar]");
    if (!b) return;
    S.reglas = leerReglas();
    S.reglas.cadenas.splice(Number(b.dataset.quitar), 1);
    renderReglas();
  });

  $("btnAgregarRegla").onclick = () => {
    S.reglas = leerReglas();
    S.reglas.cadenas.push({ nombre: "Nueva cadena", patron: "", freq: "1x", dosVecesSobre: null, tresVecesSobre: null });
    renderReglas();
  };

  $("btnGuardarReglas").onclick = async () => {
    let nuevas;
    try { nuevas = leerReglas(); } catch (e) { return toast(e.message); }
    S.reglas = nuevas;
    try {
      await D.guardarConfigRutas("reglas", nuevas);
    } catch (e) {
      return toast(errorTablasFaltantes(e) ? "No se guardaron: faltan las tablas del planificador en Supabase." : T("No se guardaron: {e}", { e: e.message }));
    }
    // Recalcula la frecuencia por regla de la ruta cargada.
    let cambiaron = 0;
    S.tiendas.forEach((t) => {
      const base = frecuenciaBase(t);
      t.freqRegla = base.freq;
      t.regla = base.regla;
      const nueva = S.plan.frecuencias[t.id] || t.freqRegla;
      if (nueva !== t.freq) {
        t.freq = nueva;
        quitarDePlan(t.id);
        S.plan.fijadas.delete(t.id);
        if (nueva !== "fuera") ponerMejor(t.id);
        cambiaron++;
      }
    });
    if (cambiaron) marcarSucio();
    renderTodo();
    renderReglas();
    toast(cambiaron ? T("Reglas guardadas. {n} tiendas cambiaron de frecuencia: revisa el plan o recalcúlalo.", { n: cambiaron }) : "Reglas guardadas.");
  };

  // --------------------------------------------------------------------------
  // Exportar
  // --------------------------------------------------------------------------

  function colorKml(hex) {
    const h = hex.replace("#", "");
    return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
  }

  function kmlSemana(w) {
    const pos = posiciones();
    const x = (s) => esc(s);
    let estilos = "", carpetas = "";
    S.dias.forEach((d) => {
      const k = `${w}${d}`;
      const ids = (S.plan.slots[k] || []).filter((id) => pos[id]);
      estilos += `<Style id="d${d}"><IconStyle><color>${colorKml(COLORES[d])}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle><LineStyle><color>${colorKml(COLORES[d])}</color><width>3</width></LineStyle></Style>`;
      if (!ids.length) return;
      const marcas = ids
        .map((id, i) => {
          const t = S.porId.get(id);
          return `<Placemark><name>${i + 1}. ${x(t.nombre)}</name><description>${x(`${t.direccion}, ${t.ciudad}, ${t.estado_us} ${t.zip} · ${R.ETIQUETA_FREQ[t.freq]} · Tienda ${t.id}`)}</description><styleUrl>#d${d}</styleUrl><Point><coordinates>${pos[id].lng},${pos[id].lat},0</coordinates></Point></Placemark>`;
        })
        .join("");
      const sal = salidaDe(k);
      const coords = (sal ? [`${sal.lng},${sal.lat},0`] : []).concat(ids.map((id) => `${pos[id].lng},${pos[id].lat},0`)).join(" ");
      carpetas += `<Folder><name>${R.DIAS[d]} (${ids.length})</name>${marcas}<Placemark><name>Recorrido ${R.DIAS[d]}</name><styleUrl>#d${d}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark></Folder>`;
    });
    const wh = S.plan.warehouse;
    let salida = wh && esPunto(wh) ? `<Placemark><name>Warehouse · ${x(wh.nombre)}</name><description>${x(`Carga: ${nombreDias(S.plan.whDias) || "—"}`)}</description><Point><coordinates>${wh.lng},${wh.lat},0</coordinates></Point></Placemark>` : "";
    if (S.plan.inicio) salida += `<Placemark><name>Salida</name><Point><coordinates>${S.plan.inicio.lng},${S.plan.inicio.lat},0</coordinates></Point></Placemark>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Ruta ${x(S.ruta)} · Semana ${w}</name>${estilos}${salida}${carpetas}</Document></kml>`;
  }

  $("btnKmlA").onclick = () => descargar(`Ruta_${S.ruta}_SemanaA.kml`, kmlSemana("A"), "application/vnd.google-earth.kml+xml");
  $("btnKmlB").onclick = () => descargar(`Ruta_${S.ruta}_SemanaB.kml`, kmlSemana("B"), "application/vnd.google-earth.kml+xml");

  // --------------------------------------------------------------------------
  // Hoja para el IBP (imprimir): semana A y B, un bloque por día con el orden
  // de paradas; el warehouse arriba en sus días. Sale en el idioma de la página.
  // --------------------------------------------------------------------------

  function htmlHoja() {
    const info = S.rutas.find((r) => r.ruta === S.ruta) || {};
    const w = S.plan.warehouse;
    const mi = R.millasDeSlots(S.plan.slots, posiciones(), salidaDe);
    const dirTienda = (t) => [t.direccion, t.ciudad, `${t.estado_us || ""} ${t.zip || ""}`.trim()].filter(Boolean).join(", ");
    let html = `<h1>${esc(T("Ruta {ruta}", { ruta: S.ruta }))}${info.propietario ? ` · ${esc(info.propietario)}` : ""}</h1>
      <p class="sub">${esc(T("Plan de visitas · Semana A y B"))} · ${esc(T("Días de trabajo: {dias}", { dias: nombreDias(S.dias) }))}</p>`;
    if (w) {
      html += `<p class="sub">${esc(T("Warehouse: {w}", { w: w.nombre }))}${dirTienda(w) ? ` — ${esc(dirTienda(w))}` : ""} · ${esc(T("Carga: {dias}", { dias: S.plan.whDias.length ? nombreDias(S.plan.whDias) : "—" }))}</p>`;
    }
    html += `<p class="sub">${esc(T("Impreso {fecha}", { fecha: new Date().toLocaleDateString(I.locale) }))}</p>`;
    ["A", "B"].forEach((sem) => {
      html += `<section class="semana"><h2>${esc(T(`Semana ${sem}`))}</h2>`;
      S.dias.forEach((d) => {
        const k = `${sem}${d}`;
        const ids = (S.plan.slots[k] || []).filter((id) => S.porId.has(id));
        const conWh = w && S.plan.whDias.includes(d);
        html += `<div class="dia"><h3><span>${esc(R.DIAS[d])}</span><small>${esc(T("{n} paradas · ~{mi} mi", { n: ids.length, mi: Math.round(mi[k] || 0) }))}</small></h3>`;
        if (!ids.length && !conWh) {
          html += `<p class="vacio">${esc(T("Sin visitas"))}</p></div>`;
          return;
        }
        html += `<table><thead><tr><th>#</th><th>${esc(T("Tienda"))}</th><th>${esc(T("Código"))}</th><th>${esc(T("Dirección"))}</th><th>${esc(T("Frecuencia"))}</th><th>${esc(T("Hecho"))}</th></tr></thead><tbody>`;
        if (conWh) {
          html += `<tr class="wh"><td class="n">W</td><td>${esc(w.nombre)}</td><td></td><td>${esc(dirTienda(w))}</td><td>${esc(T("Carga"))}</td><td class="ok"></td></tr>`;
        }
        ids.forEach((id, i) => {
          const t = S.porId.get(id);
          html += `<tr><td class="n">${i + 1}</td><td>${esc(t.nombre)}</td><td>${esc(t.id)}</td><td>${esc(dirTienda(t))}</td><td>${esc(R.ETIQUETA_FREQ[t.freq])}</td><td class="ok"></td></tr>`;
        });
        html += `</tbody></table></div>`;
      });
      html += `</section>`;
    });
    return html;
  }

  $("btnImprimir").onclick = () => {
    if (!S.plan) return;
    const avisos = [];
    if (S.sucio) avisos.push(T("Ojo: hay cambios sin guardar; se imprime lo que ves en pantalla."));
    const sin = sinAsignar().length;
    if (sin) avisos.push(T("{n} tiendas sin asignar no salen en la hoja.", { n: sin }));
    if (avisos.length) toast(avisos.join(" "));
    const hoja = $("hoja");
    hoja.innerHTML = htmlHoja();
    const titulo = document.title;
    document.title = `${T("Ruta {ruta}", { ruta: S.ruta })} · ${T("Plan de visitas · Semana A y B")}`;
    setTimeout(() => {
      window.print();
      document.title = titulo;
    }, 50);
  };

  $("btnCsv").onclick = () => {
    const pos = posiciones();
    const filas = [["Semana", "Dia", "Orden", "Tienda", "Codigo", "Cuenta", "Direccion", "Frecuencia", "Venta_sem", "Lat", "Lng"]];
    const wh = S.plan.warehouse;
    ["A", "B"].forEach((w) => S.dias.forEach((d) => {
      if (wh && S.plan.whDias.includes(d)) {
        filas.push([w, R.DIAS[d], 0, `Warehouse · ${wh.nombre}`, "", "", [wh.direccion, wh.ciudad, `${wh.estado_us || ""} ${wh.zip || ""}`.trim()].filter(Boolean).join(", "), "Carga", "", wh.lat, wh.lng]);
      }
      (S.plan.slots[`${w}${d}`] || []).forEach((id, i) => {
        const t = S.porId.get(id);
        filas.push([w, R.DIAS[d], i + 1, t.nombre, t.id, t.tipo_cuenta, `${t.direccion}, ${t.ciudad}, ${t.estado_us} ${t.zip}`, R.ETIQUETA_FREQ[t.freq], Math.round(t.ventaSem), pos[id] ? pos[id].lat : "", pos[id] ? pos[id].lng : ""]);
      });
    }));
    descargar(`Ruta_${S.ruta}_PlanAB.csv`, "﻿" + filas.map((f) => f.map(csvCampo).join(",")).join("\n"), "text/csv");
  };

  // --------------------------------------------------------------------------
  // Feriados: calendario (rutas_dias_especiales) y semana especial de la ruta
  // (rutas_plan_especial). El plan A/B (S.plan) no se toca: la semana especial
  // se arma como copia y se guarda aparte.
  // --------------------------------------------------------------------------

  const DIA_MS = 864e5;
  const pad2 = (n) => String(n).padStart(2, "0");
  const desdeIso = (s) => new Date(`${s}T00:00:00Z`);
  const aIso = (d) => d.toISOString().slice(0, 10);
  const sumarDias = (s, n) => aIso(new Date(desdeIso(s).getTime() + n * DIA_MS));
  const lunesDe = (s) => sumarDias(s, 1 - (desdeIso(s).getUTCDay() || 7));
  function hoyIso() {
    const n = new Date();
    return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
  }
  const fechaCorta = (s) => desdeIso(s).toLocaleDateString(I.locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const diaCorto = (d) => R.DIAS[d].slice(0, 3);

  S.feriados = [];
  S.semanaA = null; // lunes de una semana A (rutas_config "semanaA")
  S.planesEsp = new Map(); // lunes → fila guardada de esta ruta
  S.esp = null; // { semana, base, slots:{E1..}, whDias, fuera:[ids], movidas:Set, sucio, guardada }

  function errorTablasFeriados(e) {
    return /rutas_(dias_especiales|plan_especial)/.test(e.message) && /(does not exist|schema cache|not find)/i.test(e.message);
  }

  async function cargarFeriados() {
    try {
      S.feriados = await D.getDiasEspeciales(sumarDias(hoyIso(), -14), sumarDias(hoyIso(), 400));
      S.feriadosError = null;
    } catch (e) {
      S.feriados = [];
      S.feriadosError = errorTablasFeriados(e) ? T("Falta crear las tablas de feriados: corre scripts/calendario_especial.sql en Supabase.") : e.message;
    }
    try {
      const a = await D.getConfigRutas("semanaA");
      S.semanaA = a && a.lunes ? lunesDe(a.lunes) : null;
    } catch (e) { S.semanaA = null; }
  }

  async function cargarPlanesEspeciales() {
    S.planesEsp = new Map();
    S.esp = null;
    if (S.feriadosError || !S.ruta) return;
    try {
      const filas = await D.getPlanesEspeciales(S.ruta, lunesDe(hoyIso()));
      filas.forEach((f) => S.planesEsp.set(f.semana, f));
    } catch (e) { console.error(e); }
  }

  // Regla de cada día (1..7) de la semana que empieza en `lunes` para esta
  // ruta: { trabaja, nombre }. La de la ruta gana sobre la general.
  function reglasSemana(lunes) {
    const out = {};
    TODOS_DIAS.forEach((d) => {
      const f = sumarDias(lunes, d - 1);
      const delDia = S.feriados.filter((x) => x.fecha === f && (!x.ibp_id || x.ibp_id === S.ruta));
      const r = delDia.find((x) => x.ibp_id) || delDia[0];
      if (r) out[d] = { trabaja: !!r.trabaja, nombre: r.nombre || "" };
    });
    return out;
  }

  // Días con ruta esa semana: los de siempre menos los feriados, más los extra.
  function diasDeSemana(lunes) {
    const r = reglasSemana(lunes);
    return TODOS_DIAS.filter((d) => (r[d] ? r[d].trabaja : S.dias.includes(d)));
  }

  function nombreSemana(lunes) {
    const r = reglasSemana(lunes);
    return [...new Set(Object.values(r).map((x) => x.nombre).filter(Boolean))].join(" / ") || T("Semana especial");
  }

  // Semanas con algún feriado para esta ruta, desde esta semana.
  function semanasEspeciales() {
    const desde = lunesDe(hoyIso());
    const lunes = new Set(
      S.feriados.filter((x) => !x.ibp_id || x.ibp_id === S.ruta).map((x) => lunesDe(x.fecha)).filter((l) => l >= desde)
    );
    return [...lunes].sort().map((l) => {
      const dias = diasDeSemana(l);
      const cambia = dias.join() !== S.dias.join();
      return { lunes: l, nombre: nombreSemana(l), cambia };
    });
  }

  function baseDeSemana(lunes) {
    if (!S.semanaA) return null;
    const n = Math.round((desdeIso(lunes) - desdeIso(S.semanaA)) / (7 * DIA_MS));
    return ((n % 2) + 2) % 2 === 0 ? "A" : "B";
  }

  function salidaEsp(k) {
    const w = S.plan && S.plan.warehouse;
    if (w && esPunto(w) && S.esp && S.esp.whDias.includes(Number(k.slice(1)))) return { lat: +w.lat, lng: +w.lng };
    return (S.plan && S.plan.inicio) || null;
  }

  // Día con ruta más cercano a `d` (empate: el anterior) que cumpla `ok`.
  function diaCercano(d, trab, ok) {
    for (let k = 1; k < 7; k++) {
      for (const x of [d - k, d + k]) if (trab.includes(x) && ok(x)) return x;
    }
    return null;
  }

  // Arma la semana especial desde el plan normal (semana `base`): las visitas
  // de los días sin ruta pasan al día con ruta más cercano donde esa tienda
  // no esté ya; si no hay, quedan "fuera" (una visita menos esa semana).
  function proponerEspecial(lunes, base) {
    const trab = diasDeSemana(lunes);
    const slots = {};
    trab.forEach((d) => (slots[`E${d}`] = S.dias.includes(d) ? (S.plan.slots[`${base}${d}`] || []).filter((id) => S.porId.has(id)) : []));
    const movidas = new Set(), fuera = [], tocados = new Set();
    S.dias.filter((d) => !trab.includes(d)).forEach((d) => {
      (S.plan.slots[`${base}${d}`] || []).filter((id) => S.porId.has(id)).forEach((id) => {
        // El día con ruta más conveniente: cerca del feriado (mejor antes que
        // después) y sin cargarlo de más.
        let dest = null, mejor = Infinity;
        trab.forEach((x) => {
          if (slots[`E${x}`].includes(id)) return;
          const c = slots[`E${x}`].length + 2 * Math.abs(x - d) + (x > d ? 1 : 0);
          if (c < mejor) { mejor = c; dest = x; }
        });
        if (dest) { slots[`E${dest}`].push(id); movidas.add(`${id}@${dest}`); tocados.add(`E${dest}`); }
        else fuera.push(id);
      });
    });
    const whDias = [];
    (S.plan.warehouse ? S.plan.whDias : []).forEach((d) => {
      const x = trab.includes(d) ? d : diaCercano(d, trab, () => true);
      if (x && !whDias.includes(x)) whDias.push(x);
    });
    whDias.sort((a, b) => a - b);
    S.esp = { semana: lunes, base, slots, whDias, fuera, movidas, sucio: false, guardada: false };
    S.esp.slots = R.reordenarSlots(slots, [...tocados], posiciones(), salidaEsp);
  }

  // Carga la semana guardada (o la arma si no hay).
  function abrirSemana(lunes) {
    const g = S.planesEsp.get(lunes);
    if (!g) return proponerEspecial(lunes, baseDeSemana(lunes) || "A");
    const trab = diasDeSemana(lunes);
    const base = g.base === "B" ? "B" : "A";
    const slots = {};
    trab.forEach((d) => (slots[`E${d}`] = ((g.slots || {})[`E${d}`] || []).filter((id) => S.porId.has(id))));
    // Las que cambiaron de día respecto al plan normal, y las que faltan.
    const movidas = new Set();
    trab.forEach((d) => slots[`E${d}`].forEach((id) => { if (!(S.plan.slots[`${base}${d}`] || []).includes(id)) movidas.add(`${id}@${d}`); }));
    const cuenta = (lista) => lista.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
    const enBase = cuenta(S.dias.flatMap((d) => S.plan.slots[`${base}${d}`] || []).filter((id) => S.porId.has(id)));
    const enEsp = cuenta(Object.values(slots).flat());
    const fuera = [];
    enBase.forEach((n, id) => { for (let i = enEsp.get(id) || 0; i < n; i++) fuera.push(id); });
    S.esp = { semana: lunes, base, slots, whDias: limpiarDias(g.wh_dias).filter((d) => trab.includes(d)), fuera, movidas, sucio: false, guardada: true, cuando: g.actualizado_en, por: g.actualizado_por };
  }

  function marcarSucioEsp(v = true) {
    if (!S.esp) return;
    S.esp.sucio = v;
    renderEstadoEsp();
  }

  function renderEstadoEsp() {
    const el = $("estadoEsp");
    if (!S.esp) { el.textContent = ""; return; }
    el.classList.toggle("sucio", S.esp.sucio || !S.esp.guardada);
    el.textContent = S.esp.sucio
      ? T("Cambios sin guardar")
      : S.esp.guardada
        ? T("Guardada {fecha}{por}", { fecha: new Date(S.esp.cuando).toLocaleString(I.locale), por: S.esp.por ? T(" por {a}", { a: S.esp.por }) : "" })
        : T("Propuesta: todavía no está guardada");
  }

  // Aviso arriba de las pestañas si viene una semana con feriados (3 semanas).
  function renderAvisoFeriado() {
    const el = $("avisoFeriado");
    const limite = sumarDias(lunesDe(hoyIso()), 21);
    const prox = S.plan ? semanasEspeciales().find((s) => s.cambia && s.lunes <= limite) : null;
    if (!prox) { el.hidden = true; return; }
    const r = reglasSemana(prox.lunes);
    const off = S.dias.filter((d) => r[d] && !r[d].trabaja);
    const guardada = S.planesEsp.has(prox.lunes);
    el.innerHTML = `<span><b>${esc(prox.nombre)}</b> · ${esc(T("semana del {a} al {b}", { a: fechaCorta(prox.lunes), b: fechaCorta(sumarDias(prox.lunes, 6)) }))}${off.length ? ` · ${esc(T("sin ruta: {dias}", { dias: off.map((d) => `${diaCorto(d)} ${fechaCorta(sumarDias(prox.lunes, d - 1))}`).join(", ") }))}` : ""}</span>
      <span>${guardada ? esc(T("✓ Semana especial guardada")) : esc(T("Falta armar la semana especial."))}</span>
      <button type="button" class="btn ${guardada ? "btn-secondary" : "btn-primary"} btn-small" data-ir-semana="${prox.lunes}">${esc(guardada ? T("Ver semana especial") : T("Armar semana especial"))}</button>`;
    el.hidden = false;
  }

  $("avisoFeriado").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ir-semana]");
    if (!b) return;
    irAFeriados(b.dataset.irSemana);
  });

  function irAFeriados(lunes) {
    const tab = document.querySelector('.rt-tabs button[data-tab="feriados"]');
    if (lunes && (!S.esp || S.esp.semana !== lunes)) {
      if (S.esp && S.esp.sucio && !window.confirm(T("La semana especial tiene cambios sin guardar. ¿Cambiar de semana de todos modos?"))) return;
      abrirSemana(lunes);
    }
    tab.click();
  }

  function renderFeriados() {
    if (!S.plan) return;
    const semanas = semanasEspeciales();
    if (S.esp && !semanas.some((s) => s.lunes === S.esp.semana)) S.esp = null;
    // Una propuesta sin guardar ni tocar se rehace (por si cambió el plan A/B).
    if (S.esp && !S.esp.guardada && !S.esp.sucio) proponerEspecial(S.esp.semana, S.esp.base);
    if (!S.esp) {
      const primera = semanas.find((s) => s.cambia) || semanas[0];
      if (primera) abrirSemana(primera.lunes);
    }
    $("selSemanaEsp").innerHTML = semanas.length
      ? semanas.map((s) => `<option value="${s.lunes}">${esc(s.nombre)} · ${esc(T("semana del {a} al {b}", { a: fechaCorta(s.lunes), b: fechaCorta(sumarDias(s.lunes, 6)) }))}${S.planesEsp.has(s.lunes) ? " ✓" : ""}${s.cambia ? "" : esc(T(" (no cambia esta ruta)"))}</option>`).join("")
      : `<option value="">${esc(T("No hay feriados en el calendario"))}</option>`;
    $("selSemanaEsp").disabled = !semanas.length;
    if (S.esp) {
      $("selSemanaEsp").value = S.esp.semana;
      $("selBaseEsp").value = S.esp.base;
    }
    ["selBaseEsp", "btnGuardarEsp", "btnRearmarEsp", "btnImprimirEsp"].forEach((id) => ($(id).disabled = !S.esp));
    $("btnBorrarEsp").disabled = !(S.esp && S.esp.guardada);
    renderEstadoEsp();
    renderEspecial();
    renderCalendario();
  }

  function htmlParadaEsp(t, n, d, trab) {
    const ed = !S.soloLectura;
    const opciones = trab.filter((x) => x !== d && !S.esp.slots[`E${x}`].includes(t.id))
      .map((x) => `<option value="${x}">${esc(R.DIAS[x])} ${esc(fechaCorta(sumarDias(S.esp.semana, x - 1)))}</option>`).join("");
    return `<div class="rt-parada" draggable="${ed}" data-id="${esc(t.id)}" data-dia="${d || ""}">
      <span class="n">${n || "–"}</span>
      <div>
        <div class="s">${esc(t.nombre)}</div>
        <div class="a">${esc(t.direccion)}, ${esc(t.ciudad)}</div>
        ${chipFreq(t.freq)}${d && S.esp.movidas.has(`${t.id}@${d}`) ? `<span class="rt-chip movida">${esc(T("Cambió de día"))}</span>` : ""}${S.geo.has(t.id) ? "" : '<span class="rt-chip warn">Sin ubicación</span>'}
        ${ed ? `<select class="rt-mover" data-id="${esc(t.id)}" data-dia="${d || ""}" aria-label="${esc(T("Mover {t}", { t: t.nombre }))}"><option value="">${esc(T("Mover a…"))}</option>${opciones}${d ? `<option value="__fuera">${esc(T("Quitar esta semana"))}</option>` : ""}</select>` : ""}
      </div>
      ${ed && d ? `<div class="flechas"><button data-sube="${esc(t.id)}" aria-label="Subir">▲</button><button data-baja="${esc(t.id)}" aria-label="Bajar">▼</button></div>` : "<span></span>"}
    </div>`;
  }

  function renderEspecial() {
    const cont = $("diasEsp");
    const e = S.esp;
    if (!e) {
      cont.innerHTML = "";
      $("resumenEsp").textContent = S.feriadosError || T("Agrega los feriados en el calendario de abajo.");
      $("grupoWhEsp").hidden = true;
      return;
    }
    const trab = diasDeSemana(e.semana);
    const r = reglasSemana(e.semana);
    const w = S.plan.warehouse;
    const mi = R.millasDeSlots(e.slots, posiciones(), salidaEsp);
    const columnas = TODOS_DIAS.filter((d) => trab.includes(d) || S.dias.includes(d));
    cont.style.setProperty("--n", columnas.length + (e.fuera.length ? 1 : 0));
    let html = "";
    if (e.fuera.length) {
      html += `<section class="rt-dia sinasignar" data-dia=""><h3>${esc(T("No caben esta semana"))}<small>${e.fuera.length}</small></h3>
        <p class="rt-nota" style="font-size:11px; margin:0 0 4px;">${esc(T("Una visita menos esta semana. Arrástrala a un día si quieres que vaya."))}</p>
        ${e.fuera.map((id) => S.porId.get(id) ? htmlParadaEsp(S.porId.get(id), null, null, trab) : "").join("")}</section>`;
    }
    columnas.forEach((d) => {
      const fecha = fechaCorta(sumarDias(e.semana, d - 1));
      if (!trab.includes(d)) {
        html += `<section class="rt-dia off" data-off="1"><h3>${esc(R.DIAS[d])}<small>${esc(fecha)}</small></h3><p class="rt-off">${esc(T("Sin ruta"))}${r[d] && r[d].nombre ? ` · ${esc(r[d].nombre)}` : ""}</p></section>`;
        return;
      }
      const k = `E${d}`;
      const ids = e.slots[k] || [];
      const extra = !S.dias.includes(d);
      const tarjetaWh = w && e.whDias.includes(d)
        ? `<div class="rt-parada wh"><span class="n">W</span><div><div class="s">${esc(w.nombre)}</div><div class="a">${esc(T("Carga · salida del día"))}</div></div><span></span></div>`
        : "";
      html += `<section class="rt-dia${extra ? " extra" : ""}" style="--c:${COLORES[d]}" data-dia="${d}"><h3>${esc(R.DIAS[d])}<small>${esc(fecha)}${extra ? ` · <b>${esc(T("día extra"))}</b>` : ""} · ${esc(T("{n} paradas · ~{mi} mi", { n: ids.length, mi: Math.round(mi[k] || 0) }))}</small></h3>${tarjetaWh}${ids
        .map((id, i) => S.porId.get(id) ? htmlParadaEsp(S.porId.get(id), i + 1, d, trab) : "").join("")}</section>`;
    });
    cont.innerHTML = html;
    const off = S.dias.filter((d) => !trab.includes(d));
    const partes = [];
    if (off.length) partes.push(T("Sin ruta: {dias}.", { dias: off.map((d) => `${R.DIAS[d]} ${fechaCorta(sumarDias(e.semana, d - 1))}`).join(", ") }));
    const extras = trab.filter((d) => !S.dias.includes(d));
    if (extras.length) partes.push(T("Día extra con ruta: {dias}.", { dias: extras.map((d) => `${R.DIAS[d]} ${fechaCorta(sumarDias(e.semana, d - 1))}`).join(", ") }));
    partes.push(T("Sale del plan de la semana {b}.", { b: e.base }));
    if (e.movidas.size) partes.push(T("{n} visitas cambiaron de día.", { n: e.movidas.size }));
    if (e.fuera.length) partes.push(T("{n} visitas no caben esta semana.", { n: e.fuera.length }));
    if (!S.semanaA) partes.push(T("Ojo: define abajo qué lunes empieza la semana A para que la app elija A o B sola."));
    $("resumenEsp").textContent = partes.join(" ");
    $("grupoWhEsp").hidden = !w;
    if (w) {
      $("whDiasEsp").innerHTML = trab.map((d) => `<button type="button" data-whesp="${d}" aria-pressed="${e.whDias.includes(d)}" title="${esc(R.DIAS[d])}" ${S.soloLectura ? "disabled" : ""}>${CORTO[d]}</button>`).join("");
    }
  }

  // Mueve una visita de `desde` (día o null = "No caben") a `hasta` (día o null).
  function moverEsp(id, desde, hasta, antesDe) {
    const e = S.esp;
    const t = S.porId.get(id);
    if (hasta && e.slots[`E${hasta}`].includes(id)) {
      toast(T("{tienda} ya va el {dia}.", { tienda: t.nombre, dia: I.idioma === "en" ? R.DIAS[hasta] : R.DIAS[hasta].toLowerCase() }));
      return;
    }
    if (desde) {
      const a = e.slots[`E${desde}`];
      a.splice(a.indexOf(id), 1);
      e.movidas.delete(`${id}@${desde}`);
    } else {
      e.fuera.splice(e.fuera.indexOf(id), 1);
    }
    const tocados = [];
    if (desde) tocados.push(`E${desde}`);
    if (hasta) {
      const a = e.slots[`E${hasta}`];
      const i = antesDe ? a.indexOf(antesDe) : -1;
      a.splice(i < 0 ? a.length : i, 0, id);
      e.movidas.add(`${id}@${hasta}`);
      tocados.push(`E${hasta}`);
    } else {
      e.fuera.push(id);
    }
    e.slots = R.reordenarSlots(e.slots, tocados, posiciones(), salidaEsp);
    marcarSucioEsp();
    renderEspecial();
  }

  $("diasEsp").addEventListener("change", (ev) => {
    const sel = ev.target.closest(".rt-mover");
    if (!sel || !sel.value || !S.esp) return;
    const desde = Number(sel.dataset.dia) || null;
    moverEsp(sel.dataset.id, desde, sel.value === "__fuera" ? null : Number(sel.value));
  });

  $("diasEsp").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-sube], button[data-baja]");
    if (!b || !S.esp) return;
    const id = b.dataset.sube || b.dataset.baja;
    const arr = S.esp.slots[`E${b.closest(".rt-parada").dataset.dia}`];
    const i = arr.indexOf(id);
    const j = b.dataset.sube ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    marcarSucioEsp();
    renderEspecial();
  });

  let arrastreEsp = null;
  $("diasEsp").addEventListener("dragstart", (ev) => {
    const el = ev.target.closest(".rt-parada[data-id]");
    if (!el || S.soloLectura) return;
    arrastreEsp = { id: el.dataset.id, dia: Number(el.dataset.dia) || null };
    el.classList.add("arrastrando");
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", el.dataset.id);
  });
  $("diasEsp").addEventListener("dragend", (ev) => {
    const el = ev.target.closest(".rt-parada");
    if (el) el.classList.remove("arrastrando");
    document.querySelectorAll("#diasEsp .rt-dia.sobre").forEach((x) => x.classList.remove("sobre"));
  });
  $("diasEsp").addEventListener("dragover", (ev) => {
    const col = ev.target.closest(".rt-dia");
    if (!col || !arrastreEsp || col.dataset.off) return;
    ev.preventDefault();
    document.querySelectorAll("#diasEsp .rt-dia.sobre").forEach((x) => x !== col && x.classList.remove("sobre"));
    col.classList.add("sobre");
  });
  $("diasEsp").addEventListener("drop", (ev) => {
    const col = ev.target.closest(".rt-dia");
    if (!col || !arrastreEsp || col.dataset.off) return;
    ev.preventDefault();
    col.classList.remove("sobre");
    const { id, dia } = arrastreEsp;
    arrastreEsp = null;
    const hasta = Number(col.dataset.dia) || null;
    const objetivo = ev.target.closest(".rt-parada[data-id]");
    if (hasta && hasta === dia) {
      // Reordenar dentro del mismo día.
      const arr = S.esp.slots[`E${hasta}`];
      arr.splice(arr.indexOf(id), 1);
      const i = objetivo && objetivo.dataset.id !== id ? arr.indexOf(objetivo.dataset.id) : arr.length;
      arr.splice(i < 0 ? arr.length : i, 0, id);
      marcarSucioEsp();
      return renderEspecial();
    }
    if (!hasta && !dia) return;
    moverEsp(id, dia, hasta, objetivo ? objetivo.dataset.id : null);
  });

  $("whDiasEsp").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-whesp]");
    if (!b || !S.esp || S.soloLectura) return;
    const d = Number(b.dataset.whesp);
    const e = S.esp;
    e.whDias = e.whDias.includes(d) ? e.whDias.filter((x) => x !== d) : limpiarDias(e.whDias.concat(d));
    e.slots = R.reordenarSlots(e.slots, Object.keys(e.slots), posiciones(), salidaEsp);
    marcarSucioEsp();
    renderEspecial();
  });

  $("selSemanaEsp").onchange = () => {
    const l = $("selSemanaEsp").value;
    if (!l || (S.esp && S.esp.semana === l)) return;
    if (S.esp && S.esp.sucio && !window.confirm(T("La semana especial tiene cambios sin guardar. ¿Cambiar de semana de todos modos?"))) {
      $("selSemanaEsp").value = S.esp.semana;
      return;
    }
    abrirSemana(l);
    renderFeriados();
  };

  $("selBaseEsp").onchange = () => {
    if (!S.esp) return;
    const base = $("selBaseEsp").value;
    if ((S.esp.sucio || S.esp.guardada) && !window.confirm(T("Se vuelve a armar la semana desde el plan de la semana {b}. Los cambios a mano de esta semana se pierden. ¿Seguir?", { b: base }))) {
      $("selBaseEsp").value = S.esp.base;
      return;
    }
    const guardada = S.esp.guardada, cuando = S.esp.cuando, por = S.esp.por;
    proponerEspecial(S.esp.semana, base);
    Object.assign(S.esp, { guardada, cuando, por, sucio: guardada });
    renderFeriados();
  };

  $("btnRearmarEsp").onclick = () => {
    if (!S.esp) return;
    if ((S.esp.sucio || S.esp.guardada) && !window.confirm(T("Se vuelve a armar la semana desde el plan normal. Los cambios a mano de esta semana se pierden. ¿Seguir?"))) return;
    const guardada = S.esp.guardada, cuando = S.esp.cuando, por = S.esp.por;
    proponerEspecial(S.esp.semana, S.esp.base);
    Object.assign(S.esp, { guardada, cuando, por, sucio: guardada });
    renderFeriados();
    toast(T("Semana armada desde el plan normal."));
  };

  $("btnGuardarEsp").onclick = async () => {
    if (!S.esp) return;
    try {
      const cuando = await D.guardarPlanEspecial(S.ruta, S.esp.semana, { base: S.esp.base, slots: S.esp.slots, whDias: S.esp.whDias }, S.perfil.nombre || S.perfil.email);
      S.planesEsp.set(S.esp.semana, { semana: S.esp.semana, base: S.esp.base, slots: JSON.parse(JSON.stringify(S.esp.slots)), wh_dias: S.esp.whDias.slice(), actualizado_en: cuando, actualizado_por: S.perfil.nombre || S.perfil.email });
      Object.assign(S.esp, { guardada: true, sucio: false, cuando, por: S.perfil.nombre || S.perfil.email });
      renderFeriados();
      renderAvisoFeriado();
      toast(T("Semana especial guardada. El plan A/B no cambió."));
    } catch (e) {
      console.error(e);
      toast(errorTablasFeriados(e) ? T("Falta crear las tablas de feriados: corre scripts/calendario_especial.sql en Supabase.") : T("No se guardó: {e}", { e: e.message }));
    }
  };

  $("btnBorrarEsp").onclick = async () => {
    if (!S.esp || !S.esp.guardada) return;
    if (!window.confirm(T("¿Borrar la semana especial guardada? Se vuelve a la propuesta automática."))) return;
    try {
      await D.borrarPlanEspecial(S.ruta, S.esp.semana);
      S.planesEsp.delete(S.esp.semana);
      proponerEspecial(S.esp.semana, baseDeSemana(S.esp.semana) || S.esp.base);
      renderFeriados();
      renderAvisoFeriado();
      toast(T("Semana especial borrada."));
    } catch (e) {
      console.error(e);
      toast(T("No se pudo borrar: {e}", { e: e.message }));
    }
  };

  // Calendario de feriados (tabla + agregar / borrar)
  function renderCalendario() {
    const desde = lunesDe(hoyIso());
    const lista = S.feriados.filter((x) => x.fecha >= desde);
    if (S.semanaA) {
      $("ferSemanaA").value = S.semanaA;
      $("ferSemanaAInfo").textContent = T("Esta semana (del {f}) es semana {b}.", { f: fechaCorta(desde), b: baseDeSemana(desde) });
    } else {
      $("ferSemanaA").value = "";
      $("ferSemanaAInfo").textContent = T("Sin definir: en cada semana especial eliges si sale de la semana A o B.");
    }
    if (S.feriadosError) {
      $("tablaFeriados").innerHTML = `<tbody><tr><td class="rt-no">${esc(S.feriadosError)}</td></tr></tbody>`;
      return;
    }
    if (!lista.length) {
      $("tablaFeriados").innerHTML = `<tbody><tr><td class="rt-nota">${esc(T("No hay feriados en el calendario"))}</td></tr></tbody>`;
      return;
    }
    let filas = "";
    let semana = null;
    lista.forEach((x) => {
      const l = lunesDe(x.fecha);
      if (l !== semana) {
        semana = l;
        const r = reglasSemana(l);
        const chips = TODOS_DIAS.map((d) => {
          const trab = r[d] ? r[d].trabaja : S.dias.includes(d);
          const cls = r[d] && !r[d].trabaja ? "off" : trab ? "" : "nada";
          return `<span class="${cls}" title="${esc(R.DIAS[d])} ${esc(fechaCorta(sumarDias(l, d - 1)))}">${CORTO[d]} ${desdeIso(sumarDias(l, d - 1)).getUTCDate()}</span>`;
        }).join("");
        filas += `<tr><td colspan="5" style="background:var(--gray-light);"><b>${esc(T("Semana del {a} al {b}", { a: fechaCorta(l), b: fechaCorta(sumarDias(l, 6)) }))}</b>${S.semanaA ? ` · ${esc(T("semana {b}", { b: baseDeSemana(l) }))}` : ""} <div class="rt-fer-dias" style="margin-left:8px; vertical-align:middle;">${chips}</div></td></tr>`;
      }
      const otraRuta = x.ibp_id && x.ibp_id !== S.ruta;
      filas += `<tr${otraRuta ? ' style="opacity:.55"' : ""}>
        <td>${esc(R.DIAS[desdeIso(x.fecha).getUTCDay() || 7])} ${esc(fechaCorta(x.fecha))}</td>
        <td>${esc(x.nombre || "")}</td>
        <td>${x.trabaja ? `<span class="rt-ok">${esc(T("Con ruta"))}</span>` : `<span class="rt-no">${esc(T("Sin ruta"))}</span>`}</td>
        <td>${x.ibp_id ? esc(T("Solo ruta {r}", { r: x.ibp_id })) : esc(T("Todas las rutas"))}</td>
        <td>${S.soloLectura ? "" : `<button type="button" class="btn btn-secondary btn-small" data-borrar-fer="${x.id}">${esc(T("Borrar"))}</button>`}</td>
      </tr>`;
    });
    $("tablaFeriados").innerHTML = `<thead><tr><th>${esc(T("Fecha"))}</th><th>${esc(T("Nombre"))}</th><th>${esc(T("Ese día"))}</th><th>${esc(T("Aplica a"))}</th><th></th></tr></thead><tbody>${filas}</tbody>`;
  }

  // Después de cambiar el calendario: si la semana abierta no estaba guardada
  // ni tocada, se vuelve a armar con los días nuevos.
  function refrescarTrasCalendario() {
    if (S.esp && !S.esp.guardada && !S.esp.sucio) S.esp = null;
    else if (S.esp && S.esp.guardada && !S.esp.sucio) abrirSemana(S.esp.semana);
    renderFeriados();
    renderAvisoFeriado();
  }

  $("formFeriado").onsubmit = async (ev) => {
    ev.preventDefault();
    const fecha = $("ferFecha").value;
    if (!fecha) return;
    const dia = { fecha, nombre: $("ferNombre").value.trim(), trabaja: $("ferTrabaja").value === "true", ibp_id: $("ferAlcance").value === "ruta" ? S.ruta : null };
    try {
      const fila = await D.guardarDiaEspecial(dia);
      S.feriados = S.feriados.concat(fila).sort((a, b) => a.fecha.localeCompare(b.fecha));
      $("ferFecha").value = "";
      refrescarTrasCalendario();
      toast(T("{f} agregado al calendario.", { f: `${R.DIAS[desdeIso(fecha).getUTCDay() || 7]} ${fechaCorta(fecha)}` }));
    } catch (e) {
      console.error(e);
      toast(/duplicate|unique/i.test(e.message) ? T("Ese día ya está en el calendario (bórralo primero para cambiarlo).")
        : errorTablasFeriados(e) ? T("Falta crear las tablas de feriados: corre scripts/calendario_especial.sql en Supabase.") : T("No se guardó: {e}", { e: e.message }));
    }
  };

  $("tablaFeriados").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-borrar-fer]");
    if (!b) return;
    const x = S.feriados.find((f) => String(f.id) === b.dataset.borrarFer);
    if (!x || !window.confirm(T("¿Quitar {f} del calendario?", { f: `${fechaCorta(x.fecha)}${x.nombre ? ` (${x.nombre})` : ""}` }))) return;
    try {
      await D.borrarDiaEspecial(x.id);
      S.feriados = S.feriados.filter((f) => f.id !== x.id);
      refrescarTrasCalendario();
    } catch (e) {
      console.error(e);
      toast(T("No se pudo borrar: {e}", { e: e.message }));
    }
  });

  $("ferSemanaA").onchange = async () => {
    const v = $("ferSemanaA").value;
    if (!v) return;
    S.semanaA = lunesDe(v);
    try { await D.guardarConfigRutas("semanaA", { lunes: S.semanaA }); } catch (e) { console.error(e); toast(T("No se guardó: {e}", { e: e.message })); }
    if (S.esp && !S.esp.guardada && !S.esp.sucio) proponerEspecial(S.esp.semana, baseDeSemana(S.esp.semana));
    renderFeriados();
  };

  // Hoja de la semana especial para el IBP: días con fecha; los días sin ruta
  // salen marcados.
  function htmlHojaEsp() {
    const e = S.esp;
    const info = S.rutas.find((r) => r.ruta === S.ruta) || {};
    const w = S.plan.warehouse;
    const trab = diasDeSemana(e.semana);
    const r = reglasSemana(e.semana);
    const mi = R.millasDeSlots(e.slots, posiciones(), salidaEsp);
    const dir = (t) => [t.direccion, t.ciudad, `${t.estado_us || ""} ${t.zip || ""}`.trim()].filter(Boolean).join(", ");
    let html = `<h1>${esc(T("Ruta {ruta}", { ruta: S.ruta }))}${info.propietario ? ` · ${esc(info.propietario)}` : ""}</h1>
      <p class="sub"><b>${esc(nombreSemana(e.semana))}</b> · ${esc(T("Semana del {a} al {b}", { a: fechaCorta(e.semana), b: fechaCorta(sumarDias(e.semana, 6)) }))}</p>
      <p class="sub">${esc(T("Plan especial solo para esta semana. La semana siguiente vuelve el plan de siempre."))}</p>`;
    if (w) html += `<p class="sub">${esc(T("Warehouse: {w}", { w: w.nombre }))}${dir(w) ? ` — ${esc(dir(w))}` : ""} · ${esc(T("Carga: {dias}", { dias: e.whDias.length ? nombreDias(e.whDias) : "—" }))}</p>`;
    html += `<p class="sub">${esc(T("Impreso {fecha}", { fecha: new Date().toLocaleDateString(I.locale) }))}</p><section class="semana">`;
    TODOS_DIAS.filter((d) => trab.includes(d) || S.dias.includes(d)).forEach((d) => {
      const titulo = `${R.DIAS[d]} ${fechaCorta(sumarDias(e.semana, d - 1))}`;
      if (!trab.includes(d)) {
        html += `<div class="dia"><h3><span>${esc(titulo)}</span></h3><p class="vacio"><b>${esc(T("Sin ruta"))}</b>${r[d] && r[d].nombre ? ` — ${esc(r[d].nombre)}` : ""}</p></div>`;
        return;
      }
      const k = `E${d}`;
      const ids = (e.slots[k] || []).filter((id) => S.porId.has(id));
      const conWh = w && e.whDias.includes(d);
      html += `<div class="dia"><h3><span>${esc(titulo)}</span><small>${esc(T("{n} paradas · ~{mi} mi", { n: ids.length, mi: Math.round(mi[k] || 0) }))}</small></h3>`;
      if (!ids.length && !conWh) { html += `<p class="vacio">${esc(T("Sin visitas"))}</p></div>`; return; }
      html += `<table><thead><tr><th>#</th><th>${esc(T("Tienda"))}</th><th>${esc(T("Código"))}</th><th>${esc(T("Dirección"))}</th><th>${esc(T("Frecuencia"))}</th><th>${esc(T("Hecho"))}</th></tr></thead><tbody>`;
      if (conWh) html += `<tr class="wh"><td class="n">W</td><td>${esc(w.nombre)}</td><td></td><td>${esc(dir(w))}</td><td>${esc(T("Carga"))}</td><td class="ok"></td></tr>`;
      ids.forEach((id, i) => {
        const t = S.porId.get(id);
        html += `<tr><td class="n">${i + 1}</td><td>${esc(t.nombre)}${e.movidas.has(`${id}@${d}`) ? ` <b>*</b>` : ""}</td><td>${esc(t.id)}</td><td>${esc(dir(t))}</td><td>${esc(R.ETIQUETA_FREQ[t.freq])}</td><td class="ok"></td></tr>`;
      });
      html += `</tbody></table></div>`;
    });
    html += `</section>`;
    if (e.movidas.size) html += `<p class="sub">* ${esc(T("Cambió de día esta semana."))}</p>`;
    return html;
  }

  $("btnImprimirEsp").onclick = () => {
    if (!S.esp) return;
    if (S.esp.sucio || !S.esp.guardada) toast(T("Ojo: la semana especial no está guardada; se imprime lo que ves en pantalla."));
    $("hoja").innerHTML = htmlHojaEsp();
    const titulo = document.title;
    document.title = `${T("Ruta {ruta}", { ruta: S.ruta })} · ${nombreSemana(S.esp.semana)}`;
    setTimeout(() => {
      window.print();
      document.title = titulo;
    }, 50);
  };

  iniciar().catch((e) => {
    console.error(e);
    mostrarLogin(T("No se pudo conectar: {e}", { e: e.message }));
  });
})();
