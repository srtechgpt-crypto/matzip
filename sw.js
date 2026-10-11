// 맛집지도 서비스 워커: 앱 파일만 다룬다. 카카오 지도·검색은 건드리지 않는다.
// 인터넷이 될 때는 항상 새 파일(네트워크 먼저), 안 될 때만 저장본으로 화면을 띄운다.
var CACHE = 'matzip-v1';
var FILES = ['./', 'index.html', 'style.css', 'config.js', 'search.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // 같은 github.io 주소를 다른 앱(콩콩이 등)과 같이 쓰므로 matzip- 캐시만 지운다
    return Promise.all(keys.filter(function (k) { return k.indexOf('matzip-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// 이 앱의 파일 주소만 다룬다 (같은 github.io를 쓰는 다른 앱 파일은 건드리지 않음)
var OWN = FILES.map(function (f) { return new URL(f, self.registration.scope).href; });
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  url.search = ''; url.hash = '';
  if (req.method !== 'GET' || OWN.indexOf(url.href) === -1) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true });
  }));
});
