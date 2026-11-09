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
  const COLORES = ["", "#c0392b", "#1f6fb2", "#2e8a4e", "#c77a00", "#7a4bb0", "#00838f"];

  const S = {
    perfil: null,
    soloLectura: true,
    rutas: [],
    reglas: JSON.parse(JSON.stringify(R.REGLAS_DEFECTO)),
    ruta: null,
    tiendas: [],
    porId: new Map(),
    geo: new Map(),
    plan: null, // { inicio, frecuencias, slots, fijadas:Set }
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
    } catch (e) {
      if (errorTablasFaltantes(e)) {
        $("estadoGuardado").textContent = "Falta crear las tablas del planificador: corre scripts/rutas_schema.sql en Supabase.";
        $("estadoGuardado").classList.add("sucio");
      } else console.error(e);
    }

    if (S.soloLectura) {
      S.rutas = [{ ruta: S.perfil.route_code, propietario: "", msl: "", total: 0 }];
      ["btnCalcular", "btnReordenar", "btnSoltar", "btnGuardar", "btnGuardarReglas", "btnAgregarRegla",
        "btnCensusTodas", "btnOsm"].forEach((id) => ($(id).hidden = true));
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
      S.plan = {
        inicio: p.inicio && isFinite(p.inicio.lat) ? p.inicio : null,
        frecuencias: p.frecuencias || {},
        slots: {},
        fijadas: new Set((p.fijadas || []).filter((x) => S.porId.has(x))),
      };
      S.tiendas.forEach((t) => (t.freq = S.plan.frecuencias[t.id] || t.freqRegla));
      const slotsGuardados = p.slots || {};
      const conSabado = ["A6", "B6"].some((k) => (slotsGuardados[k] || []).length);
      S.dias = conSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
      $("chkSabado").checked = conSabado;
      asegurarSlots();
      Object.keys(slotsGuardados).forEach((k) => {
        if (S.plan.slots[k]) S.plan.slots[k] = slotsGuardados[k].filter((x) => S.porId.has(x));
      });
      $("txtInicio").value = S.plan.inicio ? `${S.plan.inicio.lat}, ${S.plan.inicio.lng}` : "";
      S.ajustarMapa = true;
      marcarSucio(false);
      $("estadoGuardado").textContent = plan
        ? `Plan guardado ${new Date(plan.actualizado_en).toLocaleString("es-US")}${plan.actualizado_por ? " por " + plan.actualizado_por : ""}`
        : "Esta ruta todavía no tiene plan guardado.";
      $("vistaRuta").hidden = false;
      renderTodo();
      if (!plan && !S.soloLectura && S.tiendas.some((t) => S.geo.has(t.id))) {
        toast("Ruta sin plan: presiona “Calcular plan”.");
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
    S.plan.slots = R.reordenarSlots(S.plan.slots, [...new Set(tocados)], posiciones(), S.plan.inicio);
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
        if (S.plan.inicio) otros.push(S.plan.inicio);
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
      { dias: S.dias, inicio: S.plan.inicio, fijadas, maxPorDia: max }
    );
    S.plan.slots = res.slots;
    asegurarSlots();
    marcarSucio();
    renderTodo();
    const msgSin = res.sinUbicar.length ? ` ${res.sinUbicar.length} tiendas sin ubicación quedaron sin asignar.` : "";
    toast(`Plan calculado.${msgSin}`);
  }

  $("btnCalcular").onclick = calcular;
  $("btnReordenar").onclick = () => {
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), S.plan.inicio);
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
        { inicio: S.plan.inicio, frecuencias: S.plan.frecuencias, slots: S.plan.slots, fijadas: [...S.plan.fijadas] },
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

  $("chkSabado").onchange = () => {
    S.dias = $("chkSabado").checked ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const afectadas = new Set([...(S.plan.slots.A6 || []), ...(S.plan.slots.B6 || [])]);
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
    renderTodo();
  };

  $("txtInicio").onchange = () => {
    const txt = $("txtInicio").value.trim();
    const p = txt ? parsearLatLng(txt) : null;
    if (txt && !p) return toast("Escribe el punto de salida como “lat, lng”, por ejemplo 38.8462, -77.3064.");
    S.plan.inicio = p;
    S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots), posiciones(), S.plan.inicio);
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
    const mi = R.millasDeSlots(S.plan.slots, posiciones(), S.plan.inicio);
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
    const c = f === "2x" ? "x2" : f === "q" ? "q" : "";
    return `<span class="rt-chip ${c}">${R.ETIQUETA_FREQ[f]}</span>`;
  }

  function htmlParada(t, n, slot) {
    const opciones = R.patrones(t.freq, S.dias)
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
    const mi = R.millasDeSlots(S.plan.slots, posiciones(), S.plan.inicio);
    const cont = $("dias");
    const sin = sinAsignar();
    cont.style.setProperty("--n", S.dias.length + (sin.length ? 1 : 0));
    let html = "";
    if (sin.length) {
      html += `<section class="rt-dia sinasignar" data-slot=""><h3>Sin asignar<small>${sin.length}</small></h3>${sin.map((t) => htmlParada(t, null, null)).join("")}</section>`;
    }
    S.dias.forEach((d) => {
      const k = `${S.semana}${d}`;
      const ids = S.plan.slots[k] || [];
      html += `<section class="rt-dia" style="--c:${COLORES[d]}" data-slot="${k}"><h3>${R.DIAS[d]}<small>${ids.length} paradas · ~${Math.round(mi[k] || 0)} mi</small></h3>${ids
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
      const p = R.patrones(t.freq, S.dias).find((x) => x.clave === sel.value);
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

  // Arrastrar y soltar entre días
  let arrastrando = null;
  $("dias").addEventListener("dragstart", (e) => {
    const el = e.target.closest(".rt-parada");
    if (!el || S.soloLectura) return;
    arrastrando = { id: el.dataset.id, slot: el.dataset.slot };
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
    const { id, slot: origen } = arrastrando;
    arrastrando = null;
    const destino = col.dataset.slot;
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
    const p = R.patronConSlot(t.freq, S.dias, destino);
    if (!p) {
      const dias2x = R.patrones("2x", S.dias).map((x) => x.etiqueta.toLowerCase()).join(" o ");
      return toast(`Una tienda 2x semana solo puede ir ${dias2x}.`);
    }
    aplicarPatron(id, p, true);
    renderTodo();
  });

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
      if (S.plan.inicio && puntos.length) puntos.unshift([S.plan.inicio.lat, S.plan.inicio.lng]);
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
    if (S.plan.inicio) {
      L.marker([S.plan.inicio.lat, S.plan.inicio.lng], { icon: L.divIcon({ className: "", html: '<div class="rt-inicio-icono"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), title: "Salida" })
        .bindPopup("Punto de salida")
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
        const opciones = ["2x", "1x", "q", "fuera"]
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
    S.plan.slots = R.reordenarSlots(S.plan.slots, tocados, posiciones(), S.plan.inicio);
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
      S.plan.slots = R.reordenarSlots(S.plan.slots, Object.keys(S.plan.slots).filter((k) => S.plan.slots[k].includes(id)), posiciones(), S.plan.inicio);
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
    const opciones = (f) => ["2x", "1x", "q"].map((x) => `<option value="${x}" ${x === f ? "selected" : ""}>${R.ETIQUETA_FREQ[x]}</option>`).join("");
    const dis = S.soloLectura ? "disabled" : "";
    $("reglasCadenas").innerHTML = S.reglas.cadenas
      .map((c, i) => `<div class="rt-regla-fila" data-i="${i}">
        <input data-campo="nombre" value="${esc(c.nombre)}" aria-label="Cadena" ${dis} />
        <input data-campo="patron" value="${esc(c.patron)}" aria-label="Patrón" ${dis} />
        <select data-campo="freq" aria-label="Frecuencia" ${dis}>${opciones(c.freq)}</select>
        <input data-campo="dosVecesSobre" type="number" min="0" value="${c.dosVecesSobre == null ? "" : c.dosVecesSobre}" placeholder="—" aria-label="2x si venta mayor a" ${dis} />
        ${S.soloLectura ? "<span></span>" : `<button class="btn btn-secondary btn-small" data-quitar="${i}">Quitar</button>`}
      </div>`)
      .join("");
    $("numAlta").value = S.reglas.ventaAlta == null ? "" : S.reglas.ventaAlta;
    $("numBaja").value = S.reglas.ventaBaja == null ? "" : S.reglas.ventaBaja;
    $("numAlta").disabled = $("numBaja").disabled = S.soloLectura;
  }

  function leerReglas() {
    const cadenas = [...document.querySelectorAll(".rt-regla-fila[data-i]")].map((fila) => {
      const v = (c) => fila.querySelector(`[data-campo="${c}"]`).value.trim();
      const dos = v("dosVecesSobre");
      return { nombre: v("nombre"), patron: v("patron"), freq: v("freq"), dosVecesSobre: dos === "" ? null : Number(dos) };
    }).filter((c) => c.nombre && c.patron);
    for (const c of cadenas) {
      try { new RegExp(c.patron, "i"); } catch (e) { throw new Error(`El patrón de ${c.nombre} no es válido.`); }
    }
    const num = (id) => ($(id).value.trim() === "" ? null : Number($(id).value));
    return { cadenas, ventaAlta: num("numAlta"), ventaBaja: num("numBaja") };
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
    S.reglas.cadenas.push({ nombre: "Nueva cadena", patron: "", freq: "1x", dosVecesSobre: null });
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
      const coords = (S.plan.inicio ? [`${S.plan.inicio.lng},${S.plan.inicio.lat},0`] : []).concat(ids.map((id) => `${pos[id].lng},${pos[id].lat},0`)).join(" ");
      carpetas += `<Folder><name>${R.DIAS[d]} (${ids.length})</name>${marcas}<Placemark><name>Recorrido ${R.DIAS[d]}</name><styleUrl>#d${d}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark></Folder>`;
    });
    const salida = S.plan.inicio ? `<Placemark><name>Salida</name><Point><coordinates>${S.plan.inicio.lng},${S.plan.inicio.lat},0</coordinates></Point></Placemark>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Ruta ${x(S.ruta)} · Semana ${w}</name>${estilos}${salida}${carpetas}</Document></kml>`;
  }

  $("btnKmlA").onclick = () => descargar(`Ruta_${S.ruta}_SemanaA.kml`, kmlSemana("A"), "application/vnd.google-earth.kml+xml");
  $("btnKmlB").onclick = () => descargar(`Ruta_${S.ruta}_SemanaB.kml`, kmlSemana("B"), "application/vnd.google-earth.kml+xml");

  $("btnCsv").onclick = () => {
    const pos = posiciones();
    const filas = [["Semana", "Dia", "Orden", "Tienda", "Codigo", "Cuenta", "Direccion", "Frecuencia", "Venta_sem", "Lat", "Lng"]];
    ["A", "B"].forEach((w) => S.dias.forEach((d) => {
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
