// Service worker mínimo — cachea el shell de la app para que abra rápido y
// funcione como PWA instalable. No implementa modo offline robusto (no hace
// falta: se asume conexión de datos móviles casi siempre disponible, ver
// spec §6), solo mejora la carga inicial.
//
// IMPORTANTE — por qué "reload" en cada fetch: un fetch() normal (incluso
// dentro de este service worker) respeta la caché HTTP del navegador, así
// que un simple "red primero" no bastaba — un celular podía quedarse con un
// css/styles.css viejo aunque el HTML sí se actualizara (pasó el 3-sep-2026
// con el rediseño del panel admin: el HTML llegó fresco, el CSS se quedó
// cacheado de antes). `cache: "reload"` obliga a ignorar esa caché HTTP y sí
// ir a la red de verdad en cada visita.

const CACHE_NAME = "bimbo-tools-v5";
const ARCHIVOS_SHELL = [
  "index.html",
  "ibp.html",
  "msl.html",
  "admin.html",
  "mi-territorio.html",
  "css/styles.css",
  "js/data.js",
  "js/geo.js",
  "js/depuracion.js",
  "data/seed.json",
  "manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          ARCHIVOS_SHELL.map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => cache.put(url, res))
              .catch(() => {})
          )
        )
      )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Solo cacheamos GET del propio origen (el shell de la app). Las llamadas
  // a Supabase (API cruzada, y las RPC son POST) van directo a la red — el
  // Cache API tampoco acepta cachear peticiones que no sean GET.
  if (req.method !== "GET") return;
  const esPropio = req.url.startsWith(self.location.origin);
  event.respondWith(
    fetch(req, esPropio ? { cache: "reload" } : undefined)
      .then((res) => {
        if (esPropio) {
          const copia = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
