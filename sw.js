/* Estúdio service worker: keeps the whole app on the device so it opens without internet. */
const VERSION = "estudio-20261107-4a5913f2";
const PRECACHE = [
"./",
"beatvox/css/fonts.css",
"beatvox/css/style.css",
"beatvox/index.html",
"beatvox/js/app.js",
"beatvox/js/audio.js",
"beatvox/js/classifier.js",
"beatvox/js/dsp.js",
"beatvox/js/eq3d.js",
"beatvox/js/flow.js",
"beatvox/js/knob.js",
"beatvox/js/midi.js",
"beatvox/js/mixer.js",
"beatvox/js/pitch.js",
"beatvox/js/scene.js",
"beatvox/js/stage3d.js",
"beatvox/js/voicefx.js",
"beatvox/js/zip.js",
"beatvox/licenses/fontes-OFL.txt",
"deriva/engine.js",
"deriva/fonts/Inter-Regular.woff2",
"deriva/fonts/Inter-SemiBold.woff2",
"deriva/fonts/JetBrainsMono-Regular.woff2",
"deriva/fonts/OFL.txt",
"deriva/fonts/fonts.css",
"deriva/index.html",
"icons/icon-192.png",
"icons/icon-512.png",
"icons/maskable-512.png",
"index.html",
"manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "runtime").map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // cache first (works offline), refreshed when a new version is installed
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open("runtime").then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
