// 讓瀏覽器每次都先向伺服器確認網頁檔案是否有新版本（有新版就用新版，沒有就沿用暫存），
// 上傳新檔案後不必再按 Ctrl + F5 強制重新整理。
// 只處理本網站自己的檔案；Firebase、Google 登入等外部連線不經過這裡。

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// GitHub Pages 回應時會說「可暫存 10 分鐘」，瀏覽器切換頁面時就會直接沿用記憶體裡的舊檔；
// 改成「每次使用前都要先確認」，切換頁面也會拿到最新版
function noCache(res) {
  if (res.type !== "basic" && res.type !== "default") return res;
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // 網頁本身：導覽請求不能直接改快取設定，改用網址重新抓
    event.respondWith(
      fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
        .then((res) => (res.redirected ? Response.redirect(res.url, 302) : noCache(res)))
        .catch(() => fetch(req)),
    );
    return;
  }
  // 程式、樣式等檔案
  event.respondWith(fetch(new Request(req, { cache: "no-cache" })).then(noCache).catch(() => fetch(req)));
});
