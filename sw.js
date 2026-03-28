const CACHE = "math-arcade-v1";
const PRECACHE = ["./", "./index.html", "./css/styles.css", "./js/app.js", "./manifest.json", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
