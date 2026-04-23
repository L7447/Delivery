/* ══ 外送記帳 Service Worker ══
   測試版：移除 fetch handler 以排查 iOS 白屏根因
   若測試後白屏消失，表示問題出在 iOS fetch intercept bug
   ══════════════════════════════════════════════════ */

const CACHE_NAME = 'delivery-app-v93';

/* 安裝：僅快取核心檔案，不快取圖片（減少失敗機率） */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled([
        cache.add('/style.css').catch(e => console.warn('[SW] style.css 快取失敗', e)),
        cache.add('/script.js').catch(e => console.warn('[SW] script.js 快取失敗', e)),
        cache.add('/manifest.json').catch(e => console.warn('[SW] manifest.json 快取失敗', e)),
      ]);
    }).then(() => self.skipWaiting())
  );
});

/* 啟用：清除舊版快取 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ⚠️ 測試用：不加 fetch handler
   iOS Safari 在 SW 有 fetch handler 時有已知 bug，
   移除後可確認是否為根因。
   確認後再逐步加回 cache-first 邏輯。 */
