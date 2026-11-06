// ============================================================================
// Ruteo — cálculo del plan de visitas A/B (rutas.html). Solo matemática, sin
// IA ni servicios externos: todo corre en el navegador.
// ----------------------------------------------------------------------------
// 1. Frecuencia de cada tienda según las reglas (cadena + venta semanal).
// 2. Asignación de días: cada tienda recibe un "patrón" de visitas válido para
//    su frecuencia (2x = lunes+jueves o martes+viernes en ambas semanas;
//    semanal = el mismo día en A y B; quincenal = un día en A o en B). Se
//    elige el patrón por búsqueda local: se mueve una tienda a otro patrón
//    mientras baje el costo total = millas de todos los días + penalidad por
//    días desbalanceados + penalidad fuerte si un día pasa del máximo.
// 3. Orden dentro de cada día: vecino más cercano + 2-opt (problema del
//    viajero), saliendo del punto de inicio del IBP si existe.
//
// Distancia: línea recta (haversine) x 1.3 como aproximación de manejo.
// Slots: "A1".."A6" / "B1".."B6" (semana + día, 1 = lunes ... 6 = sábado).
// ============================================================================

(function (raiz) {
  const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const FACTOR_MANEJO = 1.3;

  const REGLAS_DEFECTO = {
    cadenas: [
      { nombre: "Wawa", patron: "wawa", freq: "2x", dosVecesSobre: null },
      { nombre: "7-Eleven", patron: "7[\\s-]*eleven", freq: "1x", dosVecesSobre: 900 },
      { nombre: "Stop & Go", patron: "stop\\s*(and|&|n|-)?\\s*go", freq: "q", dosVecesSobre: null },
    ],
    ventaAlta: 900,
    ventaBaja: 100,
  };

  const ETIQUETA_FREQ = { "2x": "2x semana", "1x": "Semanal", q: "Quincenal", fuera: "Fuera de ruta" };

  // --------------------------------------------------------------------------
  // Frecuencia por regla
  // --------------------------------------------------------------------------

  function frecuenciaPorRegla(tienda, reglas) {
    const r = reglas || REGLAS_DEFECTO;
    const texto = `${tienda.tipo_cuenta || ""} ${tienda.nombre || ""}`;
    const venta = Number(tienda.ventaSem) || 0;
    for (const c of r.cadenas || []) {
      let re;
      try {
        re = new RegExp(c.patron, "i");
      } catch (e) {
        continue;
      }
      if (!re.test(texto)) continue;
      if (c.dosVecesSobre != null && venta > c.dosVecesSobre) {
        return { freq: "2x", regla: `${c.nombre} > $${c.dosVecesSobre}` };
      }
      return { freq: c.freq, regla: c.nombre };
    }
    if (venta > r.ventaAlta) return { freq: "2x", regla: `Venta > $${r.ventaAlta}` };
    if (venta < r.ventaBaja) return { freq: "q", regla: `Venta < $${r.ventaBaja}` };
    return { freq: "1x", regla: `Venta $${r.ventaBaja}–${r.ventaAlta}` };
  }

  // --------------------------------------------------------------------------
  // Patrones de visita válidos
  // --------------------------------------------------------------------------

  // dias: días hábiles habilitados, ej. [1,2,3,4,5]
  function patrones(freq, dias) {
    const hay = new Set(dias);
    if (freq === "2x") {
      const pares = [[1, 4], [2, 5], [3, 6], [1, 3], [3, 5]].filter(([a, b]) => hay.has(a) && hay.has(b));
      // Preferimos espaciado de 3 días; los de 2 días solo si no hay otro.
      const tres = pares.filter(([a, b]) => b - a === 3);
      const usar = tres.length ? tres : pares;
      return usar.map(([a, b]) => ({
        clave: `${a}+${b}`,
        etiqueta: `${DIAS[a]} y ${DIAS[b]}`,
        slots: [`A${a}`, `A${b}`, `B${a}`, `B${b}`],
      }));
    }
    if (freq === "1x") {
      return dias.map((d) => ({ clave: `${d}`, etiqueta: DIAS[d], slots: [`A${d}`, `B${d}`] }));
    }
    if (freq === "q") {
      const out = [];
      ["A", "B"].forEach((w) => dias.forEach((d) => out.push({ clave: `${w}${d}`, etiqueta: `Semana ${w} · ${DIAS[d]}`, slots: [`${w}${d}`] })));
      return out;
    }
    return [];
  }

  // Patrón que contiene un slot dado (para arrastrar una tienda a un día).
  function patronConSlot(freq, dias, slot) {
    return patrones(freq, dias).find((p) => p.slots.includes(slot)) || null;
  }

  // Patrón que una tienda tiene hoy dentro de un plan (por sus slots).
  function patronActual(id, freq, dias, slots) {
    const donde = Object.keys(slots).filter((s) => slots[s].includes(id)).sort();
    return patrones(freq, dias).find((p) => p.slots.slice().sort().join() === donde.join()) || null;
  }

  // --------------------------------------------------------------------------
  // Distancias y orden dentro del día
  // --------------------------------------------------------------------------

  function millas(a, b) {
    const R = 3958.8;
    const toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR;
    const dLng = (b.lng - a.lng) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h)) * FACTOR_MANEJO;
  }

  function largo(camino, pos, inicio) {
    let c = 0;
    if (inicio && camino.length) c += millas(inicio, pos[camino[0]]);
    for (let i = 0; i < camino.length - 1; i++) c += millas(pos[camino[i]], pos[camino[i + 1]]);
    return c;
  }

  function vecinoCercano(ids, pos, desde) {
    const quedan = new Set(ids);
    const camino = [];
    let actual = desde;
    while (quedan.size) {
      let mejor = null, dMejor = Infinity;
      quedan.forEach((id) => {
        const d = millas(actual, pos[id]);
        if (d < dMejor) { dMejor = d; mejor = id; }
      });
      camino.push(mejor);
      quedan.delete(mejor);
      actual = pos[mejor];
    }
    return camino;
  }

  // 2-opt sobre un camino abierto (con inicio fijo opcional).
  function dosOpt(camino, pos, inicio) {
    const p = camino.slice();
    const punto = (i) => (i < 0 ? inicio : pos[p[i]]);
    const d = (a, b) => (a && b ? millas(a, b) : 0);
    let mejoro = true;
    while (mejoro) {
      mejoro = false;
      for (let i = 0; i < p.length - 1; i++) {
        for (let k = i + 1; k < p.length; k++) {
          const antes = d(punto(i - 1), punto(i)) + (k + 1 < p.length ? d(punto(k), punto(k + 1)) : 0);
          const despues = d(punto(i - 1), punto(k)) + (k + 1 < p.length ? d(punto(i), punto(k + 1)) : 0);
          if (despues < antes - 1e-9) {
            const tramo = p.slice(i, k + 1).reverse();
            p.splice(i, k - i + 1, ...tramo);
            mejoro = true;
          }
        }
      }
    }
    return p;
  }

  // Orden óptimo (aprox.) de las tiendas de un día.
  function ordenarDia(ids, pos, inicio) {
    const conPos = ids.filter((id) => pos[id]);
    const sinPos = ids.filter((id) => !pos[id]);
    if (conPos.length < 2) return conPos.concat(sinPos);
    let mejor = null, cMejor = Infinity;
    const arranques = inicio ? [inicio] : conPos.map((id) => pos[id]);
    arranques.forEach((desde) => {
      const c0 = vecinoCercano(conPos, pos, desde);
      const c1 = dosOpt(c0, pos, inicio || null);
      const c = largo(c1, pos, inicio);
      if (c < cMejor) { cMejor = c; mejor = c1; }
    });
    return mejor.concat(sinPos);
  }

  // Estimación rápida de millas de un día (para la búsqueda local).
  function costoRapido(ids, pos, inicio) {
    if (!ids.length) return 0;
    const desde = inicio || pos[ids.reduce((a, b) => (pos[a].lng < pos[b].lng ? a : b))];
    return largo(vecinoCercano(ids, pos, desde), pos, inicio);
  }

  // --------------------------------------------------------------------------
  // Asignación de días (búsqueda local)
  // --------------------------------------------------------------------------

  function generadorAleatorio(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * tiendas: [{ id, lat, lng, freq }]  (freq: "2x" | "1x" | "q" | "fuera")
   * opts: {
   *   dias: [1,2,3,4,5], inicio: {lat,lng} | null,
   *   fijadas: { id: ["A1","B1"] }   // patrón que no se toca
   *   pesoBalance (default 3), maxPorDia (default null), intentos (default 8)
   * }
   * Devuelve { slots: {A1:[ids ordenados],...}, sinUbicar: [ids], millas: {A1: n,...} }
   */
  function calcularPlan(tiendas, opts) {
    const o = Object.assign({ dias: [1, 2, 3, 4, 5], inicio: null, fijadas: {}, pesoBalance: 3, maxPorDia: null, intentos: 8 }, opts || {});
    const pos = {};
    tiendas.forEach((t) => { if (t.lat != null && t.lng != null && isFinite(t.lat) && isFinite(t.lng)) pos[t.id] = { lat: +t.lat, lng: +t.lng }; });
    const activos = tiendas.filter((t) => t.freq !== "fuera" && pos[t.id]);
    const sinUbicar = tiendas.filter((t) => t.freq !== "fuera" && !pos[t.id]).map((t) => t.id);
    const todosSlots = [];
    ["A", "B"].forEach((w) => o.dias.forEach((d) => todosSlots.push(`${w}${d}`)));

    const opciones = activos.map((t) => {
      const fij = o.fijadas[t.id];
      const ps = patrones(t.freq, o.dias);
      if (fij) {
        const p = ps.find((x) => x.slots.slice().sort().join() === fij.slice().sort().join());
        if (p) return [p];
      }
      return ps;
    });
    const visitas = opciones.reduce((s, ops) => s + (ops[0] ? ops[0].slots.length : 0), 0);
    const meta = visitas / todosSlots.length;

    function evaluar(asig) {
      const s = {};
      todosSlots.forEach((k) => (s[k] = []));
      asig.forEach((p, i) => opciones[i][p].slots.forEach((k) => s[k].push(activos[i].id)));
      let c = 0;
      todosSlots.forEach((k) => {
        const n = s[k].length;
        c += costoRapido(s[k], pos, o.inicio) + o.pesoBalance * (n - meta) ** 2;
        if (o.maxPorDia && n > o.maxPorDia) c += 1000 * (n - o.maxPorDia);
      });
      return { costo: c, slots: s };
    }

    let mejor = null;
    for (let semilla = 1; semilla <= o.intentos; semilla++) {
      const rnd = generadorAleatorio(semilla * 7919);
      const asig = opciones.map((ops) => Math.floor(rnd() * ops.length));
      let actual = evaluar(asig).costo;
      let mejoro = true;
      while (mejoro) {
        mejoro = false;
        const orden = activos.map((_, i) => i).sort(() => rnd() - 0.5);
        for (const i of orden) {
          if (opciones[i].length < 2) continue;
          for (let p = 0; p < opciones[i].length; p++) {
            if (p === asig[i]) continue;
            const anterior = asig[i];
            asig[i] = p;
            const c = evaluar(asig).costo;
            if (c < actual - 1e-6) { actual = c; mejoro = true; }
            else asig[i] = anterior;
          }
        }
      }
      if (!mejor || actual < mejor.costo) mejor = { costo: actual, asig: asig.slice() };
    }

    const { slots } = activos.length ? evaluar(mejor.asig) : { slots: Object.fromEntries(todosSlots.map((k) => [k, []])) };
    const millasPorSlot = {};
    Object.keys(slots).forEach((k) => {
      slots[k] = ordenarDia(slots[k], pos, o.inicio);
      millasPorSlot[k] = largo(slots[k], pos, o.inicio);
    });
    return { slots, sinUbicar, millas: millasPorSlot };
  }

  // Reordena solo los días indicados (después de mover tiendas a mano).
  function reordenarSlots(slots, claves, pos, inicio) {
    const out = Object.assign({}, slots);
    claves.forEach((k) => { out[k] = ordenarDia(out[k] || [], pos, inicio); });
    return out;
  }

  function millasDeSlots(slots, pos, inicio) {
    const out = {};
    Object.keys(slots).forEach((k) => {
      out[k] = largo((slots[k] || []).filter((id) => pos[id]), pos, inicio);
    });
    return out;
  }

  // Revisa que cada tienda tenga exactamente las visitas de su frecuencia.
  function validar(slots, tiendas, dias) {
    const problemas = [];
    tiendas.forEach((t) => {
      if (t.freq === "fuera") return;
      const p = patronActual(t.id, t.freq, dias, slots);
      if (!p) problemas.push(t.id);
    });
    return problemas;
  }

  const api = {
    DIAS,
    REGLAS_DEFECTO,
    ETIQUETA_FREQ,
    frecuenciaPorRegla,
    patrones,
    patronConSlot,
    patronActual,
    millas,
    ordenarDia,
    calcularPlan,
    reordenarSlots,
    millasDeSlots,
    validar,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.BimboRuteo = api;
})(typeof window !== "undefined" ? window : globalThis);
