// ============================================================================
// rutas.html — español / inglés.
// ----------------------------------------------------------------------------
// La página se escribe en español. En inglés:
//   - Los textos fijos (botones, títulos, encabezados, avisos sin números) se
//     traducen solos: un observador revisa cada texto que aparece en la página
//     y, si está en EN, lo cambia. Al volver a español se restaura el original.
//   - Los textos con datos (números, nombres) pasan por T("plantilla {x}", {x}).
//   - Los párrafos con formato llevan data-t="id" y se cambian enteros (HTML_EN).
//   - Días y frecuencias los cambia BimboRuteo.setIdioma.
// ============================================================================

(function () {
  const EN = {
    // Encabezado y sesión
    "Planificador de rutas": "Route planner",
    "Semana A y B por IBP": "Week A and B by IBP",
    "Volver al Administrador": "Back to Admin",
    "Iniciar sesión": "Sign in",
    "Con tu cuenta de admin de Bimbo Tools.": "With your Bimbo Tools admin account.",
    "Correo": "Email",
    "Contraseña": "Password",
    "Entrar": "Sign in",
    "Correo o contraseña incorrectos.": "Wrong email or password.",
    "Tu cuenta no tiene perfil en Bimbo Tools.": "Your account has no Bimbo Tools profile.",
    "Esta página es solo para managers de Bimbo Tools.": "This page is for Bimbo Tools managers only.",
    "No se pudo conectar: {e}": "Could not connect: {e}",

    // Barra de ruta
    "Ruta (IBP)": "Route (IBP)",
    "Todos": "All",
    "Cargar ruta": "Load route",
    "Cargando…": "Loading…",
    "Cambios sin guardar": "Unsaved changes",
    "Hay cambios sin guardar en esta ruta. ¿Cargar otra de todos modos?": "This route has unsaved changes. Load another one anyway?",
    "Esta ruta todavía no tiene plan guardado.": "This route has no saved plan yet.",
    "Plan guardado {fecha}{por}": "Plan saved {fecha}{por}",
    " por {a}": " by {a}",
    "No se pudo cargar la ruta: {e}": "Could not load the route: {e}",
    "Falta crear las tablas del planificador: corre scripts/rutas_schema.sql en Supabase.": "The planner tables are missing: run scripts/rutas_schema.sql in Supabase.",
    "Faltan las tablas del planificador en Supabase (scripts/rutas_schema.sql). Puedes calcular, pero no guardar.": "The planner tables are missing in Supabase (scripts/rutas_schema.sql). You can calculate but not save.",
    "Todavía no hay reglas de frecuencia: defínelas en la pestaña Reglas.": "There are no frequency rules yet: set them in the Rules tab.",

    // Estadísticas
    "tiendas en ruta": "stores on route",
    "con ubicación": "with location",
    "visitas en 2 semanas": "visits in 2 weeks",
    "paradas por día": "stops per day",
    "millas por semana": "miles per week",
    "sin asignar": "unassigned",

    // Pestañas
    "Plan A/B": "A/B plan",
    "Tiendas y frecuencias": "Stores and frequencies",
    "Ubicaciones": "Locations",
    "Reglas": "Rules",

    // Plan
    "Semana": "Week",
    "Semana A": "Week A",
    "Semana B": "Week B",
    "Días que trabaja la ruta": "Days the route works",
    "Máx. paradas/día": "Max. stops/day",
    "Salida los días sin warehouse (lat, lng)": "Start on days without warehouse (lat, lng)",
    "opcional — 38.8462, -77.3064": "optional — 38.8462, -77.3064",
    "Calcular plan": "Calculate plan",
    "Reordenar días": "Reorder days",
    "Soltar fijadas": "Release pinned",
    "Guardar": "Save",
    "Agregar warehouse": "Add warehouse",
    "Cambiar warehouse": "Change warehouse",
    "KML semana A": "KML week A",
    "KML semana B": "KML week B",
    "Imprimir para el IBP": "Print for the IBP",
    "Ver en Mi Territorio": "View in My Territory",
    "Plan calculado.": "Plan calculated.",
    " {n} tiendas sin ubicación quedaron sin asignar.": " {n} stores without location were left unassigned.",
    " {n} tiendas no caben en los días de trabajo ({dias}) con su frecuencia.": " {n} stores don't fit the working days ({dias}) with their frequency.",
    "Orden de cada día recalculado.": "Order of each day recalculated.",
    "Ninguna tienda queda fijada. El próximo cálculo puede moverlas todas.": "No store is pinned now. The next calculation may move all of them.",
    "Guardado {fecha}": "Saved {fecha}",
    "Guardado. Ojo: {n} tiendas siguen sin asignar.": "Saved. Note: {n} stores are still unassigned.",
    "Plan guardado.": "Plan saved.",
    "No se guardó: faltan las tablas del planificador en Supabase.": "Not saved: the planner tables are missing in Supabase.",
    "No se guardó: {e}": "Not saved: {e}",
    "{n} tiendas no caben en {dias} con su frecuencia (ej. 3x semana necesita 3 días de trabajo).": "{n} stores don't fit in {dias} with their frequency (e.g. 3x week needs 3 working days).",
    "La ruta necesita al menos un día de trabajo.": "The route needs at least one working day.",
    "Escribe el punto de salida como “lat, lng”, por ejemplo 38.8462, -77.3064.": "Write the starting point as “lat, lng”, for example 38.8462, -77.3064.",
    "{n} paradas · ~{mi} mi": "{n} stops · ~{mi} mi",
    "Sin asignar": "Unassigned",
    "Mover a…": "Move to…",
    "Quitar del plan": "Remove from plan",
    "Subir": "Up",
    "Bajar": "Down",
    "Fijada": "Pinned",
    "Sin ubicación": "No location",
    "/sem": "/wk",
    "Ahí solo va el warehouse. Suelta la tienda en un día.": "Only the warehouse goes there. Drop the store on a day.",
    "Con los días de trabajo {dias} no cabe una tienda {freq}.": "A {freq} store doesn't fit the working days {dias}.",
    "{tienda} ya va el {dia}.": "{tienda} is already visited on {dia}.",
    "Parada {n}": "Stop {n}",

    // Warehouse
    "Usar uno ya registrado": "Use one already saved",
    "— Uno nuevo (escribe la dirección) —": "— A new one (type the address) —",
    "Nombre": "Name",
    "Dirección": "Address",
    "Ciudad": "City",
    "Estado": "State",
    "Si no lo encuentra por la dirección: coordenadas (lat, lng)": "If the address isn't found: coordinates (lat, lng)",
    "opcional — en Google Maps, clic derecho sobre el warehouse": "optional — in Google Maps, right-click the warehouse",
    "Agregar a la ruta": "Add to route",
    "Cancelar": "Cancel",
    "Ponle un nombre al warehouse.": "Give the warehouse a name.",
    "Las coordenadas van como “lat, lng”, por ejemplo 38.8462, -77.3064.": "Coordinates go as “lat, lng”, for example 38.8462, -77.3064.",
    "Escribe dirección y ZIP (o ciudad y estado), o pega las coordenadas.": "Type the address and ZIP (or city and state), or paste the coordinates.",
    "Buscando la dirección…": "Looking up the address…",
    "No encontré esa dirección. Revísala o pega las coordenadas (Google Maps, clic derecho sobre el warehouse).": "That address wasn't found. Check it or paste the coordinates (Google Maps, right-click the warehouse).",
    "{w} agregado. Arrástralo a los días que el IBP va a cargar (o usa sus botones de días). Luego Guardar.": "{w} added. Drag it to the days the IBP loads there (or use its day buttons). Then Save.",
    "sin días": "no days",
    "Días que el IBP carga aquí:": "Days the IBP loads here:",
    "Quitar de la ruta": "Remove from route",
    "Arrástralo a cada día que el IBP va a cargar.": "Drag it to each day the IBP loads.",
    "Carga · salida del día": "Load · day start",
    "¿Quitar {w} de esta ruta?": "Remove {w} from this route?",
    "Warehouse · carga {dias}": "Warehouse · loads {dias}",
    "— sin días asignados": "— no days assigned",
    "Salida los días sin warehouse": "Start on days without warehouse",
    "Punto de salida": "Starting point",
    "Quitar de este día": "Remove from this day",

    // Tiendas
    "Tienda": "Store",
    "Cuenta": "Account",
    "Venta/sem": "Sales/wk",
    "Regla": "Rule",
    "Frecuencia": "Frequency",
    "Días en el plan": "Days in plan",
    "Mi Territorio (IBP)": "My Territory (IBP)",
    "Ubicación": "Location",
    " (regla)": " (rule)",
    "Sí": "Yes",
    "No": "No",
    "Resto (semanal)": "Others (weekly)",
    "Inactiva (IBP)": "Inactive (IBP)",
    "Por pedido (IBP)": "On demand (IBP)",
    "Venta > {n}": "Sales > {n}",
    "Venta < {n}": "Sales < {n}",
    "Quitar el warehouse de {dia}": "Remove the warehouse from {dia}",
    "activa": "active",
    "inactiva": "inactive",
    "sin revisar": "not reviewed",
    "{tienda}: {freq}.": "{tienda}: {freq}.",

    // Ubicaciones
    "Coordenadas": "Coordinates",
    "Ubicar todas las rutas": "Locate all routes",
    "Respaldo: archivo del Census u OpenStreetMap manual": "Backup: Census file or manual OpenStreetMap",
    "Archivo Census (esta ruta, sin ubicación)": "Census file (this route, no location)",
    "Archivo Census (todas las rutas, sin ubicación)": "Census file (all routes, no location)",
    "Importar resultado Census": "Import Census result",
    "Buscar en OpenStreetMap las que faltan": "Search missing ones in OpenStreetMap",
    "Detener búsqueda": "Stop search",
    "Fuente": "Source",
    "Falta": "Missing",
    "Manual": "Manual",
    "{con} de {total} tiendas de esta ruta tienen ubicación": "{con} of {total} stores on this route have a location",
    "Pega las coordenadas como “lat, lng”, por ejemplo 39.0123, -77.4567.": "Paste the coordinates as “lat, lng”, for example 39.0123, -77.4567.",
    "Ubicación guardada.": "Location saved.",
    "No se guardó la ubicación: {e}": "Location not saved: {e}",
    "Todas las tiendas de esta ruta ya tienen ubicación.": "All stores on this route already have a location.",
    "Preparando el archivo de todas las rutas…": "Preparing the file for all routes…",
    "Todas las tiendas ya tienen ubicación.": "All stores already have a location.",
    "Archivo con {n} tiendas sin ubicación (el Census acepta hasta 10,000 por archivo).": "File with {n} stores without location (the Census accepts up to 10,000 per file).",
    "No se pudo preparar el archivo: {e}": "Could not prepare the file: {e}",
    "Leyendo el resultado del Census…": "Reading the Census result…",
    "El archivo no trae coordenadas reconocibles. Revisa que sea el resultado del Census (Address Batch).": "The file has no recognizable coordinates. Make sure it is the Census result (Address Batch).",
    "Guardadas {n} ubicaciones del Census.": "Saved {n} locations from the Census.",
    " {n} direcciones no tuvieron coincidencia (búscalas en OpenStreetMap o ponlas a mano).": " {n} addresses had no match (search them in OpenStreetMap or enter them by hand).",
    " {n} no se tocaron porque ya tenían ubicación manual.": " {n} were left as is because they already had a manual location.",
    " {n} códigos no existen en Bimbo Tools.": " {n} codes don't exist in Bimbo Tools.",
    "No se pudo importar: {e}": "Could not import: {e}",
    "Ubicando tiendas ({fase}): {h} de {n}…": "Locating stores ({fase}): {h} of {n}…",
    "{n} tiendas ubicadas. {m} sin ubicación: ponlas a mano en la pestaña Ubicaciones.": "{n} stores located. {m} without location: enter them by hand in the Locations tab.",
    "{n} tiendas ubicadas.": "{n} stores located.",
    "{msg} Plan calculado: revísalo y presiona Guardar.": "{msg} Plan calculated: review it and press Save.",
    "Ya hay una búsqueda de ubicaciones en curso.": "A location search is already running.",
    "Revisando qué tiendas no tienen ubicación…": "Checking which stores have no location…",
    "Todas las tiendas de todas las rutas ya tienen ubicación.": "All stores on all routes already have a location.",
    "{fase}: {h} de {n} · {enc} ubicadas. Deja la página abierta.": "{fase}: {h} of {n} · {enc} located. Keep the page open.",
    "Búsqueda interrumpida. Lo ya encontrado quedó guardado; presiona de nuevo para seguir.": "Search interrupted. What was found is saved; press again to continue.",
    "Listo: {n} de {total} tiendas ubicadas.": "Done: {n} of {total} stores located.",
    " Sin ubicación ({n}): {lista}. Ponlas a mano.": " Without location ({n}): {lista}. Enter them by hand.",
    "No se pudo completar: {e}": "Could not finish: {e}",
    "Buscando {h} de {n}… ({enc} encontradas)": "Searching {h} of {n}… ({enc} found)",
    "OpenStreetMap encontró {enc} de {h}.": "OpenStreetMap found {enc} of {h}.",
    " Sin resultado: {lista}. Ponlas a mano desde Google Maps.": " No result: {lista}. Enter them by hand from Google Maps.",

    // Reglas
    "Reglas de frecuencia": "Frequency rules",
    "Cadena": "Chain",
    "Patrón": "Pattern",
    "2x si venta >": "2x if sales >",
    "3x si venta >": "3x if sales >",
    "Agregar cadena": "Add chain",
    "Resto: 3x semana si venta >": "Others: 3x week if sales >",
    "2x semana si venta >": "2x week if sales >",
    "Quincenal si venta <": "Biweekly if sales <",
    "Guardar reglas": "Save rules",
    "Quitar": "Remove",
    "Nueva cadena": "New chain",
    "El patrón de {c} no es válido.": "The pattern for {c} is not valid.",
    "No se guardaron: faltan las tablas del planificador en Supabase.": "Not saved: the planner tables are missing in Supabase.",
    "No se guardaron: {e}": "Not saved: {e}",
    "Reglas guardadas.": "Rules saved.",
    "Reglas guardadas. {n} tiendas cambiaron de frecuencia: revisa el plan o recalcúlalo.": "Rules saved. {n} stores changed frequency: review the plan or recalculate it.",

    // Hoja impresa
    "Ruta {ruta}": "Route {ruta}",
    "Plan de visitas · Semana A y B": "Visit plan · Week A and B",
    "Warehouse: {w}": "Warehouse: {w}",
    "Carga: {dias}": "Loads: {dias}",
    "Días de trabajo: {dias}": "Working days: {dias}",
    "Impreso {fecha}": "Printed {fecha}",
    "Código": "Code",
    "Hecho": "Done",
    "Carga": "Load",
    "Sin visitas": "No visits",
    "Ojo: hay cambios sin guardar; se imprime lo que ves en pantalla.": "Note: there are unsaved changes; what you see on screen is printed.",
    "{n} tiendas sin asignar no salen en la hoja.": "{n} unassigned stores are not on the sheet.",
  };

  // Párrafos con formato: data-t="id"
  const HTML_EN = {
    notaPlan:
      "Drag a store to another day to move it (on the phone use “Move to”). Stores you move by hand are <b>pinned</b> and the calculation keeps them. The calculation puts 2x and 3x stores on well-spaced days, but you decide: drag any visit to another day (e.g. M+T+Th or M+T+Sa) and the others stay where they are. What you move counts for weeks A and B. The <b>warehouse</b> is placed like one more stop: drag it to each day the IBP loads (or use its day buttons); on those days the route starts there.",
    notaTiendas:
      "Frequency comes from the rules. Change it here only for exceptions; “Off route” takes it out of the plan. Stores marked inactive or “on demand” in My Territory are left out by default.",
    notaUbicaciones:
      "When a route is loaded, stores without a location are looked up automatically in the Census and, if not found, in OpenStreetMap. They are saved in Supabase, so it happens only once. Those not found are entered by hand: in Google Maps, right-click the store → copy the coordinates and paste them in the table.",
    notaCensus:
      "If the automatic search fails, download the file, upload it at <a href=\"https://geocoding.geo.census.gov/geocoder/locations/addressbatch?form\" target=\"_blank\" rel=\"noopener\">geocoding.geo.census.gov → Address Batch</a> (benchmark “Public_AR_Current”) and import the result here.",
    notaReglas:
      "They are checked in order: first the chains (the pattern searches the store's account and name), then the average weekly sales of the last 12 weeks. They apply to all routes.",
  };

  let idioma = "es";
  const textos = new Map(); // nodo de texto -> { es, en }
  const atributos = new Map(); // elemento -> { atributo: { es, en } }
  const ATTRS = ["placeholder", "title", "aria-label"];

  function plantilla(s, vars) {
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
  }

  // Traduce una plantilla en español: T("Guardado {fecha}", { fecha }).
  function T(es, vars) {
    return plantilla((idioma === "en" && EN[es]) || es, vars);
  }

  function traducirTexto(nodo) {
    const actual = nodo.nodeValue;
    const reg = textos.get(nodo);
    if (reg && reg.en === actual) return;
    const clave = actual.trim();
    if (!clave || !EN[clave] || EN[clave] === clave) return;
    const en = actual.replace(clave, EN[clave]);
    if (textos.size > 5000) textos.forEach((r, n) => { if (!n.isConnected) textos.delete(n); });
    textos.set(nodo, { es: actual, en });
    nodo.nodeValue = en;
  }

  function traducirElemento(el) {
    if (el.dataset && el.dataset.t && HTML_EN[el.dataset.t]) {
      if (el.dataset.tEs == null) el.dataset.tEs = el.innerHTML;
      if (el.innerHTML !== HTML_EN[el.dataset.t]) el.innerHTML = HTML_EN[el.dataset.t];
      return; // su contenido ya quedó en inglés
    }
    ATTRS.forEach((a) => {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) return;
      const reg = atributos.get(el) || {};
      if (reg[a] && reg[a].en === v) return;
      const clave = v.trim();
      if (!EN[clave] || EN[clave] === clave) return;
      reg[a] = { es: v, en: EN[clave] };
      atributos.set(el, reg);
      el.setAttribute(a, EN[clave]);
    });
  }

  function recorrer(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) return traducirTexto(raiz);
    if (raiz.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(raiz.tagName)) return;
    traducirElemento(raiz);
    if (raiz.dataset && raiz.dataset.t) return;
    for (let n = raiz.firstChild; n; n = n.nextSibling) recorrer(n);
  }

  const observador = new MutationObserver((cambios) => {
    if (idioma !== "en") return;
    cambios.forEach((c) => {
      if (c.type === "characterData") traducirTexto(c.target);
      else if (c.type === "attributes") traducirElemento(c.target);
      else c.addedNodes.forEach(recorrer);
    });
  });

  function setIdioma(nuevo) {
    idioma = nuevo === "en" ? "en" : "es";
    document.documentElement.lang = idioma;
    if (window.BimboRuteo) window.BimboRuteo.setIdioma(idioma);
    if (idioma === "en") return recorrer(document.body);
    textos.forEach((r, nodo) => { if (nodo.isConnected && nodo.nodeValue === r.en) nodo.nodeValue = r.es; });
    atributos.forEach((reg, el) => Object.keys(reg).forEach((a) => { if (el.getAttribute(a) === reg[a].en) el.setAttribute(a, reg[a].es); }));
    document.querySelectorAll("[data-t-es]").forEach((el) => { el.innerHTML = el.dataset.tEs; delete el.dataset.tEs; });
    textos.clear();
    atributos.clear();
  }

  function iniciar() {
    observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.RutasIdioma = {
    T,
    setIdioma,
    iniciar,
    get idioma() { return idioma; },
    get locale() { return idioma === "en" ? "en-US" : "es-US"; },
  };
})();
