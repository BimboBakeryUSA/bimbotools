// ============================================================================
// rutas.html — Planificador de rutas semana A/B.
// Datos: Supabase vía js/depuracion.js (tiendas, ventas, rutas_geo,
// rutas_plan, rutas_config). Cálculo: js/ruteo.js (sin IA, todo local).
// ============================================================================

(function () {
  const D = window.BimboDepuracion;
  const R = window.BimboRuteo;
  const $ = (id) => document.getElementById(id);
  const LS_RUTA = "rutasUltimaRuta";
  const COLORES = ["", "#c0392b", "#1f6fb2", "#2e8a4e", "#c77a00", "#7a4bb0", "#00838f", "#6d4c41"];
  const TODOS_DIAS = [1, 2, 3, 4, 5, 6, 7];
  const DIAS_DEFECTO = [1, 2, 3, 4, 5];
  const CORTO = ["", "L", "M", "Mi", "J", "V", "S", "D"];

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

  async function iniciar() {
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
    if (!S.perfil) return mostrarLogin("Tu cuenta no tiene perfil en Bimbo Tools.");
    // Solo admin y corporativo (managers: DOS, ZSL, MSL). Nadie más.
    if (!["admin", "corporativo", "dos", "zsl", "msl"].includes(String(S.perfil.role || "").toLowerCase())) {
      await D.cerrarSesion().catch(() => {});
      return mostrarLogin("Esta página es solo para managers de Bimbo Tools.");
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
    if (S.sucio && !window.confirm("Hay cambios sin guardar en esta ruta. ¿Cargar otra de todos modos?")) return;
    await cargarRuta($("selRuta").value);
  };

  window.addEventListener("beforeunload", (e) => {
    if (S.sucio) { e.preventDefault(); e.returnValue = ""; }
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
        ? `Plan guardado ${new Date(plan.actualizado_en).toLocaleString("es-US")}${plan.actualizado_por ? " por " + plan.actualizado_por : ""}`
        : "Esta ruta todavía no tiene plan guardado.";
      $("vistaRuta").hidden = false;
      renderBarraPlan();
      renderTodo();
      const faltan = S.tiendas.filter((t) => !S.geo.has(t.id));
      if (faltan.length && !S.soloLectura && !ubicando) {
        await ubicarRutaActual(faltan, !plan);
      } else if (!plan && !S.soloLectura && S.tiendas.some((t) => S.geo.has(t.id))) {
        calcular();
      }
    } catch (e) {
      console.error(e);
      $("estadoGuardado").textContent = `No se pudo cargar la ruta: ${e.message}`;
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
    const msgSin = res.sinUbicar.length ? ` ${res.sinUbicar.length} tiendas sin ubicación quedaron sin asignar.` : "";
    const msgDias = res.sinDias.length ? ` ${res.sinDias.length} tiendas no caben en los días de carga (${nombreDias(S.dias)}) con su frecuencia.` : "";
    toast(`Plan calculado.${msgSin}${msgDias}`);
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
      $("estadoGuardado").textContent = `Guardado ${new Date(cuando).toLocaleString("es-US")}`;
      const n = sinAsignar().length;
      toast(n ? `Guardado. Ojo: ${n} tiendas siguen sin asignar.` : "Plan guardado.");
    } catch (e) {
      console.error(e);
      toast(errorTablasFaltantes(e) ? "No se guardó: faltan las tablas del planificador en Supabase." : `No se guardó: ${e.message}`);
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
    if (sinDias.length) toast(`${sinDias.length} tiendas no caben en ${nombreDias(S.dias)} con su frecuencia (ej. 3x semana necesita 3 días de trabajo).`);
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
    toast(`${w.nombre} agregado. Arrástralo a los días que el IBP va a cargar (o usa sus botones de días). Luego Guardar.`);
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
      ["plan", "tiendas", "ubicaciones", "reglas"].forEach((t) => ($("tab" + t[0].toUpperCase() + t.slice(1)).hidden = t !== b.dataset.tab));
      if (b.dataset.tab === "plan" && S.mapa) setTimeout(() => S.mapa.invalidateSize(), 50);
      if (b.dataset.tab === "reglas") renderReglas();
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
        ${chipFreq(t.freq)}<span class="rt-chip">$${Math.round(t.ventaSem)}/sem</span>${S.plan.fijadas.has(t.id) ? '<span class="rt-chip fija">Fijada</span>' : ""}${S.geo.has(t.id) ? "" : '<span class="rt-chip warn">Sin ubicación</span>'}
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
        ? `<div class="rt-parada wh" draggable="${ed}" data-wh="1" data-slot="${k}"><span class="n">W</span><div><div class="s">${esc(w.nombre)}</div><div class="a">Carga · salida del día</div></div>${ed ? `<div class="flechas"><button data-wh-quitar-dia="${d}" aria-label="Quitar el warehouse de ${R.DIAS[d]}" title="Quitar de este día">✕</button></div>` : "<span></span>"}</div>`
        : "";
      html += `<section class="rt-dia" style="--c:${COLORES[d]}" data-slot="${k}"><h3>${R.DIAS[d]}<small>${ids.length} paradas · ~${Math.round(mi[k] || 0)} mi</small></h3>${tarjetaWh}${ids
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
    } else if (window.confirm(`¿Quitar ${S.plan.warehouse.nombre} de esta ruta?`)) {
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
      toast(`Con los días de trabajo ${nombreDias(S.dias)} no cabe una tienda ${etiqueta}.`);
      return null;
    }
    const dDest = Number(destino[1]);
    if (R.veces(t.freq) && origen) {
      const actual = R.patronActual(t.id, t.freq, S.dias, S.plan.slots);
      if (actual) {
        const dias = actual.clave.split("+").map(Number);
        const dOrig = Number(origen[1]);
        if (dias.includes(dDest)) {
          toast(`${t.nombre} ya va el ${R.DIAS[dDest].toLowerCase()}.`);
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
          .bindPopup(`<b>${esc(t.nombre)}</b><br>${esc(t.direccion)}, ${esc(t.ciudad)}<br>${R.DIAS[d]} · parada ${i + 1}<br>${R.ETIQUETA_FREQ[t.freq]} · $${Math.round(t.ventaSem)}/sem`)
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
        .bindPopup(`<b>${esc(w.nombre)}</b><br>Warehouse · carga ${S.plan.whDias.length ? esc(nombreDias(S.plan.whDias)) : "— sin días asignados"}`)
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
          .map((f) => `<option value="${f}" ${t.freq === f ? "selected" : ""}>${R.ETIQUETA_FREQ[f]}${f === t.freqRegla ? " (regla)" : ""}</option>`)
          .join("");
        const ibp = [t.estatus || "sin revisar", t.frecuencia || "", (t.dias_visita || []).join("/")].filter(Boolean).join(" · ");
        return `<tr>
          <td><b>${esc(t.nombre)}</b><br><span class="rt-nota">${esc(t.id)} · ${esc(t.direccion)}, ${esc(t.ciudad)}</span></td>
          <td>${esc(t.tipo_cuenta)}</td>
          <td class="num">$${Math.round(t.ventaSem)}</td>
          <td>${esc(t.regla)}</td>
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
    toast(`${t.nombre}: ${R.ETIQUETA_FREQ[t.freq]}.`);
  });

  // --------------------------------------------------------------------------
  // Ubicaciones
  // --------------------------------------------------------------------------

  function renderUbicaciones() {
    const total = S.tiendas.length;
    const con = S.tiendas.filter((t) => S.geo.has(t.id)).length;
    const porFuente = {};
    S.geo.forEach((g) => (porFuente[g.fuente] = (porFuente[g.fuente] || 0) + 1));
    $("ubiResumen").textContent = `${con} de ${total} tiendas de esta ruta tienen ubicación` +
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
      toast(`No se guardó la ubicación: ${err.message}`);
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
      $("ubiMensaje").textContent = `Archivo con ${faltan.length} tiendas sin ubicación (el Census acepta hasta 10,000 por archivo).`;
    } catch (e) {
      $("ubiMensaje").textContent = `No se pudo preparar el archivo: ${e.message}`;
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
        `Guardadas ${aGuardar.length} ubicaciones del Census.` +
        (sinMatch ? ` ${sinMatch} direcciones no tuvieron coincidencia (búscalas en OpenStreetMap o ponlas a mano).` : "") +
        (manuales ? ` ${manuales} no se tocaron porque ya tenían ubicación manual.` : "") +
        (encontrados.length - validos.length ? ` ${encontrados.length - validos.length} códigos no existen en Bimbo Tools.` : "");
    } catch (err) {
      console.error(err);
      $("ubiMensaje").textContent = `No se pudo importar: ${err.message}`;
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
      est.textContent = `Ubicando tiendas (${fase}): ${h} de ${n}…`;
    });
    if (res.cancelado || S.ruta !== ruta) return;
    S.ajustarMapa = true;
    const msg = res.noEncontradas.length
      ? `${res.encontradas} tiendas ubicadas. ${res.noEncontradas.length} sin ubicación: ponlas a mano en la pestaña Ubicaciones.`
      : `${res.encontradas} tiendas ubicadas.`;
    est.textContent = msg;
    if (calcularAlTerminar && S.tiendas.some((t) => S.geo.has(t.id))) {
      calcular();
      toast(`${msg} Plan calculado: revísalo y presiona Guardar.`);
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
        $("ubiMensaje").textContent = `${fase}: ${h} de ${n} · ${enc} ubicadas. Deja la página abierta.`;
      });
      S.ajustarMapa = true;
      renderTodo();
      $("ubiMensaje").textContent = res.cancelado
        ? "Búsqueda interrumpida. Lo ya encontrado quedó guardado; presiona de nuevo para seguir."
        : `Listo: ${res.encontradas} de ${faltan.length} tiendas ubicadas.` +
          (res.noEncontradas.length ? ` Sin ubicación (${res.noEncontradas.length}): ${res.noEncontradas.slice(0, 30).map((t) => t.nombre).join(", ")}${res.noEncontradas.length > 30 ? "…" : ""}. Ponlas a mano.` : "");
    } catch (e) {
      console.error(e);
      $("ubiMensaje").textContent = `No se pudo completar: ${e.message}`;
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
    $("btnOsm").textContent = "Detener búsqueda";
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
      $("ubiMensaje").textContent = `Buscando ${hechas} de ${faltan.length}… (${encontradas} encontradas)`;
      await esperar(1100);
    }
    osmCorriendo = false;
    $("btnOsm").textContent = "Buscar en OpenStreetMap las que faltan";
    $("progreso").hidden = true;
    S.ajustarMapa = true;
    renderTodo();
    $("ubiMensaje").textContent = `OpenStreetMap encontró ${encontradas} de ${hechas}.` +
      (noEncontradas.length ? ` Sin resultado: ${noEncontradas.join(", ")}. Ponlas a mano desde Google Maps.` : "");
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
      try { new RegExp(c.patron, "i"); } catch (e) { throw new Error(`El patrón de ${c.nombre} no es válido.`); }
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
      return toast(errorTablasFaltantes(e) ? "No se guardaron: faltan las tablas del planificador en Supabase." : `No se guardaron: ${e.message}`);
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
    toast(cambiaron ? `Reglas guardadas. ${cambiaron} tiendas cambiaron de frecuencia: revisa el plan o recalcúlalo.` : "Reglas guardadas.");
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

  iniciar().catch((e) => {
    console.error(e);
    mostrarLogin(`No se pudo conectar: ${e.message}`);
  });
})();
