// Offline cache for Tally Invoices. Bump VERSION whenever any file changes,
// so phones fetch the new files and show the "new version" banner.
const VERSION = "tally-v3";
const FILES = [
  "./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest",
  "./vendor/jspdf.umd.min.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

// Cache first: the app opens with no connection. Only this site's own files are handled.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, {ignoreSearch: true}).then(hit =>
      hit || (req.mode === "navigate" ? caches.match("./index.html") : fetch(req))
    )
  );
});
