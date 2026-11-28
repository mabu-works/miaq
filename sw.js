// 📦 Make It a Quote Webメーカー の Service Worker。
// アプリの殻（HTML / CSS / JS / フォント / アイコン）をキャッシュし、
// オフラインでも生成ツールが動くようにする。戦略は stale-while-revalidate。
const CACHE = "miaq-v1";
const CORE = [
  "/",
  "/index.html",
  "/style.css",
  "/js/quote.js",
  "/js/app.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/ZenOldMincho-Regular.ttf",
  "/fonts/NotoSansJP-Regular.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // 🔒 外部オリジン（Discord CDN / 照会APIなど）はキャッシュ対象にしない
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
