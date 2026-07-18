/* Service Worker викторины: офлайн-кэш оболочки + команда refresh-shell.
   Механизм самообновления описан в update-mechanism-guide.md (корень репозитория).
   Ключевые решения:
   - network-first с таймаутом 3 с и фолбэком на кэш для HTML;
   - ОБА ключа оболочки ('.' и './index.html') всегда обновляются вместе (грабля №1);
   - refresh-shell подтверждает успех только ПОСЛЕ записи свежего HTML в кэш (грабля №2);
   - HEAD-запросы не перехватываются (проверка версии со страницы идёт мимо кэшей);
   - vendor-кэш CDN-скриптов — best-effort: его сбой не должен ломать установку SW. */

var SHELL_CACHE = "mcquiz-shell-v1";
var VENDOR_CACHE = "mcquiz-vendor-v1";
var VENDOR_URLS = [
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
];
var NETWORK_TIMEOUT_MS = (self.__MCQUIZ_SW_TUNE__ && self.__MCQUIZ_SW_TUNE__.timeout) || 3000;

function putShellBoth(cache, resp) {
  // Навигация обслуживается из ключа '.', прямые запросы — из './index.html'.
  // Обновлять строго оба, иначе на слабой сети перезагрузка возьмёт старый корень.
  return cache.put("./index.html", resp.clone()).then(function () {
    return cache.put(".", resp.clone());
  });
}

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return fetch("./index.html", { cache: "reload" }).then(function (resp) {
        if (!resp || resp.status !== 200) throw new Error("shell fetch failed");
        return putShellBoth(cache, resp);
      });
    }).then(function () {
      return caches.open(VENDOR_CACHE).then(function (cache) {
        return Promise.all(VENDOR_URLS.map(function (u) {
          return fetch(u).then(function (resp) {
            if (resp && (resp.status === 200 || resp.type === "opaque")) return cache.put(u, resp);
          }).catch(function () {}); // без CDN офлайн не взлетит, но установка не падает
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("mcquiz-") === 0 && k !== SHELL_CACHE && k !== VENDOR_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirstShell(request) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      settled = true;
      caches.match("./index.html").then(function (hit) {
        resolve(hit || fetch(request));
      });
    }, NETWORK_TIMEOUT_MS);
    fetch(request).then(function (resp) {
      if (resp && resp.status === 200) {
        var copy = resp.clone();
        // кладём в кэш даже припозднившийся ответ — пригодится при следующем старте
        caches.open(SHELL_CACHE).then(function (c) { putShellBoth(c, copy); });
        if (!settled) { settled = true; clearTimeout(timer); resolve(resp); }
      } else if (!settled) {
        settled = true;
        clearTimeout(timer);
        caches.match("./index.html").then(function (hit) { resolve(hit || resp); });
      }
    }).catch(function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caches.match("./index.html").then(function (hit) {
        resolve(hit || new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } }));
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return; // HEAD-проверка версии идёт мимо SW
  var url = new URL(e.request.url);
  var scopePath = new URL(self.registration.scope).pathname;
  var isShell = url.origin === self.location.origin &&
    (url.pathname === scopePath || url.pathname === scopePath + "index.html");
  if (isShell) {
    e.respondWith(networkFirstShell(e.request));
    return;
  }
  if (url.hostname === "unpkg.com") {
    e.respondWith(
      caches.match(e.request.url).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (resp) {
          if (resp && (resp.status === 200 || resp.type === "opaque")) {
            var copy = resp.clone();
            caches.open(VENDOR_CACHE).then(function (c) { c.put(e.request.url, copy); });
          }
          return resp;
        });
      })
    );
  }
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "refresh-shell") {
    var port = e.ports && e.ports[0];
    fetch("./index.html", { cache: "reload" }).then(function (resp) {
      if (!resp || resp.status !== 200) throw new Error("bad status");
      return caches.open(SHELL_CACHE).then(function (cache) {
        return putShellBoth(cache, resp); // ОБА ключа (грабля №1)
      });
    }).then(function () {
      if (port) port.postMessage({ ok: true }); // только ПОСЛЕ записи в кэш (грабля №2)
    }).catch(function () {
      if (port) port.postMessage({ ok: false });
    });
  }
});
