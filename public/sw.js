const CACHE_NAME = "kai-desk-v2";
const BASE_URL = new URL("./", self.registration.scope).pathname;
const ASSETS = [BASE_URL, `${BASE_URL}index.html`, `${BASE_URL}manifest.webmanifest`, `${BASE_URL}icons/icon.svg`];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).catch(() => caches.match(BASE_URL))
      );
    }),
  );
});
