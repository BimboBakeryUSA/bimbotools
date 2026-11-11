// Helpers de UI compartidos (tarjetas estilo shadcn/ui, iconos SVG, semáforo).
// Sin dependencias: todo es HTML en strings, igual que el resto de la app.

const AppUI = (() => {
  const ICONOS = {
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    store: '<path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0"/><path d="M10 20v-5h4v5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    map: '<path d="M14.1 6 9.9 4 3 7v13l6.9-3 4.2 2 6.9-3V3z"/><path d="M9.9 4v13M14.1 6v13"/>',
    pause: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  };

  function icono(nombre, size = 18) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ""}</svg>`;
  }

  // Tono del semáforo según % de cumplimiento.
  function tonoPct(pct, total) {
    if (!total) return "gris";
    if (pct >= 90) return "verde";
    if (pct >= 50) return "amarillo";
    return "rojo";
  }

  function etiquetaSemaforo(sem) {
    return { verde: "En meta", amarillo: "Atención", rojo: "Crítico", gris: "Sin dato" }[sem] || "Sin dato";
  }

  function iniciales(nombre) {
    return (nombre || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("");
  }

  function statCard({ titulo, icono: ic, tono = "accent", valor, sub = "", meter = null }) {
    return `
      <div class="stat-card tono-${tono}">
        <div class="stat-head">
          <span class="stat-title">${titulo}</span>
          <span class="stat-icon">${icono(ic)}</span>
        </div>
        <div class="stat-value">${valor}</div>
        <div class="stat-sub">${sub}</div>
        ${meter != null ? `<div class="stat-meter"><span style="width:${meter}%"></span></div>` : ""}
      </div>
    `;
  }

  return { icono, tonoPct, etiquetaSemaforo, iniciales, statCard };
})();

// Reemplaza <span data-icono="nombre"></span> por el SVG correspondiente.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-icono]").forEach((el) => {
    el.innerHTML = AppUI.icono(el.dataset.icono, Number(el.dataset.size) || 18);
  });
});
