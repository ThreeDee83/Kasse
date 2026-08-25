const CACHE = "kassenraum-v70";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./xlsx-export.js", "./submitted-report-export.js", "./kds-order.js", "./pdf-export.js", "./cloud.js", "./config.js", "./manifest.webmanifest", "./vendor/supabase.js", "./vendor/xlsx.full.min.js", "./vendor/bcrypt.min.js", "./vendor/pdf-lib.min.js", "./assets/icons/favicon-32.png", "./assets/icons/apple-touch-icon.png", "./assets/icons/owncash-192.png", "./assets/icons/owncash-512.png", "./assets/icons/owncash-maskable-512.png", "./assets/pdf/stundenexport-vorlage.pdf"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
