// ============================================================================
// Ruteo — cálculo del plan de visitas A/B (rutas.html). Solo matemática, sin
// IA ni servicios externos: todo corre en el navegador.
// ----------------------------------------------------------------------------
// 1. Frecuencia de cada tienda según las reglas (cadena + venta semanal).
// 2. Asignación de días: cada tienda recibe un "patrón" de visitas válido para
//    su frecuencia, dentro de los días de carga de la ruta (3x = tres días
//    bien espaciados, ej. lunes+miércoles+viernes; 2x = dos días separados
//    por 3, ej. lunes+jueves; semanal = el mismo día en A y B; quincenal =
//    un día en A o en B), igual en ambas semanas. Se
//    elige el patrón por búsqueda local: se mueve una tienda a otro patrón
//    mientras baje el costo total = millas de todos los días + penalidad por
//    días desbalanceados + penalidad fuerte si un día pasa del máximo.
// 3. Orden dentro de cada día: vecino más cercano + 2-opt (problema del
//    viajero), saliendo del warehouse los días que el IBP carga ahí (o del
//    punto de salida si lo hay).
//
// Distancia: línea recta (haversine) x 1.3 como aproximación de manejo.
// Slots: "A1".."A7" / "B1".."B7" (semana + día, 1 = lunes ... 7 = domingo).
// ============================================================================

