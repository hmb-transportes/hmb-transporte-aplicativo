const CACHE = "hmb-track-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./ui.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./firebase-config.js",
  "./firebase-init.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  
  // Não cachear recursos externos
  if (url.hostname.includes("firebase") || 
      url.hostname.includes("google") ||
      url.hostname.includes("gstatic") ||
      url.hostname.includes("jsdelivr") ||
      url.hostname.includes("firebaseio")) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Cache agressivo: Stale-While-Revalidate com prioridade para cache
  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Se tem cache, retorna imediatamente SEM esperar atualização
      if (cached) {
        // Atualiza cache em background sem bloquear
        const fetchPromise = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE).then((cache) => {
              cache.put(event.request, response);
            });
          }
        }).catch(() => {}); // Ignora erros de atualização
        return cached;
      }
      
      // Se não tem cache, busca e cacheia
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    }).catch(() => {
      // Fallback para navegação
      if (event.request.mode === "navigate") {
        return caches.match("./index.html");
      }
    })
  );
});
