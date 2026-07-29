/* ══ 外送記錄 Service Worker ══
   快取靜態資源，支援離線使用
   ══════════════════════════════ */

const CACHE_NAME = 'delivery-app-v465';

const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
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
  '/images/Check1.png',
  '/images/Check2.png',   
  '/images/Miyako.webp',
  '/images/close1.png',
  '/images/close2.png',
  '/images/close3.png',
  '/images/new-window.png',
  '/scooter/s1.png',
  '/scooter/s2.png',
  '/scooter/s3.png',
  '/scooter/s4.png',  
  '/scooter/s5.png',
  '/scooter/s6.png',
  '/scooter/s7.png',
  '/scooter/s8.png',  
  '/scooter/s9.png',  
  '/Vehicle/ve1.png',
  '/Vehicle/ve2.png',
  '/Vehicle/ve3.png',
  '/Vehicle/ve4.png'
];

/* 安裝 SW：預先快取所有靜態資源 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

/* 啟用 SW：清除舊版快取 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 攔截網路請求：智慧型快取策略 */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. 忽略非 GET 請求（如 POST 登入/註冊/資料庫寫入）
  if (event.request.method !== 'GET') return;

  // 2. 忽略後端 API 請求與第三方 API（避免快取動態資料）
  if (url.pathname.startsWith('/auth/') || 
      url.pathname.startsWith('/admin/') || 
      url.pathname.startsWith('/stats') || 
      url.pathname.startsWith('/settings/') ||
      url.hostname.includes('workers.dev') ||
      url.hostname.includes('api.ocr.space')) {
    return;
  }

  // 3. 靜態資源：帶有 ignoreSearch: true 允許帶有 ?v=1.6.0 的請求正確匹配快取，並在找不到時 fallback 到網路
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