(function (raiz) {
  const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const FACTOR_MANEJO = 1.3;

  // Las reglas reales viven en Supabase (rutas_config, clave "reglas").
  // Sin reglas cargadas, todas las tiendas quedan semanales.
  const REGLAS_DEFECTO = { cadenas: [], ventaMuyAlta: null, ventaAlta: null, ventaBaja: null };

  const ETIQUETA_FREQ = { "5x": "5x semana", "4x": "4x semana", "3x": "3x semana", "2x": "2x semana", "1x": "Semanal", q: "Quincenal", fuera: "Fuera de ruta" };

  // Idioma de las etiquetas (días, frecuencias, patrones). DIAS y
  // ETIQUETA_FREQ se cambian en su lugar para que quien los usa vea el nuevo.
  const TEXTOS = {
    es: {
      dias: ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
      freq: { "5x": "5x semana", "4x": "4x semana", "3x": "3x semana", "2x": "2x semana", "1x": "Semanal", q: "Quincenal", fuera: "Fuera de ruta" },
      y: "y",
      semana: "Semana",
    },
    en: {
      dias: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      freq: { "5x": "5x week", "4x": "4x week", "3x": "3x week", "2x": "2x week", "1x": "Weekly", q: "Biweekly", fuera: "Off route" },
      y: "and",
      semana: "Week",
    },
  };
  let txt = TEXTOS.es;
  function setIdioma(idioma) {
    txt = TEXTOS[idioma] || TEXTOS.es;
    DIAS.splice(0, DIAS.length, ...txt.dias);
    Object.assign(ETIQUETA_FREQ, txt.freq);
  }

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
      if (c.tresVecesSobre != null && venta > c.tresVecesSobre) {
        return { freq: "3x", regla: `${c.nombre} > ${c.tresVecesSobre}` };
      }
      if (c.dosVecesSobre != null && venta > c.dosVecesSobre) {
        return { freq: "2x", regla: `${c.nombre} > ${c.dosVecesSobre}` };
      }
      return { freq: c.freq, regla: c.nombre };
    }
    if (r.ventaMuyAlta != null && venta > r.ventaMuyAlta) return { freq: "3x", regla: `Venta > ${r.ventaMuyAlta}` };
    if (r.ventaAlta != null && venta > r.ventaAlta) return { freq: "2x", regla: `Venta > ${r.ventaAlta}` };
    if (r.ventaBaja != null && venta < r.ventaBaja) return { freq: "q", regla: `Venta < ${r.ventaBaja}` };
    return { freq: "1x", regla: "Resto (semanal)" };
  }

  // --------------------------------------------------------------------------
  // Patrones de visita válidos
  // --------------------------------------------------------------------------

  // Huecos (en días) entre visitas consecutivas, contando la vuelta de la
  // semana. Ej. [1,3,5] -> [2,2,3].
  function huecos(combo) {
    return combo.map((d, i) => (i < combo.length - 1 ? combo[i + 1] - d : combo[0] + 7 - d));
  }

  function combinaciones(dias, n) {
    const out = [];
    const rec = (desde, actual) => {
      if (actual.length === n) return out.push(actual.slice());
      for (let i = desde; i < dias.length; i++) { actual.push(dias[i]); rec(i + 1, actual); actual.pop(); }
    };
    rec(0, []);
    return out;
  }

  function patronMultiple(combo) {
    const nombres = combo.map((d) => DIAS[d]);
    return {
      clave: combo.join("+"),
      etiqueta: nombres.length > 2 ? `${nombres.slice(0, -1).join(", ")} ${txt.y} ${nombres[nombres.length - 1]}` : nombres.join(` ${txt.y} `),
      slots: ["A", "B"].flatMap((w) => combo.map((d) => `${w}${d}`)),
    };
  }

  // Visitas por semana de las frecuencias "2x".."5x" (0 para las demás).
  function veces(freq) {
    const m = /^([2-7])x$/.exec(freq || "");
    return m ? Number(m[1]) : 0;
  }

  // dias: días que trabaja la ruta, ej. [1,2,3,4,5] o [1,3,5]
  // todos = false: solo los patrones bien espaciados (los que usa el cálculo).
  // todos = true: cualquier combinación de días (para mover a mano: L+M+J,
  // L+M+S...); primero van los bien espaciados.
  function patrones(freq, dias, todos) {
    const lista = [...new Set(dias)].sort((a, b) => a - b);
    const n = veces(freq);
    if (todos && n) {
      const buenos = patrones(freq, dias, false);
      const claves = new Set(buenos.map((p) => p.clave));
      return buenos.concat(combinaciones(lista, n).map(patronMultiple).filter((p) => !claves.has(p.clave)));
    }
    if (freq === "2x") {
      const pares = combinaciones(lista, 2);
      // Preferimos 3 días entre visitas (lunes+jueves, martes+viernes...);
      // si los días de carga no lo permiten, cualquier par con al menos un
      // día de por medio (ej. con carga L/M/V: L+M, M+V o L+V).
      const tres = pares.filter(([a, b]) => b - a === 3);
      const minimo = (c) => Math.min(...huecos(c));
      const mejor = Math.min(2, Math.max(...pares.map(minimo)));
      const usar = tres.length ? tres : pares.filter((c) => minimo(c) >= mejor);
      return usar.map(patronMultiple);
    }
    if (n >= 3) {
      // 3x, 4x, 5x: visitas lo más parejas posible (3x = lunes+miércoles+
      // viernes...): el hueco más corto lo más largo posible y, entre esas,
      // el hueco más largo lo más corto posible.
      const combos = combinaciones(lista, n);
      if (!combos.length) return [];
      const minimo = (c) => Math.min(...huecos(c));
      const maximo = (c) => Math.max(...huecos(c));
      const mejorMin = Math.max(...combos.map(minimo));
      const conMin = combos.filter((c) => minimo(c) === mejorMin);
      const mejorMax = Math.min(...conMin.map(maximo));
      return conMin.filter((c) => maximo(c) === mejorMax).map(patronMultiple);
    }
    if (freq === "1x") {
      return lista.map((d) => ({ clave: `${d}`, etiqueta: DIAS[d], slots: [`A${d}`, `B${d}`] }));
    }
    if (freq === "q") {
      const out = [];
      ["A", "B"].forEach((w) => lista.forEach((d) => out.push({ clave: `${w}${d}`, etiqueta: `${txt.semana} ${w} · ${DIAS[d]}`, slots: [`${w}${d}`] })));
      return out;
    }
    return [];
  }

  // Patrón que contiene un slot dado (para arrastrar una tienda a un día).
  function patronConSlot(freq, dias, slot) {
    return patrones(freq, dias).find((p) => p.slots.includes(slot)) || null;
  }

  // Patrón que una tienda tiene hoy dentro de un plan (por sus slots).
  // Acepta cualquier combinación de días, también las puestas a mano.
  function patronActual(id, freq, dias, slots) {
    const donde = Object.keys(slots).filter((s) => slots[s].includes(id)).sort();
    return patrones(freq, dias, true).find((p) => p.slots.slice().sort().join() === donde.join()) || null;
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

  // `inicio` puede ser un punto {lat,lng}, null, o una función slot -> punto
  // (para salir del warehouse solo los días que el IBP carga ahí).
  function salidaDe(inicio, k) {
    return (typeof inicio === "function" ? inicio(k) : inicio) || null;
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
   * tiendas: [{ id, lat, lng, freq }]  (freq: "5x" | "4x" | "3x" | "2x" | "1x" | "q" | "fuera")
   * opts: {
   *   dias: [1,2,3,4,5], inicio: {lat,lng} | null | (slot) => {lat,lng} | null,
   *   fijadas: { id: ["A1","B1"] }   // patrón que no se toca
   *   pesoBalance (default 3), maxPorDia (default null), intentos (default 8)
   * }
   * Devuelve { slots: {A1:[ids ordenados],...}, sinUbicar: [ids], sinDias: [ids], millas: {A1: n,...} }
   * sinDias: tiendas cuya frecuencia no cabe en los días de carga (ej. 3x
   * con solo dos días de carga); quedan sin asignar.
   */
  function calcularPlan(tiendas, opts) {
    const o = Object.assign({ dias: [1, 2, 3, 4, 5], inicio: null, fijadas: {}, pesoBalance: 3, maxPorDia: null, intentos: 8 }, opts || {});
    const pos = {};
    tiendas.forEach((t) => { if (t.lat != null && t.lng != null && isFinite(t.lat) && isFinite(t.lng)) pos[t.id] = { lat: +t.lat, lng: +t.lng }; });
    const sinDias = tiendas.filter((t) => t.freq !== "fuera" && pos[t.id] && !patrones(t.freq, o.dias).length).map((t) => t.id);
    const activos = tiendas.filter((t) => t.freq !== "fuera" && pos[t.id] && patrones(t.freq, o.dias).length);
    const sinUbicar = tiendas.filter((t) => t.freq !== "fuera" && !pos[t.id]).map((t) => t.id);
    const todosSlots = [];
    ["A", "B"].forEach((w) => o.dias.forEach((d) => todosSlots.push(`${w}${d}`)));

    const opciones = activos.map((t) => {
      const fij = o.fijadas[t.id];
      const ps = patrones(t.freq, o.dias);
      if (fij) {
        const p = patrones(t.freq, o.dias, true).find((x) => x.slots.slice().sort().join() === fij.slice().sort().join());
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
        c += costoRapido(s[k], pos, salidaDe(o.inicio, k)) + o.pesoBalance * (n - meta) ** 2;
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
      slots[k] = ordenarDia(slots[k], pos, salidaDe(o.inicio, k));
      millasPorSlot[k] = largo(slots[k], pos, salidaDe(o.inicio, k));
    });
    return { slots, sinUbicar, sinDias, millas: millasPorSlot };
  }

  // Reordena solo los días indicados (después de mover tiendas a mano).
  function reordenarSlots(slots, claves, pos, inicio) {
    const out = Object.assign({}, slots);
    claves.forEach((k) => { out[k] = ordenarDia(out[k] || [], pos, salidaDe(inicio, k)); });
    return out;
  }

  function millasDeSlots(slots, pos, inicio) {
    const out = {};
    Object.keys(slots).forEach((k) => {
      out[k] = largo((slots[k] || []).filter((id) => pos[id]), pos, salidaDe(inicio, k));
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
    salidaDe,
    veces,
    setIdioma,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.BimboRuteo = api;
})(typeof window !== "undefined" ? window : globalThis);
