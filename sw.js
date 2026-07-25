// Service worker mínimo — cachea el shell de la app para que abra rápido y
// funcione como PWA instalable. No implementa modo offline robusto (no hace
// falta: se asume conexión de datos móviles casi siempre disponible, ver
// spec §6), solo mejora la carga inicial.

const CACHE_NAME = "bimbo-tools-v1";
const ARCHIVOS_SHELL = [
  "index.html",
  "ibp.html",
  "msl.html",
  "admin.html",
  "css/styles.css",
  "js/data.js",
  "js/geo.js",
  "data/seed.json",
  "manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_SHELL)).catch(() => {})
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
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
