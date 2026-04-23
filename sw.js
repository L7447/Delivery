/* ══ 外送記帳 Service Worker ══
   v86 — 修復 iOS 白屏三大根因：
   1. 移除跨域 CDN 資源（防止 install 失敗）
   2. HTML 改用 network-first（確保動畫更新立即生效）
   3. 靜態資源用 cache-first（圖片/CSS/JS 快速載入）
   ══════════════════════════════════════════════════ */

const CACHE_NAME = 'delivery-app-v87';

/* ── 只快取本地靜態資源 ──────────────────────────────
   ⚠️ 跨域 CDN URL（Google Fonts、Chart.js）絕對不能放這裡：
      cache.addAll() 對 opaque response 會拋出例外，
      導致整個 install 失敗，舊 SW 繼續返回舊版頁面。
   ──────────────────────────────────────────────── */
const STATIC_ASSETS = [
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/images/home1.png',
  '/images/home2.png',
  '/images/history1.png',
  '/images/history2.png',
  '/images/add-record1.png',
  '/images/add-record2.png',
  '/images/report1.png',
  '/images/report2.png',
  '/images/settings1.png',
  '/images/settings2.png',
  '/images/scooter1.png',
  '/images/scooter2.png',
  '/images/calendar.png',
  '/images/scooter.png',
  '/images/scooter4.png',
  '/images/scooter5.png',
  '/images/scooter6.png',
  '/images/scooter7.png',
  '/images/scooter8.png',
  '/images/scooter9.png',
  '/images/scooter10.png',
  '/images/scooter11.png',
  '/images/scooter12.png',
  '/images/scooter13.png',
  '/images/scooter14.png',
  '/images/Check1.png',
  '/images/Check2.png',
  '/images/xwiyxw.png',
];

/* ── 安裝 SW：只快取本地資源，單筆失敗不影響整體 ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 逐一加入，任何一個失敗不會中止整個安裝
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] 快取失敗，略過：', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── 啟用 SW：清除舊版快取 ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── 攔截請求：根據資源類型選擇策略 ─────────────────
   HTML 文件（導覽請求）→ Network First
     優先從網路取得最新版，網路失敗才用快取。
     這確保每次 index.html 更新後，使用者立刻拿到新版。

   靜態資源（CSS / JS / 圖片）→ Cache First
     優先從快取讀取，加快載入速度，快取失敗再請求網路。

   跨域請求（CDN / Google Fonts）→ 直接放行，不攔截。
   ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理 http/https，忽略 chrome-extension 等
  if (!url.protocol.startsWith('http')) return;

  // 跨域請求（CDN、Google Fonts）直接放行，不干預
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML 導覽請求（開啟 PWA 時的主文件）→ Network First
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // 成功取得最新版：更新快取並回傳
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // 網路失敗：回傳快取版本（離線支援）
          return caches.match(request).then(cached => cached || caches.match('/index.html'));
        })
    );
    return;
  }

  // 靜態資源 → Cache First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
