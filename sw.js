/* ══ 外送記帳 Service Worker ══
   快取靜態資源，支援離線使用
   ══════════════════════════════ */

const CACHE_NAME = 'delivery-app-v218';

// 需要快取的靜態資源清單
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
  '/images/Battery.png',  
  '/images/Gas_station.png',
  '/images/arrow_back.png',
  '/scooter/s1.png',
  '/scooter/s2.png',
  '/scooter/s3.png',
  '/scooter/s4.png',  
  '/scooter/s5.png',
  '/scooter/s6.png',
  '/scooter/s7.png',
  '/scooter/s8.png',  
  '/scooter/s9.png',  
  '/figure/1.webp',
  '/figure/2.webp',
  '/figure/3.webp',
  '/figure/4.webp',
  '/figure/5.webp',
  '/figure/6.webp',
  '/figure/7.webp',
  '/figure/8.webp',  
  '/background/bg1.webp',
  '/background/bg2.webp',
  '/background/bg3.webp',
  '/background/bg4.webp',
  '/background/bg5.webp',
  'https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Noto+Sans+TC:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
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

/* 攔截網路請求：優先從快取讀取，失敗再網路取得 */
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
