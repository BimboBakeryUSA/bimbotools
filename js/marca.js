// ============================================================================
// Nombre de la app y datos de la empresa, traídos de Supabase (tabla pública
// app_config: clave/valor). Así el código no lleva ningún nombre de marca.
//
// Uso en las páginas:
//   <title data-base="Mi Territorio">Mi Territorio</title>  -> "Mi Territorio — <nombre>"
//   <span data-marca="nombre_app"></span>                    -> texto del valor
// Se guarda en el navegador para que la próxima vez salga al instante.
// window.AppMarca.listo es una promesa con el objeto { clave: valor }.
// ============================================================================

(function () {
  const LS = "appMarca";
  const cfg = window.APP_CONFIG || {};

  function leerCache() {
    try { return JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch (e) { return {}; }
  }

  // Valores que todavía no se llenaron en Supabase ("<<...>>") no se muestran.
  function valido(v) {
    return typeof v === "string" && v.trim() && !/^<<.*>>$/.test(v.trim());
  }

  function aplicar(datos) {
    const nombre = valido(datos.nombre_app) ? datos.nombre_app.trim() : "";
    const t = document.querySelector("title[data-base]");
    if (t) document.title = nombre ? `${t.dataset.base} — ${nombre}` : t.dataset.base;
    document.querySelectorAll("[data-marca]").forEach((el) => {
      const v = datos[el.dataset.marca];
      if (valido(v)) el.textContent = v.trim();
    });
  }

  async function traer() {
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return {};
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/app_config?select=clave,valor`, {
      headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}` },
    });
    if (!r.ok) throw new Error(`app_config: ${r.status}`);
    const filas = await r.json();
    const datos = {};
    (filas || []).forEach((f) => (datos[f.clave] = f.valor));
    return datos;
  }

  let datos = leerCache();
  const listo = traer()
    .then((nuevos) => {
      datos = nuevos;
      try { localStorage.setItem(LS, JSON.stringify(nuevos)); } catch (e) {}
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => aplicar(datos));
      else aplicar(datos);
      return datos;
    })
    .catch(() => datos);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => aplicar(datos));
  else aplicar(datos);

  window.AppMarca = {
    listo,
    get datos() { return datos; },
    nombre: () => (valido(datos.nombre_app) ? datos.nombre_app.trim() : ""),
  };
})();
