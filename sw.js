const CACHE = "uba-ai-v5";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

// The page itself is network-first so updates show up right away.
// Other files are cache-first for speed and offline use.
// API calls are never cached.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isPage = e.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
  if (isPage) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match("./index.html"))));
});
