/* ══════════════════════════════════════════════════════
   外送記錄 App — script.js
   設計：由上到下分區註解，結構清晰，不閃爍，功能完整
   ══════════════════════════════════════════════════════ */

/* ══ 1. 共用工具函式與狀態 開始 ══════════════════════════════ */
const KEYS = { records: 'delivery_records', platforms: 'delivery_platforms', settings: 'delivery_settings', punch: 'delivery_punch_live', vehicles: 'delivery_vehicles', vehicleRecs: 'delivery_vehicle_recs' };
const DEFAULT_PLATFORMS =[
  { id:'uber', name:'Uber Eats', color:'#008000', active:false, ruleDesc:'每週一、四結算｜每週四發薪' },
  { id:'foodpanda', name:'foodpanda', color:'#D70F64', active:false, ruleDesc:'雙週日結算｜結算後週三寄明細｜再隔週三發薪' },
  { id:'foodomo', name:'foodomo', color:'#ff0000', active:false, ruleDesc:'每月15及月底結算｜每月5及20發薪' },
];

function normalizePlatforms(rawPlatforms) {
  if (!Array.isArray(rawPlatforms)) return DEFAULT_PLATFORMS.map(p => ({ ...p }));
  return DEFAULT_PLATFORMS.map(dp => {
    const sp = rawPlatforms.find(s => s.id === dp.id) || {};
    const active = sp.active === true || sp.active === 'true';
    return {
      id: dp.id,
      name: dp.name,
      color: typeof sp.color === 'string' && sp.color.trim() ? sp.color : dp.color,
      active,
      ruleDesc: dp.ruleDesc
    };
  });
}

/* ====================== XSS 防護：HTML 轉義函式 ====================== */
function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* 如果需要支援簡單換行，可以用這個安全版本 */
function escapeHtmlWithBr(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function safeText(value) {
  return escapeHtml(value);
}

function safeTextWithBr(value) {
  return escapeHtmlWithBr(value);
}

/* ====================== IndexedDB 儲存協助函式 ====================== */
const DB_NAME = 'delivery_records_db';
const DB_VERSION = 1;
const DB_STORES = ['records', 'vehicleRecs'];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      DB_STORES.forEach(storeName => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get('payload');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

function idbSet(storeName, value) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).put(value, 'payload');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

function idbDelete(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).delete('payload');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}


const DEFAULT_SETTINGS = { 
  goals: { weekly: 0, monthly: 0, yearly: 0 }, 
  rewards:[
    // 內建熊貓預設獎勵 (加入 recurringDays 陣列判斷星期幾)
    { id: 'fp_m_w', name: '週一至三獎勵', platformId: 'foodpanda', recurring: true, recurringDays: [1,2,3], tiers:[{orders:40, amount:150}, {orders:80, amount:450}, {orders:120, amount:1300}, {orders:150, amount:2000}] },
    { id: 'fp_t_s', name: '週四至六獎勵', platformId: 'foodpanda', recurring: true, recurringDays: [4,5,6], tiers:[{orders:40, amount:150}, {orders:80, amount:450}, {orders:120, amount:1300}, {orders:150, amount:2000}] },
    { id: 'fp_sun', name: '週日獎勵', platformId: 'foodpanda', recurring: true, recurringDays: [0], tiers:[{orders:15, amount:75}, {orders:24, amount:150}, {orders:35, amount:350}, {orders:45, amount:500}] }
  ], 
  shopHistory:[],
  autoBackup: false,
  // ✨ 新增提醒設定
  reminder: { enabled: false, time: '22:00', lastSent: '' } 
};

// 帳號登入系統狀態
// 替換原本的 USER 宣告
let USER = JSON.parse(localStorage.getItem('delivery_user') || '{"email":null,"verified":false,"loggedIn":false,"joinDate":null,"token":null,"role":"user"}');
function saveUser() { localStorage.setItem('delivery_user', JSON.stringify(USER)); }

// 模擬後端資料庫：儲存所有註冊的帳號資訊以供統計
let DB_USERS = JSON.parse(localStorage.getItem('delivery_db_users') || '[]');
function saveDbUsers() { localStorage.setItem('delivery_db_users', JSON.stringify(DB_USERS)); }

// 暫存驗證碼
let tempAuthCode = '';

const S = {
  tab: 'home', rptY: new Date().getFullYear(), rptM: new Date().getMonth()+1, rptView: 'overview',
  calY: new Date().getFullYear(), calM: new Date().getMonth()+1, selDate: todayStr(),
  records: [], platforms: [], settings: { ...DEFAULT_SETTINGS }, punch: null,
  vehicles: [], vehicleRecs: [], editingId: null, selPlatformId: null, charts: {},
  homeSubTab: 'schedule', vehicleTab: 'fuel', newVehIcon: 4, newVehColor: '#555555',
  selVehicleId: null, vehY: new Date().getFullYear(), vehM: new Date().getMonth()+1, addVehRecType: 'fuel',
  rptOverviewFilter: 'all', cmpType: 'month', cmpPeriods: [],
  histFullCalY: new Date().getFullYear(), histFullCalM: new Date().getMonth()+1
};

// 讓 todayStr 支援傳入自訂日期物件
function todayStr(dObj) { 
  const d = dObj || new Date(); 
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; 
}
function nowTime() { return new Date().toTimeString().slice(0,5); }
const fmt = n => Number(n||0).toLocaleString('zh-TW', { minimumFractionDigits:0 });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const pad = n => String(n).padStart(2,'0');
const pf = v => parseFloat(v)||0;
const getPlatform = id => S.platforms.find(p=>p.id===id)||{name:'未知',color:'#999'};
const getDayRecs = date => S.records.filter(r=>r.date===date);
const getMonthRecs = (y,m) => { const prefix = `${y}-${pad(m)}`; return S.records.filter(r => r.date && r.date.startsWith(prefix)); };
const recTotal = r => r.isCashTip ? 0 : (pf(r.income)+pf(r.bonus)+pf(r.tempBonus)+pf(r.tips));

function fmtHours(hVal) {
  const h = pf(hVal); if (h <= 0) return '0';
  const totalMins = Math.round(h * 60);
  const hrs = Math.floor(totalMins / 60); const mins = totalMins % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0 && mins === 0) return `${hrs}h`;
  return `${mins}m`;
}

function toast(msg, ms=2200) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), ms);
}

/* ══ 智慧型進度條動畫 (支援儲存與載入) ══ */
/* ══ 執行多段式漸進進度條動畫 ══ */
let progressInterval = null;
let isSimulatingProgress = false;

function showProgress(text, isSlow = false) {
  const ov = document.getElementById('progress-overlay');
  const fill = document.getElementById('big-progress-fill');
  const txt = document.getElementById('big-progress-text');
  
  txt.textContent = text;
  fill.style.transition = 'width 0.2s ease'; 
  fill.style.width = '0%';
  ov.classList.add('show');
  
  let currentPct = 0;
  clearInterval(progressInterval);
  
  // 若設定為 isSlow (如油價載入)，則每 300ms 增加 2%，達成非常緩慢的效果
  const step = isSlow ? 2 : 5;
  const intervalMs = isSlow ? 300 : 150;
  const maxPct = isSlow ? 95 : 85;

  progressInterval = setInterval(() => {
    if (currentPct < maxPct) {
      currentPct += step;
      fill.style.width = currentPct + '%';
    }
  }, intervalMs);
  
  isSimulatingProgress = true;
}

function finishProgress(callback) {
  clearInterval(progressInterval); // 停止定時器
  const ov = document.getElementById('progress-overlay');
  const fill = document.getElementById('big-progress-fill');
  
  if (!isSimulatingProgress) {
    if (callback) callback();
    return;
  }
  
  // 瞬間衝向 100%
  fill.style.transition = 'width 0.4s ease-out';
  fill.style.width = '100%';
  
  // 動畫結束後隱藏
  setTimeout(() => {
    ov.classList.remove('show');
    isSimulatingProgress = false;
    if (callback) callback();
  }, 450); 
}

// 保留給舊的儲存流程呼叫
function runSaveProgress(callback) {
  showProgress('資料儲存中...');
  setTimeout(() => { finishProgress(callback); }, 500); 
}

function customConfirm(msg) {
  return new Promise(resolve => {
    const ov = document.getElementById('confirm-overlay');
    document.getElementById('confirm-msg').innerHTML = msg; ov.classList.add('show');
    const ok = document.getElementById('confirm-ok-btn'); const cancel = document.getElementById('confirm-cancel-btn');
    function done(v) { ov.classList.remove('show'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); resolve(v); }
    function onOk() { done(true); } function onCancel() { done(false); }
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel);
    ov.addEventListener('click', e=>{ if(e.target===ov) done(false); }, {once:true});
  });
}
function openOverlay(id)  { document.getElementById(id)?.classList.add('show'); }
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  if (id === 'sub-page') {
    el.style.zIndex = '';
  }
}
function closeDetailOverlay() { document.getElementById('detail-overlay').classList.remove('show'); }

/* 退出按鈕點擊動畫：換圖、延遲 1.5 秒後執行動作 */
function animateClose(btn, action) {
  const img = btn.querySelector('img');
  if (!img) { action(); return; }
  img.src = 'images/close2.png';
  btn.style.pointerEvents = 'none'; // 鎖定按鈕防止連點
  setTimeout(() => {
    action();
    img.src = 'images/close1.png'; // 恢復原狀以供下次開啟
    btn.style.pointerEvents = 'auto';
  }, 400);
}

function toggleSummaryCard(id) {
  const el = document.getElementById(id); const btn = document.getElementById(id + '-btn'); if (!el || !btn) return;
  const t = btn.style.transform || 'rotate(0deg)';
  if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { 
    el.style.maxHeight = el.scrollHeight + 'px'; 
    btn.style.transform = t.includes('rotate') ? t.replace('rotate(0deg)', 'rotate(180deg)') : t + ' rotate(180deg)';
  } else { 
    el.style.maxHeight = '0px'; 
    btn.style.transform = t.replace('rotate(180deg)', 'rotate(0deg)'); 
  }
}

/* ══ 替換：產生總結卡片 (統一版面、加入淨行程佔比、以及基本工資判斷) ══ */
function buildSummaryCard(title, total, orders, hours, bonus, tempBonus, tips, cardId) {
  if (total <= 0) return '';
  const totalBonus = bonus + tempBonus; 
  const income = total - totalBonus - tips; // 算出淨行程
  
  // 計算佔比
  const incPct = total > 0 ? Math.round((income / total) * 100) : 0;
  const bonPct = total > 0 ? Math.round((totalBonus / total) * 100) : 0;
  const tipPct = total > 0 ? Math.round((tips / total) * 100) : 0;

  let tagsHtml = '';
  if (orders > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${fmt(orders)} 單</span>`;
  if (hours > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${fmtHours(hours)}</span>`;

  const avgOrd = orders > 0 ? Math.round(total / orders) : 0;
  const ordHr = hours > 0 ? (orders / hours).toFixed(1) : 0;
  const avgHr = hours > 0 ? Math.round(total / hours) : 0;

  // 👇 基本工資分析邏輯 (收入為 0 時不顯示)
  let wageHtml = '';
  if (hours > 0 && total > 0) {
    let wageStatus = ''; let wageColor = ''; let wageBg = '';
    if (avgHr <= 154) { wageStatus = ' 😭 嚴重低於基本工資 '; wageColor = 'var(--red)'; wageBg = 'var(--red-d)'; } 
    else if (avgHr <= 175) { wageStatus = ' ⚠️⚠️ 低於基本工資 '; wageColor = 'var(--acc2)'; wageBg = 'var(--acc-d)'; } 
    else if (avgHr <= 195) { wageStatus = ' ⚠️ 略低於基本工資 '; wageColor = 'var(--blue)'; wageBg = 'var(--blue-d)'; } 
    else { wageStatus = ' 🎉 符合基本工資 '; wageColor = 'var(--green)'; wageBg = 'var(--green-d)'; }
    
    wageHtml = `<div style="margin-top:6px;"><span style="background:${wageBg}; color:${wageColor}; font-size:11px; padding:4px 6px; border-radius:5px; font-weight:800; letter-spacing:0px; white-space:nowrap; display:inline-block; line-height:1;">${wageStatus}</span></div>`;
  }

  return `
    <div class="hist-rec-card" style="border: 1.5px solid #708090; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
      <div class="hrc-top" onclick="foldCard('${cardId}', event)">
        <div class="hrc-toggle" id="${cardId}-btn">▼</div>
        <div class="hrc-row1">
          <span class="hrc-plat-tag" style="background:var(--t2);">${title}</span>
        </div>
        <div class="hrc-row2">
          <span class="hrc-amt" style="color:var(--text-blue);">$ ${fmt(total)}</span>
          ${tagsHtml}
        </div>
        
        <!-- 總計、當日卡片。新增：淨行程、獎勵、小費佔比結構 (百分比與金額同排) -->
        <div style="display:flex; justify-content:center; gap:6px; margin-top:3px; flex-wrap:wrap; text-align:center;">
          <div style="flex:1; background: rgba(34, 197, 94, 0.15); color: var(--green); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            淨行程<br>
            <span style="color: #1f9c4d; font-size:15px; font-weight:800;">$ ${fmt(income)}</span>
            <span style="font-size:11px; opacity:0.75; font-weight:600;">(${incPct}%)</span>
          </div>
          <div style="flex:1; background: rgba(245,158,11,0.15); color: hsl(25, 100%, 59%); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            獎勵<br>
            <span style="color: #ff7715; font-size:15px; font-weight:800;">$ ${fmt(totalBonus)}</span>
            <span style="font-size:11px; font-weight:600;">(${bonPct}%)</span>
          </div>
          <div style="flex:1; background: rgba(190, 59, 246, 0.15); color: rgba(137, 43, 226, 0.9); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            小費<br>
            <span style="color: #8A2BE2; font-size:15px; font-weight:800;">$ ${fmt(tips)}</span>
            <span style="font-size:11px; opacity:0.75; font-weight:600;">(${tipPct}%)</span>
          </div>
        </div>

      </div>
      <div id="${cardId}" class="hrc-collapse" style="background: #ffffff; overflow:hidden; transition:max-height 0.3s ease;">
        <div style="border-top:3px dashed #778899; margin-bottom:3px;"></div>
        <!-- 👉 修改點：將 align-items 設為 flex-start 讓上方文字對齊，容納下方的基本工資標籤 -->
        <div style="padding:12px 3px 8px 3px; display:flex; justify-content:center; align-items:flex-start; font-size:12px; font-weight:700; color: #000000; width:100%;">
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            一單： <span style="font-family:var(--mono); color: var(--text-cyan); font-size:18px; font-weight:800;">$ ${fmt(avgOrd)}</span>
          </div>
          <div class="h-div" style="height:35px; align-self:center;"></div>
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            1 h： <span style="font-family:var(--mono); color: var(--text-red); font-size:18px; font-weight:800;">${ordHr} <small style="color: rgb(185, 56, 255);font-size:11px; font-weight:500;">單</small></span>
          </div>
          <div class="h-div" style="height:35px; align-self:center;"></div>
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            時薪： <span style="font-family:var(--mono); color: var(--text-blue); font-size:18px; font-weight:800;">$${fmt(avgHr)}</span>
            ${wageHtml} <!-- 👈 將標籤放進時薪的正下方 -->
          </div>
        </div>
      </div>
    </div>`;
}

// 修復：計算平台日程表的函式
function calcNextDates(id) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const events = [];

  function addEv(name, targetDate) {
    const d = new Date(targetDate); d.setHours(0,0,0,0);
    const diff = Math.round((d - today) / 86400000);
    if (diff >= 0 && diff <= 14) {
      events.push({
        name, 
        dateStr: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`, 
        diff, 
        diffStr: diff === 0 ? '今天' : diff === 1 ? '明天' : `${diff}天後`,
        ts: d.getTime()
      });
    }
  }

  if (id === 'uber') {
    for(let i=0; i<=14; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let dw = d.getDay();
      if (dw === 1) addEv('結算', d);
      if (dw === 4) { addEv('結算', d); addEv('發薪', d); }
    }
  } else if (id === 'foodpanda') {
    // 根據最新班表，以 2023年12月24日 (雙週循環的週日結算日) 為絕對基準日
    const anchor = new Date(2023, 11, 24); 
    for(let i=0; i<=14; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let diffDays = Math.round((d - anchor) / 86400000);
      
      // 結算日：每 14 天的週期結尾 (週日)
      if (diffDays % 14 === 0) addEv('取單率結算', d);
      // 明細寄發日：結算後 3 天 (週三)
      if ((diffDays - 3) % 14 === 0) addEv('明細寄發', d);
      // 報酬發放日：結算後 10 天 (下週三)
      if ((diffDays - 10) % 14 === 0) addEv('發薪', d);
    }
  } else if (id === 'foodomo') {
    for(let i=0; i<=31; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let dt = d.getDate();
      let isLastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === dt;
      if (dt === 15 || isLastDay) addEv('結算', d);
      if (dt === 5 || dt === 20) addEv('發薪', d);
    }
  }

  const uniqueEvents = [];
  const seen = new Set();
  events.sort((a,b) => a.ts - b.ts).forEach(e => {
    const key = `${e.name}-${e.dateStr}`;
    if(!seen.has(key)) { seen.add(key); uniqueEvents.push(e); }
  });
  return uniqueEvents.slice(0, 3);
}

/* ══ 加密版 loadAll() ═══════════════════════════════════════════════ */
async function loadAll() {
  try {
    const storedRecords = await idbGet('records');
    if (Array.isArray(storedRecords)) {
      S.records = storedRecords;
    } else {
      const localRecords = JSON.parse(localStorage.getItem(KEYS.records) || '[]');
      S.records = Array.isArray(localRecords) ? localRecords : [];
      if (Array.isArray(S.records)) await idbSet('records', S.records);
    }
  } catch (e) {
    console.warn('IndexedDB records 讀取失敗，使用空陣列', e);
    S.records = [];
  }

  try {
    // 讀取 Platforms（這類不敏感資料可保持明文）
    const savedPlatforms = localStorage.getItem(KEYS.platforms);
    if (savedPlatforms) {
      const parsed = JSON.parse(savedPlatforms);
      S.platforms = normalizePlatforms(parsed);
    } else {
      S.platforms = normalizePlatforms([]);
    }
  } catch (e) {
    console.warn('Platforms data invalid, using defaults', e);
    S.platforms = normalizePlatforms([]);
  }

  try {
    const savedSettings = localStorage.getItem(KEYS.settings);
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      S.settings = { ...DEFAULT_SETTINGS, shopHistory: [], ...parsed };
    } else {
      S.settings = { ...DEFAULT_SETTINGS, shopHistory: [] };
    }
  } catch (e) {
    console.warn('Settings 讀取失敗，使用預設值', e);
    S.settings = { ...DEFAULT_SETTINGS, shopHistory: [] };
  }

  try {
    S.punch = JSON.parse(localStorage.getItem(KEYS.punch) || 'null');
  } catch { S.punch = null; }

  try {
    const savedVehicles = localStorage.getItem(KEYS.vehicles);
    if (savedVehicles) {
      S.vehicles = JSON.parse(savedVehicles);
    } else {
      S.vehicles = [];
    }
  } catch (e) {
    console.warn('Vehicles 讀取失敗', e);
    S.vehicles = [];
  }

  try {
    const storedVehRecs = await idbGet('vehicleRecs');
    if (Array.isArray(storedVehRecs)) {
      S.vehicleRecs = storedVehRecs;
    } else {
      const localVehRecs = JSON.parse(localStorage.getItem(KEYS.vehicleRecs) || '[]');
      S.vehicleRecs = Array.isArray(localVehRecs) ? localVehRecs : [];
      if (Array.isArray(S.vehicleRecs)) await idbSet('vehicleRecs', S.vehicleRecs);
    }
  } catch (e) {
    console.warn('IndexedDB vehicleRecs 讀取失敗，使用空陣列', e);
    S.vehicleRecs = [];
  }
}

/* 替換原本的 saveRecords 等儲存函式 */
function performAutoBackup() {
  if (S.settings.autoBackup && USER.loggedIn) {
    const backupData = { records: S.records, vehicles: S.vehicles, vehicleRecs: S.vehicleRecs };
    localStorage.setItem('delivery_local_backup', JSON.stringify(backupData));
    
    // 記錄當下備份時間
    const now = new Date();
    S.settings.lastBackup = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    localStorage.setItem(KEYS.settings, JSON.stringify(S.settings));
  }
}

/* ══ 加密版儲存函式 ═══════════════════════════════════════════════ */
async function saveRecords() {
  try {
    await idbSet('records', S.records);
  } catch (e) {
    console.error('IndexedDB 儲存 records 失敗', e);
  }
}
function saveSettings() {
  try {
    localStorage.setItem(KEYS.settings, JSON.stringify(S.settings));
  } catch (e) {
    console.error('儲存 settings 失敗', e);
  }
}
function saveVehicles() {
  try {
    localStorage.setItem(KEYS.vehicles, JSON.stringify(S.vehicles));
  } catch (e) {
    console.error('儲存 vehicles 失敗', e);
  }
}
async function saveVehicleRecs() {
  try {
    await idbSet('vehicleRecs', S.vehicleRecs);
  } catch (e) {
    console.error('IndexedDB 儲存 vehicleRecs 失敗', e);
  }
}
// Platforms 不敏感，保持原本明文儲存
function savePlatforms() {
  localStorage.setItem(KEYS.platforms, JSON.stringify(S.platforms));
}
function savePunch() {
  localStorage.setItem(KEYS.punch, JSON.stringify(S.punch));
}

function goPage(name) {
  S.tab = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni[data-pg]').forEach(n => {
    const isActive = n.dataset.pg === name;
    n.classList.toggle('active', isActive);
    const img = n.querySelector('.ni-img'); if (img) img.src = isActive ? n.dataset.img2 : n.dataset.img1;
  });
  document.getElementById(`page-${name}`)?.classList.add('active');
  document.body.setAttribute('data-tab', name);
  updateNavIndicator(name);
  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'report')   renderReport();
  if (name === 'vehicles') renderVehicles(); 
  if (name === 'settings') renderSettings();
}

/* ══ 底部導覽列滑動指示條 (強化復歸機制) ══ */
function updateNavIndicator(activePg) {
  const indicator = document.getElementById('nav-indicator');
  const activeEl = document.querySelector(`.ni[data-pg="${activePg}"]`);
  const nav = document.getElementById('nav');
  
  if (!indicator || !activeEl || !nav) return;
  
  // 如果導覽列寬度還是 0 (代表被隱藏或還沒畫出來)，延遲 50 毫秒再試一次
  if (nav.offsetWidth === 0) {
    setTimeout(() => updateNavIndicator(activePg), 50);
    return;
  }
  
  const navRect = nav.getBoundingClientRect();
  const itemRect = activeEl.getBoundingClientRect();
  
  // 計算置中位移
  const offsetX = itemRect.left - navRect.left + (activeEl.offsetWidth - indicator.offsetWidth) / 2;
  indicator.style.transform = `translateY(-50%) translateX(${offsetX}px)`;
}
/* 替換導覽列切換邏輯，未登入禁止進入新增頁面 */
function _bindNavEvents() {
  document.querySelectorAll('.ni[data-pg]').forEach(el => el.addEventListener('click', () => { 
    const pg = el.dataset.pg; 
    if (pg === 'add') {
      if (!USER.loggedIn) { toast('⚠️ 請先登入帳號才能新增記錄'); return; }
      if (S.tab !== 'add') openAddPage(); 
    } else {
      goPage(pg); 
    }
  }));
}

function switchHomeTab(tab, index) { S.homeSubTab = tab; document.getElementById('home-tab-bg').style.transform = `translateX(${index * 100}%)`; document.getElementById('btn-home-schedule').classList.toggle('active', tab==='schedule'); document.getElementById('btn-home-goal').classList.toggle('active', tab==='goal'); renderHome(); }
function switchHistTab(tab, index) { S.histTab = tab; S.histNavDate = new Date(); document.getElementById('hist-tab-bg').style.transform = `translateX(${index * 100}%)`; document.querySelectorAll('#page-history .slide-btn').forEach((btn, i) => btn.classList.toggle('active', i === index)); renderHistory(); }
function switchRptTab(tab, index, btnEl) { S.rptView = tab; document.getElementById('rpt-tab-bg').style.transform = `translateX(${index * 100}%)`; document.querySelectorAll('#rpt-tabs .slide-btn').forEach(btn => btn.classList.remove('active')); btnEl.classList.add('active');['overview','rewards','trend','compare','top3'].forEach(v => { document.getElementById(`rv-${v}`).style.display = v===S.rptView ? '' : 'none'; }); renderReport(); }
/* ══ 替換：車輛頁籤切換 (維持紫色風格) ══ */
function switchVehicleTab(tab, index) { 
  S.vehicleTab = tab; 
  const tabBg = document.getElementById('veh-tab-bg');
  tabBg.style.transform = `translateX(${index * 100}%)`; 
  
  const colors = {
    fuel: { bg: 'linear-gradient(135deg, #3b82f6, #2563eb)', shadow: 'rgba(59,130,246,0.4)', textId: 'btn-veh-fuel' },
    maintenance: { bg: 'linear-gradient(135deg, #065f46, #10b981)', shadow: 'rgba(16,185,129,0.4)', textId: 'btn-veh-maint' },
    yearly: { bg: 'linear-gradient(135deg, #f59e0b, #d97706)', shadow: 'rgba(245,158,11,0.4)', textId: 'btn-veh-yearly' },
    search: { bg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', shadow: 'rgba(139,92,246,0.4)', textId: 'btn-veh-search' }
  };

  tabBg.style.background = colors[tab].bg; 
  tabBg.style.boxShadow = `0 4px 10px ${colors[tab].shadow}`;

  ['fuel', 'maintenance', 'yearly', 'search'].forEach(t => {
    document.getElementById(colors[t].textId).style.color = (t === tab) ? '#fff' : 'var(--t2)';
    document.getElementById(colors[t].textId).classList.toggle('active', t === tab);
  });
  
  // 更新上方的時間標籤 (年總覽/搜尋只顯示年份)
  document.getElementById('veh-month-label').textContent = (tab === 'yearly' || tab === 'search') ? `${S.vehY} 年 全年` : `${S.vehY} 年 ${S.vehM} 月`;

  renderVehicleContent(); 
}
/* ══ 1. 共用工具函式與狀態 結束 ══════════════════════════════ */

/* ══ 2. 首頁 開始 ══════════════════════════════════════════ */
/* ══ 首頁渲染 (終極防錯亂保護版) ══ */
function renderHome() {
  const topEl = document.getElementById('home-top-content');
  const botEl = document.getElementById('home-bottom-content');
  const tabBg = document.getElementById('home-tab-bg');
  
  // 1. 防護：確保 DOM 元素存在才執行
  if (!topEl || !botEl) return;
  if (!S.homeSubTab) S.homeSubTab = 'schedule';
  if (tabBg) tabBg.style.transform = S.homeSubTab === 'schedule' ? 'translateX(0%)' : 'translateX(100%)';

  try {
    const today = todayStr();
    const dayRecs = getDayRecs(today) || [];
    
    const total   = dayRecs.reduce((s, r) => s + recTotal(r), 0);
    const orders  = dayRecs.reduce((s, r) => s + pf(r.orders), 0);
    const hours   = dayRecs.filter(r => !r.isPunchOnly).reduce((s, r) => s + pf(r.hours), 0);
    
    const dateObj = new Date(today + 'T00:00:00');
    const dow     = ['日','一','二','三','四','五','六'][dateObj.getDay() || 0];
    const activePlatforms = (S.platforms || []).filter(p => p.active);

    let topHtml = `<div style="padding:16px 16px 0; flex-shrink:0;">`;

    // 公告系統
    try {
      const ann = JSON.parse(localStorage.getItem('delivery_global_announcement') || '{"active":false,"text":""}');
      const dismissedAnn = localStorage.getItem('delivery_dismissed_ann'); 
      if (ann.active && ann.text && ann.text !== dismissedAnn) {
        const safeText = encodeURIComponent(ann.text); 
        topHtml += `
          <div id="home-announcement-card" style="position:relative; background:linear-gradient(135deg, var(--acc), var(--acc2)); color:#fff; padding:12px 16px; border-radius:16px; margin-bottom:16px; box-shadow:0 4px 12px rgba(255,107,53,0.3); display:flex; gap:10px; align-items:flex-start; transition:0.3s;">
            <button onclick="dismissAnnouncement('${safeText}')" style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.15); border:none; color:#fff; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; transition:0.2s;">✕</button>
            <span style="font-size:20px;">📢</span>
            <div style="font-size:13px; font-weight:600; line-height:1.5; padding-right:18px;">${safeTextWithBr(ann.text)}</div>
          </div>`;
      }
    } catch(e) {}

    // 今日概況標題
    topHtml += `
      <div class="home-header" style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px;">
        <div class="home-pg-title" style="font-family:var(--title); font-size:24px; font-weight:700; color:var(--t1); line-height:1.2;">今日概況</div>
        <div class="home-pg-date" style="font-size:13px; color:var(--t2); font-weight:500; background:var(--sf); padding:6px 12px; border-radius:20px; border:1px solid var(--border); box-shadow:0 2px 6px rgba(0,0,0,0.03);">
          <b>${dateObj.getFullYear()}</b> 年 <b>${dateObj.getMonth()+1}</b> 月 <b>${dateObj.getDate()}</b> 日 星期 <b>${dow}</b>
        </div>
      </div>
      <div class="today-hero">`;

    // 平台各別統計
    if (activePlatforms.length > 0) {
      const platStats = activePlatforms.map(p => {
        const recs = dayRecs.filter(r => r.platformId === p.id);
        return { ...p, sum: recs.reduce((s, r) => s + recTotal(r), 0), orders: recs.reduce((s, r) => s + pf(r.orders), 0), hours: recs.reduce((s, r) => s + pf(r.hours), 0) };
      }).filter(p => p.sum > 0 || p.orders > 0 || p.hours > 0);

      if (platStats.length > 0) {
        topHtml += `<div style="background:var(--sf); padding:5px; border-radius:25px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(0,0,0,0.03); display:flex; flex-direction:column; gap:4px;">`;
        platStats.forEach(p => {
          topHtml += `
            <div class="hero-plat-row" style="display:flex; align-items:center; padding:12px 14px; border-radius:20px; font-size:13px; font-weight:600; background:linear-gradient(135deg, ${p.color}15, ${p.color}30); border: 1px solid ${p.color}60; color: var(--t1);">
              <span class="hp-name" style="width:35%; white-space:nowrap;">${safeText(p.name)}收入：</span>
              <span class="hp-sum" style="font-family:var(--mono); font-weight:800; width:25%; text-align:right; color:${p.color};">$ ${fmt(p.sum)}</span>
              <span class="hp-ord" style="font-weight:600; width:20%; text-align:right;">${p.orders} 單</span>
              <span class="hp-hrs" style="font-weight:600; width:20%; text-align:right; opacity:0.8;">${p.hours > 0 ? fmtHours(p.hours) : 0}</span>
            </div>`;
        });
        topHtml += `</div>`;
      } else {
        topHtml += `<div style="text-align:center; font-size:13px; color:var(--t3); margin:12px 0;">今日尚未有收入資料</div>`;
      }
    } else {
      topHtml += `<div style="text-align:center; font-size:13px; color:var(--t3); margin:12px 0;">尚未啟用平台</div>`;
    }

    // 總計卡片
    const dayBonus = dayRecs.reduce((s,r)=>s+pf(r.bonus), 0);
    const dayTemp  = dayRecs.reduce((s,r)=>s+pf(r.tempBonus), 0);
    const dayTips  = dayRecs.reduce((s,r)=>s+pf(r.tips), 0);
    topHtml += buildSummaryCard('總計', total, orders, hours, dayBonus, dayTemp, dayTips, 'home-summary-card');
    topHtml += `</div>`;

    // 打卡模組
    const isPunched = S.punch && S.punch.date === todayStr();
    let punchStatusStr = '離線';
    if (isPunched && S.punch && typeof S.punch.startTime === 'string') {
      const startParts = S.punch.startTime.split(':');
      if (startParts.length >= 2) {
        const startMs = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), parseInt(startParts[0]||0), parseInt(startParts[1]||0)).getTime();
        const diffMin = Math.floor((Date.now() - startMs) / 60000);
        punchStatusStr = `上線中 (${Math.floor(diffMin/60)}h${diffMin%60}m)`;
      }
    }
    topHtml += `
      <div class="punch-card-new" style="background:var(--sf); border:1px solid var(--border); border-radius:20px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; margin:8px 0; box-shadow:0 8px 20px rgba(0,0,0,0.03);">
        <div class="punch-status-left" style="display:flex; align-items:center; gap:10px; font-size:15px; font-weight:700;">
          <div class="punch-dot-new ${isPunched ? 'online' : ''}"></div>
          <span style="color:${isPunched ? 'var(--green)' : 'var(--t3)'}">${punchStatusStr}</span>
        </div>
        <button class="punch-btn-right ${isPunched ? 'btn-go-offline' : 'btn-go-online'}" onclick="${isPunched ? 'punchOut()' : 'punchIn()'}">
          ${isPunched ? '⏹ 下線打卡' : '▶ 上線打卡'}
        </button>
      </div></div>`;

    // 底部內容 (平台排程 / 目標進度)
    let bottomHtml = '';
    if (S.homeSubTab === 'schedule') {
      if (activePlatforms.length === 0) {
        bottomHtml += `<div class="empty-tip">請先至「設定」頁，啟用平台</div>`;
      } else {
        bottomHtml += `<div style="background:var(--sf); padding:5px; border-radius:25px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(0,0,0,0.03); display:flex; flex-direction:column; gap:4px;">`;
        activePlatforms.forEach(p => {
          const events = calcNextDates(p.id); 
          if (!events) return;
          bottomHtml += `
            <div style="border: 2px solid ${p.color}; background: ${p.color}35; border-radius: 20px; padding: 12px 10px; margin-bottom: 2px;">
              <div style="display:flex; align-items:center; margin-bottom: 10px;">
                <span style="background:${p.color}; color:#fff; font-size:12px; font-weight:800; padding:4px 12px; border-radius:12px; letter-spacing:0.5px; box-shadow:0 2px 6px ${p.color}60;">${safeText(p.name)}</span>
              </div>
              <div style="display:flex; gap:6px;">${events.map(ev => {
                const isToday = ev.diff === 0;
                let diffColor = isToday ? 'var(--green)' : 'var(--t2)';
                let nameColor = 'var(--t3)'; let borderColor = 'var(--border)';
                if (ev.name.includes('結算') || ev.name.includes('取單')) { nameColor = 'var(--red)'; borderColor = 'var(--red)'; }
                else if (ev.name.includes('明細')) { nameColor = 'var(--acc2)'; borderColor = 'var(--acc2)'; }
                else if (ev.name.includes('發薪')) { nameColor = '#00BFFF'; borderColor = '#00BFFF'; }
                if (!isToday && (ev.name.includes('結算') || ev.name.includes('發薪') || ev.name.includes('明細') || ev.name.includes('取單'))) diffColor = '#22C55E';
                return `
                  <div class="schedule-event-card" style="flex:1; background: var(--schedule-bg); border: 2.5px solid ${borderColor}; border-radius: 16px; padding: 8px 4px; text-align: center; display:flex; flex-direction:column; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                    <span style="font-size:13px; color:${nameColor}; font-weight:500; margin-bottom:4px; letter-spacing:0.5px;">${safeText(ev.name)}</span>
                    <span style="font-family:var(--mono); font-size:14px; font-weight:800; color:var(--chart-text);">${safeText(ev.dateStr)} <span style="font-size:11px; font-weight:700; color:${diffColor};">(${safeText(ev.diffStr)})</span></span>
                  </div>`;
              }).join('')}</div>
            </div>`;
        });
        bottomHtml += `</div>`;
      }
    } else if (S.homeSubTab === 'goal') {
      const goals = S.settings.goals || {};
      const weekly = pf(goals.weekly); const monthly = pf(goals.monthly); const yearly = pf(goals.yearly);
      if (weekly > 0 || monthly > 0 || yearly > 0) {
        bottomHtml += `<div class="card" style="border: 1px solid var(--border); display:flex; flex-direction:column; gap:16px;">`;
        if (weekly > 0) {
          const wDate = new Date(dateObj); const wDay = wDate.getDay() || 7; wDate.setDate(wDate.getDate() - wDay + 1); let weekTotal = 0;
          for(let i=0; i<7; i++) { const dStr = `${wDate.getFullYear()}-${pad(wDate.getMonth()+1)}-${pad(wDate.getDate())}`; weekTotal += getDayRecs(dStr).reduce((s,r)=>s+recTotal(r),0); wDate.setDate(wDate.getDate() + 1); }
          const wPct = Math.min(100, Math.round(weekTotal/weekly*100)); const wRemain = Math.max(0, weekly-weekTotal); const wColor = wPct >= 100 ? 'var(--green)' : wPct >= 70 ? 'var(--blue)' : 'var(--red)';
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">📊 本週目標進度 <span style="font-size:11px;color:var(--t3);font-weight:500;">(剩 ${7 - wDay} 天)</span></span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${wColor}">${wPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${wPct}%;background:${wColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(weekTotal)}</span><span>${wRemain>0?`還差 $ ${fmt(wRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        if (monthly > 0) {
          const monthRecs = getMonthRecs(dateObj.getFullYear(), dateObj.getMonth()+1); const monthTotal = monthRecs.reduce((s,r)=>s+recTotal(r), 0);
          const mPct = Math.min(100, Math.round(monthTotal/monthly*100)); const mRemain = Math.max(0, monthly-monthTotal); const mColor = mPct >= 100 ? 'var(--green)' : mPct >= 70 ? 'var(--blue)' : 'var(--red)';
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">📈 本月目標進度 <span style="font-size:11px;color:var(--t3);font-weight:500;">(剩 ${new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate() - dateObj.getDate()} 天)</span></span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${mColor}">${mPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${mPct}%;background:${mColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(monthTotal)}</span><span>${mRemain>0?`還差 $ ${fmt(mRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        if (yearly > 0) {
          const yearRecs = S.records.filter(r => r.date.startsWith(`${dateObj.getFullYear()}-`)); const yearTotal = yearRecs.reduce((s,r)=>s+recTotal(r), 0);
          const yPct = Math.min(100, Math.round(yearTotal/yearly*100)); const yRemain = Math.max(0, yearly-yearTotal); const yColor = yPct >= 100 ? 'var(--green)' : yPct >= 70 ? 'var(--blue)' : 'var(--red)';
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">👑 本年目標進度 <span style="font-size:11px;color:var(--t3);font-weight:500;">(剩 ${Math.ceil((new Date(dateObj.getFullYear(), 11, 31) - dateObj) / 86400000)} 天)</span></span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${yColor}">${yPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${yPct}%;background:${yColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(yearTotal)}</span><span>${yRemain>0?`還差 $ ${fmt(yRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        bottomHtml += `</div>`;
      } else {
        bottomHtml += `<div class="empty-tip">請先至「設定」頁，設定目標</div>`;
      }
    }

    // 2. 確定安全後才賦值
    topEl.innerHTML = topHtml;
    botEl.innerHTML = bottomHtml;

  } catch (error) {
    console.error("首頁渲染發生嚴重錯誤：", error);
    botEl.innerHTML = `<div class="empty-tip" style="color:var(--red);">系統發生例外錯誤，請往下拉動重新整理</div>`;
  }
}

// 關閉並記憶公告
window.dismissAnnouncement = function(encodedText) {
  // 將編碼過的文字還原並存入 LocalStorage
  const text = decodeURIComponent(encodedText);
  localStorage.setItem('delivery_dismissed_ann', text);
  
  // 執行動畫並移除元素
  const el = document.getElementById('home-announcement-card');
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    el.style.marginBottom = '-'+el.offsetHeight+'px'; // 讓下方元素順滑上移
    setTimeout(() => { el.remove(); }, 300);
  }
}

/* === 打卡功能 === */
function punchIn() {
  const d = new Date();
  S.punch = {
    date: todayStr(),
    startTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    timestamp: d.getTime()
  };
  savePunch();
  toast('▶ 已上線打卡');
  renderHome();
}

async function punchOut() {
  if (!S.punch) return;
  const ok = await customConfirm('確定要下線並將工時存入記錄嗎？');
  if (!ok) return;

  const now = new Date();
  // 取得上線時間戳，若沒有則從日期與字串還原
  const startMs = S.punch.timestamp || new Date(`${S.punch.date}T${S.punch.startTime}:00`).getTime();
  const endMs = now.getTime();
  
  // 計算經過了幾個小時
  let hoursVal = (endMs - startMs) / 3600000;
  if (hoursVal < 0) hoursVal = 0;

  // 建立一筆專屬的「純打卡紀錄」
  const rec = {
    id: newId(),
    date: S.punch.date,
    time: nowTime(),
    platformId: '', 
    isPunchOnly: true,
    punchIn: S.punch.startTime,
    punchOut: nowTime(),
    hours: hoursVal,
    orders: 0, mileage: 0, income: 0, bonus: 0, tempBonus: 0, tips: 0, note: ''
  };

  S.records.push(rec);
  saveRecords();
  
  // 清除打卡狀態
  S.punch = null;
  savePunch();
  
  toast('⏹ 已下線，工時已記錄');
  renderHome();
}
/* ══ 2. 首頁 結束 ══════════════════════════════════════════ */

/* ══ 3. 查看記錄 開始 ════════════════════════════════════ */
function foldCard(id, e) {
  e.stopPropagation();
  const el = document.getElementById(id); const btn = document.getElementById(id + '-btn'); if (!el || !btn) return;
  if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { el.style.maxHeight = '70px'; btn.style.transform = 'rotate(180deg)'; } 
  else { el.style.maxHeight = '0px'; btn.style.transform = 'rotate(0deg)'; }
}

function toggleCalendarGrid() {
  const wrap = document.getElementById('hist-calendar-wrap');
  const btn = document.getElementById('hist-cal-toggle');
  if (wrap.style.maxHeight === '0px' || wrap.style.maxHeight === '') {
    wrap.style.maxHeight = '500px';
    btn.textContent = '▲';
  } else {
    wrap.style.maxHeight = '0px';
    btn.textContent = '▼';
  }
}

/* ══ 美化版：單筆記錄卡片 (包含保養維修項目 + 車行 + 備註) ══ */
function buildRecItem(r) {
  const cid = `hrc-${r.id}`;
  
  // 1. 現金小費專屬卡片
  if (r.isCashTip) {
    const plat = getPlatform(r.platformId);
    return `
      <div class="hist-rec-card cashtip-card" data-id="${safeText(r.id)}" onclick="openDetailOverlay('${safeText(r.id)}')">
        <div class="hrc-top" style="padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="hrc-plat-tag" style="background:${plat.color};">${safeText(plat.name)}</span>
              <span style="font-size:11px; font-weight:700; color: #16a34a;">💵 現金小費</span>
              <span style="font-size:11px; color:var(--t3);">${safeText(r.time || '')}</span>
            </div>
            ${r.note ? `<div style="font-size:11px; color:var(--red); font-weight:700;">${safeTextWithBr(r.note)}</div>` : ''}
          </div>
          <div style="font-family:var(--mono); font-size:18px; font-weight:800; color:#16a34a;">$${fmt(r.cashTipAmt)}</div>
        </div>
      </div>`;
  }
  
  // 2. 純打卡紀錄
  if (r.isPunchOnly) {
    return `
      <div class="hist-rec-card punch-card-compact" data-id="${safeText(r.id)}" onclick="openDetailOverlay('${safeText(r.id)}')">
        <span style="background:var(--t2); color:#fff; font-size:10px; padding:3px 8px; border-radius:6px; font-weight:700; letter-spacing:0.5px;">🕒 上線打卡</span>
        <div class="h-div" style="margin:0 12px;"></div>
        <span style="font-family:var(--mono); color:var(--t1); font-size:13px; font-weight:600; flex:1; text-align:center;">${safeText(r.punchIn)} <span style="color:var(--t3);font-size:11px;">→</span> ${safeText(r.punchOut)}</span>
        <div class="h-div" style="margin:0 12px;"></div>
        <span style="font-size:13px; font-weight:800; color:var(--t2); font-family:var(--mono);">${fmtHours(r.hours)}</span>
      </div>`;
  }

  // 3. 一般行程記錄
  const plat = getPlatform(r.platformId); 
  const total = recTotal(r);
  const totalBonus = pf(r.bonus) + pf(r.tempBonus);
  const income = total - totalBonus - pf(r.tips);

  const _orders = pf(r.orders); 
  const _hours = pf(r.hours);
  const avgOrd = _orders > 0 ? Math.round(total / _orders) : 0;
  const ordHr = _hours > 0 ? (_orders / _hours).toFixed(1) : 0;
  const avgHr = _hours > 0 ? Math.round(total / _hours) : 0;

  const incPct = total > 0 ? Math.round((income / total) * 100) : 0;
  const bonPct = total > 0 ? Math.round((totalBonus / total) * 100) : 0;
  const tipPct = total > 0 ? Math.round((pf(r.tips) / total) * 100) : 0;
  
  let tagsHtml = '';
  if (_orders > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${_orders} 單</span>`;
  if (r.mileage > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${r.mileage} km</span>`; 
  if (_hours > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${fmtHours(_hours)}</span>`;

  // 基本工資判斷
  let recWageHtml = '';
  if (_hours > 0) {
    let wageStatus = ''; let wageColor = ''; let wageBg = '';
    if (avgHr <= 154) { wageStatus = '😭嚴重低於基本工資'; wageColor = 'var(--red)'; wageBg = 'var(--red-d)'; } 
    else if (avgHr <= 175) { wageStatus = '⚠️⚠️低於基本工資'; wageColor = 'var(--acc2)'; wageBg = 'var(--acc-d)'; } 
    else if (avgHr <= 195) { wageStatus = '⚠️略低於基本工資'; wageColor = 'var(--blue)'; wageBg = 'var(--blue-d)'; } 
    else { wageStatus = '🎉符合基本工資'; wageColor = 'var(--green)'; wageBg = 'var(--green-d)'; }
    
    recWageHtml = `<div style="margin-top:6px;"><span style="background:${wageBg}; color:${wageColor}; font-size:12px; padding:6px 5px; border-radius:5px; font-weight:800; letter-spacing:0px; white-space:nowrap; display:inline-block; line-height:1;">${wageStatus}</span></div>`;
  }

  // === 新增：保養維修專屬美化顯示 ===
  if (r.type === 'maintenance' || r.type === 'maint') {
    const maintItems = (r.items && r.items.length > 0)
      ? r.items.map(item => safeText(item)).join('、')
      : '未填寫保養項目';

    const shopInfo = r.shop ? `<span style="font-size:13px; color:var(--t2);">${safeText(r.shop)}</span>` : '';
    const noteLabel = r.note ? `<span class="veh-label veh-label-note">備註：${safeTextWithBr(r.note)}</span>` : '';
    const kmLabel = r.km ? `<span class="veh-label veh-label-km">距離：${safeText(r.km.toString())} km</span>` : '';

    return `
      <div class="hist-rec-card" data-id="${safeText(r.id)}" onclick="openDetailOverlay('${safeText(r.id)}')">
        <div class="hrc-top">
          <div class="hrc-toggle" id="${cid}-btn" onclick="foldCard('${safeText(cid)}', event)">▼</div>
          <div class="hrc-row1" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span class="hrc-plat-tag" style="background:#8b5cf6; color:#fff;">🔧 保養維修</span>
            <span style="font-size:13px; color:var(--blue); font-weight:700;">${safeText(r.date)} ${safeText(r.time || '')}</span>
            ${r.shop ? `<span style="font-size:13px; color:var(--t2);">${safeText(r.shop)}</span>` : ''}
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; margin:10px 0;">
            <span class="veh-label veh-label-item">項目：${maintItems}</span>
            ${kmLabel}
            ${noteLabel}
          </div>
          <div style="font-family:var(--mono); font-size:17px; font-weight:800; color:#8b5cf6;">
            -$${fmt(r.amount || 0)}
          </div>
        </div>
      </div>`;
  }

  // === 一般行程記錄（保持原本美化）===
  return `
    <div class="hist-rec-card" data-id="${safeText(r.id)}">
      <div class="hrc-top" onclick="openDetailOverlay('${safeText(r.id)}')">
        <div class="hrc-toggle" id="${cid}-btn" onclick="foldCard('${safeText(cid)}', event)">▼</div>
        <div class="hrc-row1">
          <span class="hrc-plat-tag" style="background:${plat.color};">${safeText(plat.name)}</span>
          <span>${safeText(r.time || '')}</span>
          ${r.note ? `<span class="h-div"></span><span style="color:var(--red); font-weight:700;"> ${safeTextWithBr(r.note)}</span>` : ''}
        </div>
        <div class="hrc-row2">
          <span class="hrc-amt">$ ${fmt(total)}</span>
          ${tagsHtml}
        </div>
        
        <div style="display:flex; justify-content:center; gap:6px; margin-top:3px; flex-wrap:wrap; text-align:center;">
          <div style="flex:1; background: rgba(34, 197, 94, 0.15); color: var(--green); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            淨行程<br>
            <span style="color: #1f9c4d; font-size:15px; font-weight:800;">$ ${fmt(income)}</span>
            <span style="font-size:11px; opacity:0.75; font-weight:600;">(${incPct}%)</span>
          </div>
          <div style="flex:1; background: rgba(245,158,11,0.15); color: hsl(25, 100%, 59%); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            獎勵<br>
            <span style="color: #ff7715; font-size:15px; font-weight:800;">$ ${fmt(totalBonus)}</span>
            <span style="font-size:11px; font-weight:600;">(${bonPct}%)</span>
          </div>
          <div style="flex:1; background: rgba(190, 59, 246, 0.15); color: rgba(137, 43, 226, 0.9); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            小費<br>
            <span style="color: #8A2BE2; font-size:15px; font-weight:800;">$ ${fmt(pf(r.tips))}</span>
            <span style="font-size:11px; opacity:0.75; font-weight:600;">(${tipPct}%)</span>
          </div>
        </div>
      </div>

      <div id="${cid}" class="hrc-collapse" style="background: #ffffff; overflow:hidden; transition:max-height 0.3s ease;">
        <div style="border-top:3px dashed #708090; margin-bottom:3px;"></div>
        <div style="padding:10px 3px 6px 3px; display:flex; justify-content:center; align-items:flex-start; font-size:11px; font-weight:700; color:var(--t2); width:100%;">
          <div style="flex:1; text-align:center;">一單： <span style="font-family:var(--mono); color: var(--text-cyan); font-size:18px; font-weight:800;">$ ${fmt(avgOrd)}</span></div>
          <div class="h-div" style="height:30px;"></div>
          <div style="flex:1; text-align:center;">1 h： <span style="font-family:var(--mono); color: var(--text-red); font-size:18px; font-weight:800;">${ordHr} <small style="color: rgb(185, 56, 255);font-size:11px; font-weight:500;">單</small></span></div>
          <div class="h-div" style="height:30px;"></div>
          <div style="flex:1; text-align:center;">時薪： <span style="font-family:var(--mono); color: var(--text-blue); font-size:18px; font-weight:800;">$${fmt(avgHr)}</span>
            ${recWageHtml}
          </div>
        </div>
      </div>
    </div>`;
}

if (!S.histTab) S.histTab = 'day';
if (!S.histNavDate) S.histNavDate = new Date();
if (!S.histFilter) S.histFilter = 'all';

function navHistGroup(dir, mode) {
  let d = new Date(S.histNavDate);
  if (mode === 'week') { d.setDate(d.getDate() + (dir * 7)); } 
  if (mode === 'biweek') { d.setDate(d.getDate() + (dir * 14)); }
  if (mode === 'halfmonth') {
    let isFirstHalf = d.getDate() <= 15;
    if (dir === 1) {
      if (isFirstHalf) d.setDate(16);
      else { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    } else if (dir === -1) {
      if (isFirstHalf) { d.setMonth(d.getMonth() - 1); d.setDate(16); }
      else d.setDate(1);
    }
  }
  if (mode === 'month') { d.setMonth(d.getMonth() + dir); } 
  if (mode === 'year') { d.setFullYear(d.getFullYear() + dir); }
  S.histNavDate = d; renderHistory();
}
function changeHistFilter(val) { S.histFilter = val; renderHistory(); }

/* ══ 替換：統一讓查看紀錄外層負責上下滾動 ══ */
function renderHistory() { 
  const content = document.getElementById('hist-content');
  
  // 統一所有模式下的滾動屬性，保證必定有上下捲動軸
  content.style.overflowY = 'auto';
  content.style.overflowX = 'hidden';
  content.style.display = 'block';
  content.style.WebkitOverflowScrolling = 'touch';
  
  if (S.histTab === 'day') {
    renderHistDayView(); 
  } else {
    renderHistGroupView(S.histTab); 
  }
}

function renderHistDayView() {
  const content = document.getElementById('hist-content'); const { calY:y, calM:m } = S;
  content.innerHTML = `<div id="hist-header" style="padding:0 16px 6px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="display:flex;align-items:center;gap:8px"><button class="mbtn" id="hist-prev">◀</button><h2 id="hist-label" style="font-size:15px;font-weight:600;min-width:80px;text-align:center">${y} 年 ${m} 月</h2><button class="mbtn" id="hist-next">▶</button><button class="mbtn" onclick="toggleCalendarGrid()" id="hist-cal-toggle" style="font-size:12px; color:var(--t3);" title="收起/展開日曆">▲</button></div><div style="display:flex; gap:8px;"><button class="icon-btn" onclick="openSearch()" title="搜尋記錄"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button><button class="icon-btn" onclick="openFullCalendar()" title="大日曆"><img src="images/calendar.png" alt="日曆" style="width:16px;height:16px;opacity:0.7;"></button></div></div><div id="hist-calendar-wrap" style="transition: max-height 0.3s ease; overflow: hidden; max-height: 500px;"><div class="month-grid" id="hist-calendar"></div></div><div class="hist-divider"></div><div id="hist-day-summary" style="margin:6px 0 4px;"></div><div class="sec-title" id="hist-day-label" style="margin-bottom:4px; padding:0 4px;">指定日記錄</div></div><div id="hist-rec-list" style="padding:0 16px 24px; display:flex; flex-direction:column; gap:3px;"></div>`;
  document.getElementById('hist-prev').addEventListener('click', () => { S.calM--; if(S.calM<1){S.calM=12;S.calY--;} S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); });
  document.getElementById('hist-next').addEventListener('click', () => { S.calM++; if(S.calM>12){S.calM=1;S.calY++;} S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); });
  renderHistCalendarGrid(); renderHistRecords(S.selDate);
}

function renderHistCalendarGrid() {
  const { calY:y, calM:m } = S; const grid = document.getElementById('hist-calendar'); const first = new Date(y, m-1, 1).getDay(); const days  = new Date(y, m, 0).getDate(); const DOW = ['日','一','二','三','四','五','六'];
  let html = `<div class="month-row">`; DOW.forEach(d => { html += `<div class="month-cell month-dow">${d}</div>`; }); html += `</div><div class="month-row">`;
  let col = 0; for (let i=0; i<first; i++) { html += `<div class="month-cell"></div>`; col++; }
  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`; const sum = getDayRecs(ds).reduce((s,r)=>s+recTotal(r), 0); const cls = ['month-cell', ds===todayStr()?'today':'', ds===S.selDate?'sel':''].filter(Boolean).join(' '); const dotHtml = sum > 0 ? `<div class="has-rec-dot"></div>` : '';
    html += `<div class="${cls}" data-ds="${ds}">${dotHtml}<div class="day-num">${day}</div></div>`;
    col++; if (col % 7 === 0 && day < days) { html += `</div><div class="month-row">`; }
  } html += `</div>`; grid.innerHTML = html;
  grid.querySelectorAll('.month-cell[data-ds]').forEach(cell => { cell.addEventListener('click', () => { S.selDate = cell.dataset.ds; grid.querySelectorAll('.month-cell').forEach(c => c.classList.toggle('sel', c.dataset.ds === S.selDate)); renderHistRecords(S.selDate); }); });
}

/* 尋找 renderHistGroupView() 中這段邏輯，將 halfmonth 條件加進去 */
function renderHistGroupView(mode) {
  const content = document.getElementById('hist-content'); const nd = new Date(S.histNavDate); let startD, endD, labelStr;
  if (mode === 'week') { const day = nd.getDay() || 7; startD = new Date(nd); startD.setDate(startD.getDate() - day + 1); endD = new Date(startD); endD.setDate(endD.getDate() + 6); labelStr = `${pad(startD.getMonth()+1)}/${pad(startD.getDate())} ~ ${pad(endD.getMonth()+1)}/${pad(endD.getDate())}`; } 
  else if (mode === 'biweek') { const anchor = new Date(2025, 10, 10); const diffTime = (new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), 12)).getTime() - anchor.getTime(); const diffDays = Math.floor(diffTime / 86400000); const cycleOffset = Math.floor(diffDays / 14); startD = new Date(anchor); startD.setDate(startD.getDate() + cycleOffset * 14); endD = new Date(startD); endD.setDate(endD.getDate() + 13); let yearPrefix = (startD.getFullYear() !== endD.getFullYear()) ? `${startD.getFullYear()}/` : ''; labelStr = `${yearPrefix}${pad(startD.getMonth()+1)}/${pad(startD.getDate())} ~ ${pad(endD.getMonth()+1)}/${pad(endD.getDate())}`; } 
  else if (mode === 'halfmonth') { 
    let isFirstHalf = nd.getDate() <= 15;
    if (isFirstHalf) {
      startD = new Date(nd.getFullYear(), nd.getMonth(), 1); endD = new Date(nd.getFullYear(), nd.getMonth(), 15); labelStr = `${nd.getFullYear()}年 ${nd.getMonth()+1}月 (上)`;
    } else {
      startD = new Date(nd.getFullYear(), nd.getMonth(), 16); endD = new Date(nd.getFullYear(), nd.getMonth() + 1, 0); labelStr = `${nd.getFullYear()}年 ${nd.getMonth()+1}月 (下)`;
    }
  }
  else if (mode === 'month') { startD = new Date(nd.getFullYear(), nd.getMonth(), 1); endD = new Date(nd.getFullYear(), nd.getMonth() + 1, 0); labelStr = `${nd.getFullYear()}年 ${nd.getMonth()+1}月`; } 
  else if (mode === 'year') { startD = new Date(nd.getFullYear(), 0, 1); endD = new Date(nd.getFullYear(), 11, 31); labelStr = `${nd.getFullYear()}年`; }

  const sStr = `${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}`; const eStr = `${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}`;
  /* ... 後面程式碼不變 ... */
  let recs = S.records.filter(r => !r.isPunchOnly && r.date >= sStr && r.date <= eStr); if (S.histFilter !== 'all') recs = recs.filter(r => r.platformId === S.histFilter);
  let platOpts = `<option value="all">全部平台</option>` + S.platforms.filter(p=>p.active).map(p=>`<option value="${safeText(p.id)}" ${S.histFilter===p.id?'selected':''}>${safeText(p.name)}</option>`).join('');
  // 替換這段 html 組合：移除原本卡住滾動的 flex:1 與 overflow-y:auto
  let html = `<div style="padding: 0 16px;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="mbtn" onclick="navHistGroup(-1, '${mode}')">◀</button>
        <span style="font-family:var(--mono); font-size:14px; font-weight:700; width:125px; text-align:center; color:var(--acc); letter-spacing:0.5px;">${labelStr}</span>
        <button class="mbtn" onclick="navHistGroup(1, '${mode}')">▶</button>
      </div>
      <select class="fsel" style="width:auto; padding:6px 10px; font-size:13px; font-weight:600;" onchange="changeHistFilter(this.value)">${platOpts}</select>
    </div>
  </div>
  <div style="padding: 0 16px 24px; display:flex; flex-direction:column; gap:0;">`;
  
  if (recs.length === 0) { html += `<div class="empty-tip">沒有資料</div>`; } else {
    const tInc = recs.reduce((s,r) => s + recTotal(r), 0); const tOrd = recs.reduce((s,r) => s + pf(r.orders), 0); const tHrs = recs.reduce((s,r) => s + pf(r.hours), 0); const tBonus = recs.reduce((s,r) => s + pf(r.bonus), 0); const tTemp = recs.reduce((s,r) => s + pf(r.tempBonus), 0); const tTips = recs.reduce((s,r) => s + pf(r.tips), 0);
    html += buildSummaryCard('區間總計', tInc, tOrd, tHrs, tBonus, tTemp, tTips, 'hist-group-card');
    html += recs.sort((a,b)=>b.date.localeCompare(a.date) || (a.time||'').localeCompare(b.time||'')).map(r => buildRecItem(r)).join('');
  } html += `</div>`; content.innerHTML = html;
}

function openFullCalendar() { document.getElementById('full-calendar-overlay').classList.add('show'); renderFullCalendar(); }
function closeFullCalendar() { document.getElementById('full-calendar-overlay').classList.remove('show'); }
function changeFullCalMonth(offset) { S.calM += offset; if(S.calM < 1) { S.calM = 12; S.calY--; } if(S.calM > 12) { S.calM = 1; S.calY++; } renderFullCalendar(); S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); }

function renderFullCalendar() {
  const { calY:y, calM:m } = S; document.getElementById('fc-title').textContent = `${y}年 ${m}月`;
  const DOW = ['週日','週一','週二','週三','週四','週五','週六']; document.getElementById('fc-dow').innerHTML = DOW.map(d => `<div class="fc-dow-cell">${d}</div>`).join('');
  const grid = document.getElementById('fc-grid'); const first = new Date(y, m-1, 1).getDay(); const days = new Date(y, m, 0).getDate(); const today = todayStr();
  let html = ``; const prevDays = new Date(y, m-1, 0).getDate();
  for (let i=first-1; i>=0; i--) { html += `<div class="fc-cell empty"><div class="fc-date">${pad(prevDays - i)}</div></div>`; }
  
  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`; const sum = getDayRecs(ds).reduce((s,r)=>s+recTotal(r), 0); 
    const isToday = ds === today;
    
    let cls = 'fc-cell'; 
    if(isToday) cls+=' today';
    
    let contentHtml = `<div class="fc-date">${pad(day)}</div>`;
    if(sum > 0) {
      cls += ' has-income';
      contentHtml += `<div class="fc-amt">${fmt(sum)}</div>`;
    }
    html += `<div class="${cls}">${contentHtml}</div>`;
  }
  const totalCells = first + days; const remain = totalCells % 7 === 0 ? 0 : (Math.ceil(totalCells/7)*7) - totalCells;
  for (let i=1; i<=remain; i++) { html += `<div class="fc-cell empty"><div class="fc-date">${pad(i)}</div></div>`; }
  grid.innerHTML = html;
}

function renderHistRecords(ds) {
  const d = new Date(ds+'T00:00:00'); const dow = ['日','一','二','三','四','五','六'][d.getDay()];
  document.getElementById('hist-day-label').textContent = `${d.getMonth()+1} 月 ${d.getDate()} 日（星期${dow}）記錄`;
  const recs = getDayRecs(ds); const total = recs.reduce((s,r)=>s+recTotal(r), 0); 
  const cashTips = recs.filter(r=>r.isCashTip).reduce((s,r)=>s+pf(r.cashTipAmt), 0);
  const sumEl = document.getElementById('hist-day-summary');
  
  if (total > 0 || cashTips > 0) {
    const orders = recs.reduce((s,r)=>s+pf(r.orders), 0); const hours = recs.reduce((s,r)=>s+pf(r.hours), 0); const dayBonus = recs.reduce((s,r)=>s+pf(r.bonus), 0); const dayTemp = recs.reduce((s,r)=>s+pf(r.tempBonus), 0); const dayTips = recs.reduce((s,r)=>s+pf(r.tips), 0);
    
    let sumHtml = total > 0 ? buildSummaryCard('當日', total, orders, hours, dayBonus, dayTemp, dayTips, 'hist-day-card') : '';
    if (cashTips > 0) {
      sumHtml += `<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:10px 16px; margin:4px 2px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:13px; font-weight:700; color:#15803d;">💵 當日現金小費 (不計入總收入)</span>
        <span style="font-family:var(--mono); font-size:16px; font-weight:800; color:#16a34a;">$${fmt(cashTips)}</span>
      </div>`;
    }
    sumEl.innerHTML = sumHtml;
  } else { sumEl.innerHTML = ''; }
  
  const listEl = document.getElementById('hist-rec-list');
  if (!recs.length) { listEl.innerHTML = `<div class="empty-tip">✨ 這天沒有記錄</div>`; return; }
  listEl.innerHTML = recs.slice().sort((a,b)=>(a.time||'').localeCompare(b.time||'')).map(r => buildRecItem(r)).join('');
}

function openDetailOverlay(id) {
  const r = S.records.find(r=>r.id===id); if (!r) return;
  const plat = getPlatform(r.platformId); const total = recTotal(r);
  const rows = [ ['🏪 平台', `<span style="color:${plat.color};font-weight:600">${safeText(plat.name)}</span>`], ['📆 日期', safeText(r.date)], ['⏱ 打卡', r.punchIn&&r.punchOut?`${safeText(r.punchIn)} → ${safeText(r.punchOut)}`:(r.punchIn?safeText(r.punchIn):'—')], ['🕐 工時', r.hours>0?fmtHours(r.hours):'—'], ['📦 接單數', r.orders>0?`${r.orders} 單`:'—'], ['🛣️ 行駛里程', r.mileage>0?`${r.mileage} km`:'—'], ['💰 行程收入',`NT$ ${fmt(r.income)}`], ['🎁 固定獎勵',r.bonus>0?`NT$ ${fmt(r.bonus)}`:'—'], ['⚡ 臨時獎勵',r.tempBonus>0?`NT$ ${fmt(r.tempBonus)}`:'—'], ['🤑 小費', r.tips>0?`NT$ ${fmt(r.tips)}`:'—'], ['📝 備註', r.note ? safeTextWithBr(r.note) : '—'] ];
  document.getElementById('detail-body').innerHTML = `<div style="text-align:center;padding:10px 0 16px;border-bottom:1px solid var(--border)"><div style="font-size:13px;color:var(--t3);margin-bottom:4px">本筆總收入</div><div style="font-family:var(--mono);font-size:38px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div></div><div style="margin-top:12px">${rows.map(([l,v])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--t3)">${l}</span><span style="font-size:13px;font-weight:500">${v}</span></div>`).join('')}</div><div style="display:flex;gap:8px;margin-top:16px"><button onclick="closeDetailOverlay();openAddPage(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--acc-d);color:var(--acc);border:1px solid rgba(255,107,53,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">✎ 編輯</button><button onclick="deleteRecord('${safeText(r.id)}')" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--red-d);color:var(--red);border:1px solid rgba(239,68,68,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">🗑 刪除</button></div>`;
  document.getElementById('detail-overlay').classList.add('show');
}
async function deleteRecord(id) { closeDetailOverlay(); const ok = await customConfirm('確定要刪除這筆記錄嗎？<br><strong>此動作無法復原。</strong>'); if (!ok) return; S.records = S.records.filter(r=>r.id!==id); saveRecords(); toast('已刪除'); if (S.tab==='home') renderHome(); if (S.tab==='history') renderHistory(); }

function openSearch() { openOverlay('search-page'); setTimeout(() => { document.getElementById('search-kw').focus(); }, 350); }
function doSearch() {
  const kw = document.getElementById('search-kw').value.trim().toLowerCase(); const from = document.getElementById('search-from').value; const to = document.getElementById('search-to').value; const el = document.getElementById('search-results');
  let recs = S.records.filter(r => { if (from && r.date < from) return false; if (to && r.date > to) return false; if (!kw) return true; const plat = getPlatform(r.platformId).name.toLowerCase(); return plat.includes(kw) || (r.note||'').toLowerCase().includes(kw) || String(recTotal(r)).includes(kw) || String(r.orders||'').includes(kw); }).sort((a,b)=>b.date.localeCompare(a.date));
  if (!recs.length) { el.innerHTML = `<div class="empty-tip">找不到符合記錄</div>`; return; }
  el.innerHTML = recs.map(r=>buildRecItem(r)).join('');
}

function resetSearch() {
  document.getElementById('search-kw').value = '';
  document.getElementById('search-from').value = '';
  document.getElementById('search-to').value = '';
  document.getElementById('search-results').innerHTML = '';
}
/* ══ 3. 查看記錄 結束 ════════════════════════════════════ */

/* ══ 4. 新增記錄 開始 ════════════════════════════════════ */
function openAddPage(record=null, prefill={}) {
  S.editingId = record ? record.id : null; S.selPlatformId = record ? record.platformId : (S.platforms.find(p=>p.active)?.id||null);
  document.getElementById('add-page-title').textContent = record ? '編輯記錄' : '新增記錄';
  
  if (record && record.isCashTip) {
    switchAddTab('cashtip', 1);
    document.getElementById('f-ct-date').value = record.date || todayStr();
    document.getElementById('f-ct-time').value = record.time || nowTime();
    document.getElementById('f-ct-given').value = record.givenAmt || '';
    document.getElementById('f-ct-cost').value = record.costAmt || '';
    document.getElementById('f-ct-amount').value = record.cashTipAmt || '';
    document.getElementById('f-ct-note').value = record.note || '';
  } else {
    switchAddTab('regular', 0);
    document.getElementById('f-date').value = record?.date || prefill.date || S.selDate || todayStr();
    // 👇 加入時間載入
    document.getElementById('f-time').value = record?.time || nowTime();
    
    let totalHours = pf(record?.hours || prefill.hours || 0); let h = Math.floor(totalHours); let m = Math.round((totalHours - h) * 60);
    document.getElementById('f-hrs-val').value = h > 0 ? h : ''; document.getElementById('f-min-val').value = m > 0 ? m : '';
    document.getElementById('f-orders').value = record?.orders || ''; 
    document.getElementById('f-income').value = record?.income || '';
    document.getElementById('f-bonus').value = record?.bonus || ''; document.getElementById('f-temp-bonus').value = record?.tempBonus || '';
    document.getElementById('f-tips').value = record?.tips || ''; document.getElementById('f-note').value = record?.note || '';
  }
  
  renderPlatformChips(); calcAddTotal(); goPage('add');
}

function switchAddTab(tab, idx) {
  S.addTab = tab;
  document.getElementById('add-tab-bg').style.transform = `translateX(${idx * 100}%)`;
  document.getElementById('add-tab-bg').style.background = tab === 'cashtip' ? 'var(--green)' : 'var(--acc)';
  document.getElementById('btn-add-regular').classList.toggle('active', tab === 'regular');
  document.getElementById('btn-add-cashtip').classList.toggle('active', tab === 'cashtip');
  document.getElementById('add-form-regular').style.display = tab === 'regular' ? 'block' : 'none';
  document.getElementById('add-form-cashtip').style.display = tab === 'cashtip' ? 'block' : 'none';
  
  /* 替換 switchAddTab 內的小費時間邏輯 */
  if(tab === 'cashtip') {
    if (!S.editingId) {
      // 新增模式下，每次切換都強制刷新為現在時間
      document.getElementById('f-ct-date').value = todayStr();
      document.getElementById('f-ct-time').value = nowTime();
    } else {
      // 編輯模式下，若沒有值才帶入預設值
      document.getElementById('f-ct-date').value = document.getElementById('f-ct-date').value || todayStr();
      document.getElementById('f-ct-time').value = document.getElementById('f-ct-time').value || nowTime();
    }
  }
}

/* ══ 替換：修復小費計算BUG與重置表單功能 ══ */
function calcCashTip() {
  const given = pf(document.getElementById('f-ct-given').value);
  const costStr = document.getElementById('f-ct-cost').value.trim();
  
  // 當應收金額被清空時，自動將小費歸零
  if (costStr === '') {
    document.getElementById('f-ct-amount').value = '';
    return;
  }
  
  const cost = pf(costStr);
  if (given > 0 && cost >= 0 && given >= cost) {
    document.getElementById('f-ct-amount').value = given - cost;
  } else {
    document.getElementById('f-ct-amount').value = '';
  }
}

/* ══ 替換：重置新增記錄表單 ══ */
function resetAddForm() {
  document.getElementById('f-date').value = todayStr();
  // 👇 加入重置時間
  if (document.getElementById('f-time')) document.getElementById('f-time').value = nowTime();
  document.getElementById('f-orders').value = '';
  document.getElementById('f-hrs-val').value = '';
  document.getElementById('f-min-val').value = '';
  document.getElementById('f-income').value = '';
  document.getElementById('f-bonus').value = '';
  document.getElementById('f-temp-bonus').value = '';
  document.getElementById('f-tips').value = '';
  document.getElementById('f-note').value = '';
  document.getElementById('add-total-val').textContent = '0';
  
  // 現金小費也歸零並恢復今日時間
  document.getElementById('f-ct-date').value = todayStr();
  document.getElementById('f-ct-time').value = nowTime();
  document.getElementById('f-ct-given').value = '';
  document.getElementById('f-ct-cost').value = '';
  document.getElementById('f-ct-amount').value = '';
  document.getElementById('f-ct-note').value = '';
  
  S.editingId = null;
  switchAddTab('regular', 0); // ✅ 強制切換回預設的「行程記錄」頁籤
}

function renderPlatformChips() { const container = document.getElementById('platform-chips'); const active = Array.isArray(S.platforms) ? S.platforms.filter(p=>p.active) : []; if (!S.selPlatformId && active.length) S.selPlatformId = active[0].id; container.innerHTML = active.map(p => `<div class="platform-chip${S.selPlatformId===p.id?' on':''}" style="${S.selPlatformId===p.id?`background:${p.color};border-color:${p.color}`:''}" onclick="selectPlatform('${safeText(p.id)}')"><span>${safeText(p.name)}</span></div>`).join(''); }
/* 替換原有的 selectPlatform */
function selectPlatform(id) { 
  S.selPlatformId = id; 
  renderPlatformChips(); 
  calcAddTotal(); // 👈 切換平台時，自動檢查是否有符合的獎勵
}
/* ══ 替換：帶入自動獎勵計算與總額 (支援即時連動更新) ══ */
function calcAddTotal() { 
  calcAutoReward(); // 👈 計算行程輸入時，立刻更新獎勵欄位

  const income = pf(document.getElementById('f-income').value); 
  const bonus = pf(document.getElementById('f-bonus').value); 
  const tempBonus = pf(document.getElementById('f-temp-bonus').value); 
  const tips = pf(document.getElementById('f-tips').value); 
  const total = income + bonus + tempBonus + tips; 
  document.getElementById('add-total-val').textContent = fmt(total); 
}

// 取得獎勵判斷的起迄日期 (修復星期日檢查漏洞)
function getRewardWindow(dStr, r) {
  if (!r.recurring) return { start: r.startDate, end: r.endDate };
  const d = new Date(dStr);
  const day = d.getDay();
  const dWeekDay = day === 0 ? 7 : day;
  
  // 處理特定星期幾的循環 (如熊貓一到三)
  if (r.recurringDays && r.recurringDays.length > 0) {
      let minDay = 7, maxDay = 1;
      r.recurringDays.forEach(dw => { let w = dw === 0 ? 7 : dw; if(w < minDay) minDay = w; if(w > maxDay) maxDay = w; });
      const startD = new Date(d); startD.setDate(d.getDate() - (dWeekDay - minDay));
      const endD = new Date(d); endD.setDate(d.getDate() + (maxDay - dWeekDay));
      return { start: todayStr(startD), end: todayStr(endD) };
  }
  // 傳統整週循環
  const startD = new Date(d); startD.setDate(d.getDate() - dWeekDay + 1);
  const endD = new Date(startD); endD.setDate(startD.getDate() + 6);
  return { start: todayStr(startD), end: todayStr(endD) };
}

/* ══ 自動計算獎勵 (單數為0清除、精準差額發放) ══ */
function calcAutoReward() {
  const platId = S.selPlatformId;
  const dStr = document.getElementById('f-date') ? document.getElementById('f-date').value : todayStr();
  const curOrders = pf(document.getElementById('f-orders') ? document.getElementById('f-orders').value : 0);
  const bonusEl = document.getElementById('f-bonus');

  if(!platId || !dStr) return;

  // 當單數小於等於 0 (或被清除) 時，清空固定獎勵欄位並停止計算
  if (curOrders <= 0) {
     bonusEl.value = '';
     return;
  }

  let totalAutoBonus = 0;
  
  (S.settings.rewards ||[]).forEach(r => {
    if(r.platformId !== platId) return;
    const rWindow = getRewardWindow(dStr, r);
    if(!rWindow) return;
    
    // 👉 確保目前輸入的這筆單，日期真的落在這個獎勵區間內
    if (dStr < rWindow.start || dStr > rWindow.end) return;

    let accum = 0;
    S.records.forEach(rec => {
        if(rec.id === S.editingId || rec.platformId !== platId || rec.isPunchOnly) return;
        if(rec.date >= rWindow.start && rec.date <= rWindow.end) accum += pf(rec.orders);
    });
    
    const newTotal = accum + curOrders;
    let achievedBonus = 0;
    let previousHighest = 0;

    (r.tiers ||[]).forEach(t => {
        if(accum >= pf(t.orders)) previousHighest = Math.max(previousHighest, pf(t.amount));
        if(newTotal >= pf(t.orders)) achievedBonus = Math.max(achievedBonus, pf(t.amount));
    });

    if (achievedBonus > previousHighest) {
        totalAutoBonus += (achievedBonus - previousHighest);
    }
  });

  if(totalAutoBonus > 0) {
      if(!bonusEl.value || pf(bonusEl.value) === 0) {
          bonusEl.value = totalAutoBonus;
          toast(`🎁 達標！自動帶入獎金差額 $${totalAutoBonus}`);
      }
  }
}

function addWeatherTag(tag) { const noteEl = document.getElementById('f-note'); if (!noteEl.value.includes(tag)) { noteEl.value = (noteEl.value + ' ' + tag).trim(); } }

async function confirmAddRecord() {
  const checkImg = document.getElementById('add-save-img'); const checkBtn = document.getElementById('add-save-btn');
  if (checkBtn.disabled) return; if (!S.selPlatformId) { toast('請先選擇平台'); return; }
  
  let rec = { id: S.editingId || newId(), platformId: S.selPlatformId };

  if (S.addTab === 'cashtip') {
    const amt = pf(document.getElementById('f-ct-amount').value);
    if (amt <= 0) { toast('請輸入現金小費金額'); return; }
    rec = { ...rec, isCashTip: true, date: document.getElementById('f-ct-date').value, time: document.getElementById('f-ct-time').value, givenAmt: pf(document.getElementById('f-ct-given').value), costAmt: pf(document.getElementById('f-ct-cost').value), cashTipAmt: amt, note: document.getElementById('f-ct-note').value.trim() };
  } else {
    const income = pf(document.getElementById('f-income').value); const bonus = pf(document.getElementById('f-bonus').value); const temp = pf(document.getElementById('f-temp-bonus').value); const tips = pf(document.getElementById('f-tips').value);
    if (income + bonus + temp + tips <= 0) { toast('請輸入至少一項收入金額'); return; }
    const h = pf(document.getElementById('f-hrs-val').value); const m = pf(document.getElementById('f-min-val').value); const totalHours = h + (m / 60);

    // 👇 讀取使用者設定的時間
    const recTime = document.getElementById('f-time') ? document.getElementById('f-time').value : nowTime();

    rec = { ...rec, isCashTip: false, date: document.getElementById('f-date').value || todayStr(), time: recTime, punchIn: '', punchOut: '', hours: totalHours, orders: pf(document.getElementById('f-orders').value), income, bonus, tempBonus: temp, tips, note: document.getElementById('f-note').value.trim(), syncStatus: 0, updatedAt: Date.now() };
  }
  
  /* 尋找 confirmAddRecord() 函式，替換其下半部程式碼 */
  if (S.editingId) {
    const ok = await customConfirm('是否確認要儲存修改後的記錄？'); if (!ok) return;
  }

  checkBtn.disabled = true; 
  // 啟動 2 秒進度條動畫
  runSaveProgress(() => {
    if (S.editingId) { 
      const idx = S.records.findIndex(r => r.id === S.editingId); 
      if (idx >= 0) S.records[idx] = rec; 
      toast('✅ 記錄已更新'); 
    } else { 
      S.records.push(rec); 
      toast('✅ 記錄成功！'); 
    }
    saveRecords(); 
    resetAddForm(); // 👈 加入這行，儲存後清空表單
    checkImg.src = 'images/Check1.png';
    checkBtn.disabled = false; 
    goPage('home');
  });
}

/* ══ 背景同步功能 (Offline-First 核心) ══ */
async function backgroundSync() {
  // 1. 沒登入或沒網路時，直接終止，等下次有網路再說
  if (!USER.loggedIn || !navigator.onLine) return;

  // 2. 從 LocalStorage 撈出所有「未同步」的記錄
  const pendingRecords = S.records.filter(r => r.syncStatus === 0);
  
  if (pendingRecords.length === 0) return; // 全部都同步過了，沒事做

  console.log(`準備在背景同步 ${pendingRecords.length} 筆資料...`);

  try {
    // 3. 發送給 Cloudflare Worker API
    const res = await fetch(`${API_BASE_URL}/sync`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        // 👇 新增這行：把 Token 放在正確的位置送出
        'Authorization': `Bearer ${USER.token}` 
      },
      body: JSON.stringify({
        records: pendingRecords // email 也不用傳了，後端會從 token 自己抓
      })
    });
    
    const data = await res.json();

    if (data.success) {
      // 4. 伺服器回傳成功！把這些資料在手機端標記為「已同步 (syncStatus: 1)」
      S.records.forEach(r => {
        if (data.syncedIds.includes(r.id)) {
          r.syncStatus = 1; // 標記為已同步
        }
      });
      await saveRecords();
      console.log('✅ 背景同步完成！');
    }
  } catch (error) {
    console.warn('背景同步失敗，將在下次開啟時重試', error);
  }
}

function cancelAddRecord() {
  if (S.editingId) { S.editingId = null; goPage('history'); } else { goPage('home'); }
}
/* ══ 4. 新增記錄 結束 ════════════════════════════════════ */

/* ══ 5. 收入分析 開始 ════════════════════════════════════ */
function renderReport() {
  if (!S.trendDate) S.trendDate = new Date();
  if (S.rptView === 'overview') renderRptOverview(); 
  if (S.rptView === 'rewards') renderRptRewards(); // 👈 加入這行
  if (S.rptView === 'trend') renderRptTrend();
  if (S.rptView === 'compare') renderRptCompare(); 
  if (S.rptView === 'top3') renderRptTop3();
}

/* ══ 替換：獎勵分析 (今日/即將到來 精準推算與排序) ══ */
function renderRptRewards() {
  const el = document.getElementById('rv-rewards');
  if (!S.rewardSubTab) S.rewardSubTab = 'current';

  let html = `
    <div class="slide-tabs tabs-2" style="margin-bottom:12px;">
      <div class="slide-bg" style="transform: translateX(${S.rewardSubTab === 'current' ? '0%' : '100%'}); background:var(--acc);"></div>
      <button class="slide-btn ${S.rewardSubTab === 'current' ? 'active' : ''}" onclick="S.rewardSubTab='current'; renderRptRewards()">今日進度</button>
      <button class="slide-btn ${S.rewardSubTab === 'upcoming' ? 'active' : ''}" onclick="S.rewardSubTab='upcoming'; renderRptRewards()">即將到來</button>
    </div>
    <div style="font-size:12px; color:var(--hint-color); margin-bottom:12px; text-align:center; font-weight:700;">
      ${S.rewardSubTab === 'current' ? '顯示「包含今日」生效中之獎勵進度' : '顯示「下一個獎勵起，至下週日」之即將到來獎勵'}
    </div>`;

  // ✅ 每次切換都重新取得當下最新時間，跨日不漏接
  const today = new Date(); today.setHours(0,0,0,0);
  const dayOfWeek = today.getDay() || 7;
  const dStrToday = todayStr(today);
  
  // 推算本週一與下週日
  const currentMon = new Date(today); currentMon.setDate(today.getDate() - dayOfWeek + 1);
  const nextSunday = new Date(today); nextSunday.setDate(today.getDate() + (7 - dayOfWeek) + 7);
  const dStrNextSun = todayStr(nextSunday);

  let activeRewards = [];

  (S.settings.rewards ||[]).forEach(r => {
    let windowsToCheck =[];
    if (r.recurring) {
        // 推算本週與下週的該獎勵區間
        windowsToCheck.push(getRewardWindow(todayStr(currentMon), r));
        let nextWeekD = new Date(currentMon); nextWeekD.setDate(currentMon.getDate() + 7);
        windowsToCheck.push(getRewardWindow(todayStr(nextWeekD), r));
    } else {
        windowsToCheck.push({start: r.startDate, end: r.endDate});
    }

    let uniqueWindows =[];
    windowsToCheck.filter(Boolean).forEach(w => {
        if(!uniqueWindows.find(uw => uw.start === w.start && uw.end === w.end)) uniqueWindows.push(w);
    });

    uniqueWindows.forEach(w => {
        let isValid = false;
        
        if (S.rewardSubTab === 'current') {
            // 👉 今日進度邏輯：區間「包含今天」
            if (w.start <= dStrToday && w.end >= dStrToday) isValid = true;
        } else {
            // 👉 即將到來邏輯：區間的「開始日」必須「大於今天」，且「<= 下週日」
            if (w.start > dStrToday && w.start <= dStrNextSun) isValid = true;
        }

        if (isValid) {
            let accum = 0;
            S.records.forEach(rec => {
                if(rec.isPunchOnly || rec.platformId !== r.platformId) return;
                if(rec.date >= w.start && rec.date <= w.end) accum += pf(rec.orders);
            });
            activeRewards.push({ ...r, window: w, accum });
        }
    });
  });

  // 👉 依照區間的開始日 (由早到晚) 排序
  activeRewards.sort((a,b) => a.window.start.localeCompare(b.window.start));

  if (activeRewards.length === 0) {
    el.innerHTML = html + `<div class="empty-tip">本區間無相符的獎勵設定</div>`;
    return;
  }

  // 渲染獎勵卡片迴圈
  activeRewards.forEach(r => {
    const plat = getPlatform(r.platformId);
    let nextTierOrders = null; let prevTierOrders = 0; let achievedBonus = 0;
    
    let tiersHtml = `<div style="display:flex; align-items:center; gap:3px; flex-wrap:wrap; margin-top:12px;">`;
    const sortedTiers =[...(r.tiers || [])].sort((a,b) => a.orders - b.orders);
    sortedTiers.forEach((t, i) => {
      const isPassed = r.accum >= t.orders;
      if (isPassed) { achievedBonus = Math.max(achievedBonus, t.amount); prevTierOrders = t.orders; }
      if (!isPassed && nextTierOrders === null) nextTierOrders = t.orders;
      
      const bgColor = isPassed ? plat.color : 'var(--bg-input)';
      const textColor = isPassed ? '#fff' : 'var(--t3)';
      const arrowColor = isPassed ? plat.color : 'var(--t3)';
      
      tiersHtml += `<span style="background:${bgColor}; color:${textColor}; padding:2px 4px; border-radius:6px; font-size:10px; font-weight:800; font-family:var(--mono); transition:0.3s; letter-spacing:-0.3px;">${t.orders}單 $${t.amount}</span>`;
      if (i < sortedTiers.length - 1) tiersHtml += `<span style="color:${arrowColor}; font-size:10px; font-weight:900; margin: 0 -1px;">➔</span>`;
    });
    tiersHtml += `</div>`;

    let progressPct = 100;
    if (nextTierOrders !== null) {
      progressPct = Math.max(0, Math.min(100, Math.round(((r.accum - prevTierOrders) / (nextTierOrders - prevTierOrders)) * 100)));
    }
    
    let statusText = nextTierOrders !== null 
      ? `差 <span style="color:var(--red); font-size:16px;">${nextTierOrders - r.accum}</span> 單晉級` 
      : `<span style="color:var(--green);">🎉 已達成最高階！</span>`;

    html += `
      <div class="card" style="border: 2px solid ${plat.color}40;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <span style="background:${plat.color}; color:#fff; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">${safeText(plat.name)}</span>
              <span style="font-size:14px; font-weight:800; color:var(--t1);">${safeText(r.name)}</span>
            </div>
            <div style="font-size:11px; color:var(--t3); font-family:var(--mono);">📅 ${r.window.start} ~ ${r.window.end}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:var(--t3); font-weight:700;">目前累積獎金</div>
            <div style="font-family:var(--mono); font-size:20px; font-weight:900; color:var(--acc);">$${achievedBonus}</div>
          </div>
        </div>
        
        <div style="margin:12px 0;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:6px;">
            <span style="color:var(--t1);">目前單數：<span style="font-family:var(--mono); font-size:16px; color:var(--blue);">${r.accum}</span> 單</span>
            <span style="font-weight:800;">${statusText}</span>
          </div>
          <div class="progress-track" style="height:12px; background:var(--bg-input); border-radius:12px;">
            <div class="progress-fill" style="width:${progressPct}%; background:linear-gradient(90deg, ${plat.color}80, ${plat.color}); border-radius:12px;"></div>
          </div>
        </div>
        ${tiersHtml}
      </div>
    `;
  });
  el.innerHTML = html;
}

window.navRptMonth = function(dir) {
  S.rptM += dir;
  if(S.rptM < 1) { S.rptM = 12; S.rptY--; }
  if(S.rptM > 12) { S.rptM = 1; S.rptY++; }
  renderReport();
}

/* ══ 替換：趨勢導航時間切換 ══ */
window.navTrend = function(dir) {
  let d = new Date(S.trendDate || new Date());
  if (S.trendMode === 'week') d.setDate(d.getDate() + dir * 7);
  else if (S.trendMode === '4week') d.setDate(d.getDate() + dir * 28); // 👈 加入4週(28天)切換
  else if (S.trendMode === 'month') d.setMonth(d.getMonth() + dir);
  else if (S.trendMode === 'year') d.setFullYear(d.getFullYear() + dir);
  S.trendDate = d;
  renderRptTrend();
}
document.getElementById('rpt-prev').addEventListener('click', ()=>{ S.rptM--; if(S.rptM<1){S.rptM=12;S.rptY--;} renderReport(); });
document.getElementById('rpt-next').addEventListener('click', ()=>{ S.rptM++; if(S.rptM>12){S.rptM=1;S.rptY++;} renderReport(); });

/* ══ 替換：收入總覽頁面 (修復空白問題、套用淨行程與同排佔比) ══ */
function renderRptOverview() {
  if (!S.rptOverviewFilter) S.rptOverviewFilter = 'all';
  const allMonthRecs = getMonthRecs(S.rptY, S.rptM);
  
  // 依照選擇的標籤過濾資料
  const isAll = S.rptOverviewFilter === 'all';
  const recs = isAll ? allMonthRecs : allMonthRecs.filter(r => r.platformId === S.rptOverviewFilter);
  
  const total = recs.reduce((s,r) => s+recTotal(r), 0); 
  const income = recs.reduce((s,r) => s+pf(r.income), 0); // 這是淨行程
  const bonus = recs.reduce((s,r) => s+pf(r.bonus)+pf(r.tempBonus), 0); 
  const tips = recs.reduce((s,r) => s+pf(r.tips), 0);
  const orders = recs.reduce((s,r) => s+pf(r.orders), 0); 
  const hours = recs.reduce((s,r) => s+pf(r.hours), 0);
  const cashTipTotal = recs.filter(r=>r.isCashTip).reduce((s,r)=>s+pf(r.cashTipAmt), 0);

  const activePlats = S.platforms.filter(p=>p.active);
  let filterName = isAll ? '全部平台' : safeText(activePlats.find(p=>p.id===S.rptOverviewFilter)?.name || '');

  const avgOrd = orders > 0 ? Math.round(total / orders) : 0;
  const ordHr = hours > 0 ? (orders / hours).toFixed(1) : 0;
  const avgHr = hours > 0 ? Math.round(total / hours) : 0;

  // 👇 基本工資分析邏輯
  let wageHtml = '';
  if (hours > 0) {
    let wageStatus = ''; let wageColor = ''; let wageBg = '';
    if (avgHr <= 154) { wageStatus = ' 😭 嚴重低於基本工資 '; wageColor = 'var(--red)'; wageBg = 'var(--red-d)'; } 
    else if (avgHr <= 175) { wageStatus = ' ⚠️⚠️ 低於基本工資 '; wageColor = 'var(--acc2)'; wageBg = 'var(--acc-d)'; } 
    else if (avgHr <= 195) { wageStatus = ' ⚠️ 略低於基本工資 '; wageColor = 'var(--blue)'; wageBg = 'var(--blue-d)'; } 
    else { wageStatus = ' 🎉 符合基本工資 '; wageColor = 'var(--green)'; wageBg = 'var(--green-d)'; }
    wageHtml = `<div style="margin-top:6px;"><span style="background:${wageBg}; color:${wageColor}; font-size:12px; padding:6px 5px; border-radius:5px; font-weight:800; letter-spacing:0px; white-space:nowrap; display:inline-block; line-height:1;">${wageStatus}</span></div>`;
  }

  // 頂部導航
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
      <button class="mbtn" onclick="navRptMonth(-1)">◀</button>
      <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${S.rptY} 年 ${S.rptM} 月</span>
      <button class="mbtn" onclick="navRptMonth(1)">▶</button>
    </div>`;

  // 計算佔比 (將邏輯移到字串外面，修復錯誤)
  const incPct = total > 0 ? Math.round((income / total) * 100) : 0;
  const bonPct = total > 0 ? Math.round((bonus / total) * 100) : 0;
  const tipPct = total > 0 ? Math.round((tips / total) * 100) : 0;

  // 收入分析，本月總收入框
  html += `
    <div style="background: var(--sf); border:2px solid var(--card-border); border-radius:12px; position:relative; box-shadow:0 4px 12px rgba(0,0,0,0.03); margin-bottom:10px; overflow:hidden;">

      <div id="rpt-overview-col-btn" onclick="toggleSummaryCard('rpt-overview-col')" style="position:absolute; top:12px; right:12px; width:35px; height:35px; background: hsla(320, 75%, 34%, 0.50); border-radius:50%; color: hsl(320, 100%, 34%); display:flex; align-items:center; justify-content:center; font-size:25px; cursor:pointer; transition:transform 0.3s; font-weight:900; z-index:2; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">▼</div>
      
      <div onclick="toggleSummaryCard('rpt-overview-col')" style="padding:10px 0px; cursor:pointer; text-align:center;">
        <div style="font-size:16px; font-weight:900; color: #ff0000; margin-bottom:6px;">${filterName} <span style="font-size:14px; font-weight:800; color: var(--t2);">本月總收入</span></div>
        <div style="font-family:var(--mono); font-size:39px; font-weight:900; color: #1E90FF; line-height:1;">$ ${fmt(total)}</div>
        
        <div style="display:flex; justify-content:center; gap:5px; margin-top:8px; flex-wrap:wrap; text-align:center; padding: 0 10px;">
          <div style="flex:1; background: rgba(34, 197, 94, 0.15); color: var(--green); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            淨行程<br>
            <span style="color: #1f9c4d; font-size:15px; font-weight:800;">$ ${fmt(income)}</span>
            <span style="font-size:11px; opacity:0.75; font-weight:600;">(${incPct}%)</span>
          </div>
          <div style="flex:1; background: rgba(245,158,11,0.15); color: hsl(25, 100%, 59%); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            獎勵<br>
            <span style="color: #ff7715; font-size:15px; font-weight:800;">$ ${fmt(bonus)}</span>
            <span style="font-size:11px; font-weight:600;">(${bonPct}%)</span>
          </div>
          <div style="flex:1; background: rgba(190, 59, 246, 0.15); color: rgba(137, 43, 226, 0.9); padding:2px 2px; border-radius:8px; font-size:12px; font-weight:500; font-family:var(--mono);">
            小費<br>
            <span style="color: #8A2BE2; font-size:15px; font-weight:800;">$ ${fmt(tips)}</span>
            <span style="font-size:11px; opacity:0.75; font-weight:600;">(${tipPct}%)</span>
          </div>
        </div>
      </div> 
      <div style="border-top:2px dashed var(--blue); margin-bottom:1px;"></div>

      <div id="rpt-overview-col" style="max-height:0px; overflow:hidden; transition: max-height 0.35s ease; background: #ffffff;">
        <div style="padding:12px 3px 5px 3px; display:flex; justify-content:center; align-items:flex-start; font-size:12px; font-weight:700; color: #000000; width:100%;">
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            一單：<span style="font-family:var(--mono); color: var(--text-cyan); font-size:20px; font-weight:800;">$ ${fmt(avgOrd)}</span>
          </div>
          <div class="h-div" style="height:45px; align-self:center;"></div>
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            1 h： <span style="font-family:var(--mono); color: var(--text-red); font-size:20px; font-weight:800;">${ordHr} <small style="color: rgb(185, 56, 255);font-size:11px; font-weight:500;">單</small></span>
          </div>
          <div class="h-div" style="height:45px; align-self:center;"></div>
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            時薪 $： <span style="font-family:var(--mono); color: var(--text-blue); font-size:20px; font-weight:800;">${fmt(avgHr)}</span>
            ${wageHtml}
          </div>
        </div>
        ${cashTipTotal > 0 ? `
        <div style="border-top:1px dashed var(--border);"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 16px;">
          <span style="background: rgba(22,163,74,0.2); color: var(--green); font-size:11px; padding:4px 8px; border-radius:8px; font-weight:700;">現金小費 (不計總收)</span>
          <span style="font-family:var(--mono); font-size:16px; font-weight:800; color: var(--green);">$${fmt(cashTipTotal)}</span>
        </div>` : ''}
      </div>
    </div>`;

  // --- 後面的「結構佔比分析卡片 (包含平台切換與圓餅圖)」保持不變 ---

  // 結構佔比分析卡片 (包含平台切換與圓餅圖)
  html += `<div class="card" style="border:1.5px solid var(--card-border);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <div style="font-size:13px; font-weight:800; color:var(--t2);">📊 結構佔比分析</div>
    </div>`;

  // 將平台切換按鈕放在卡片內部
  html += `<div style="display:flex; gap:8px; margin-bottom:16px; overflow-x:auto; padding-bottom:4px;">
    <button onclick="S.rptOverviewFilter='all'; renderReport()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isAll ? 'background:var(--acc); color:#fff; box-shadow:0 2px 6px rgba(255,107,53,0.3);' : 'background:var(--sf2); color:var(--t2);'}">全部</button>`;
  activePlats.forEach(p => {
    let isActive = S.rptOverviewFilter === p.id;
    html += `<button onclick="S.rptOverviewFilter='${safeText(p.id)}'; renderReport()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isActive ? `background:${p.color}; color:#fff; box-shadow:0 2px 6px ${p.color}50;` : `background:${p.color}15; color:${p.color};`}">${safeText(p.name)}</button>`;
  });
  html += `</div>`;

  // 圓餅圖與列表分析邏輯
  let pieLabels = [], pieData = [], pieColors = [], listHtml = '';
  
  if (isAll && total > 0) {
    const platData = activePlats.map(p => ({ name: p.name, color: p.color, val: recs.filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0) })).filter(p=>p.val>0);
    pieLabels = platData.map(p=>p.name); pieData = platData.map(p=>p.val); pieColors = platData.map(p=>p.color);
    
    listHtml = platData.map(p => {
      const pct = Math.round(p.val / total * 100);
      return `<div style="display:flex; align-items:center; padding:8px 0; border-bottom:1px solid #f3f4f6;">
        <div style="width:12px; height:12px; border-radius:4px; background:${p.color}; margin-right:10px;"></div>
        <span style="flex:1; font-size:13px; font-weight:700; color:var(--t1);">${safeText(p.name)}</span>
        <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:var(--blue); width:50px; text-align:right;">${pct}%</span>
        <span style="font-family:var(--mono); font-size:14px; font-weight:900; color:var(--t1); width:80px; text-align:right;">$${fmt(p.val)}</span>
      </div>`;
    }).join('');
  } else if (!isAll && total > 0) {
    pieLabels = ['行程', '獎勵', '小費']; pieData = [income, bonus, tips]; pieColors = ['#22c55e', '#f59e0b', '#3b82f6'];
    const details = [{ name: '行程收入', val: income, color: '#22c55e' }, { name: '獎勵金額', val: bonus, color: '#f59e0b' }, { name: 'APP小費', val: tips, color: '#3b82f6' }].filter(d => d.val > 0);
    
    listHtml = details.map(d => {
      const pct = Math.round(d.val / total * 100);
      return `<div style="display:flex; align-items:center; padding:8px 0; border-bottom:1px solid #f3f4f6;">
        <div style="width:12px; height:12px; border-radius:4px; background:${d.color}; margin-right:10px;"></div>
        <span style="flex:1; font-size:13px; font-weight:700; color:var(--t1);">${safeText(d.name)}</span>
        <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:var(--blue); width:50px; text-align:right;">${pct}%</span>
        <span style="font-family:var(--mono); font-size:14px; font-weight:900; color:var(--t1); width:80px; text-align:right;">$${fmt(d.val)}</span>
      </div>`;
    }).join('');
  }

  if (total > 0) {
    html += `
      <div style="position:relative; height:180px; margin-bottom:16px;">
        <canvas id="plat-pie"></canvas>
      </div>
      <div style="display:flex; flex-direction:column;">
        <div style="display:flex; align-items:center; padding:8px 0; border-bottom:2px solid var(--border);">
          <span style="flex:1; font-size:12px; font-weight:800; color:var(--t3);">項目</span>
          <span style="font-size:12px; font-weight:800; color:var(--t3); width:50px; text-align:right;">佔比</span>
          <span style="font-size:12px; font-weight:800; color:var(--t3); width:80px; text-align:right;">金額</span>
        </div>
        ${listHtml}
        <div style="display:flex; align-items:center; padding:12px 0 4px;">
          <span style="flex:1; font-size:14px; font-weight:900; color:var(--acc);">總計</span>
          <span style="font-family:var(--mono); font-size:14px; font-weight:900; color:var(--t3); width:50px; text-align:right;">100%</span>
          <span style="font-family:var(--mono); font-size:16px; font-weight:900; color:var(--acc); width:80px; text-align:right;">$${fmt(total)}</span>
        </div>
      </div>`;
  } else {
    html += `<div class="empty-tip" style="padding:16px 0;">所選平台本區間無記錄</div>`;
  }

  html += `</div>`; // 結束佔比卡片

  document.getElementById('rv-overview').innerHTML = html;
  
  if (total > 0 && pieData.length > 0) {
    drawPie('plat-pie', pieLabels, pieData, pieColors);
  }
}

/* ══ 替換：完整趨勢分析圖表 (加入 4 週趨勢) ══ */
function renderRptTrend() {
  const el = document.getElementById('rv-trend');
  if (!S.trendDate) S.trendDate = new Date();
  const td = new Date(S.trendDate);
  let navLabel = '';

  const trends =[
    { key:'week',  label:'週趨勢',   getDays: () => { 
        const day = td.getDay() || 7; 
        const start = new Date(td); start.setDate(start.getDate() - day + 1);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        navLabel = `${pad(start.getMonth()+1)}/${pad(start.getDate())} ~ ${pad(end.getMonth()+1)}/${pad(end.getDate())}`;
        return Array.from({length:7}, (_,i)=>{
           const nd = new Date(start); nd.setDate(nd.getDate() + i);
           return `${nd.getFullYear()}-${pad(nd.getMonth()+1)}-${pad(nd.getDate())}`;
        });
      }
    },
    { key:'4week', label:'4週趨勢',  getDays: () => { 
        const day = td.getDay() || 7; 
        const start = new Date(td); start.setDate(start.getDate() - day + 1 - 21); // 回推 3 週
        const end = new Date(td); end.setDate(end.getDate() - day + 7);
        navLabel = `${pad(start.getMonth()+1)}/${pad(start.getDate())} ~ ${pad(end.getMonth()+1)}/${pad(end.getDate())}`;
        return []; 
      }
    },
    { key:'month', label:'月趨勢',   getDays: () => { 
        navLabel = `${td.getFullYear()} 年 ${td.getMonth()+1} 月`;
        const n=new Date(td.getFullYear(), td.getMonth()+1, 0).getDate(); 
        return Array.from({length:n},(_,i)=>`${td.getFullYear()}-${pad(td.getMonth()+1)}-${pad(i+1)}`); 
      } 
    },
    { key:'year',  label:'年趨勢',    getDays: () => { 
        navLabel = `${td.getFullYear()} 年`;
        return Array.from({length:12},(_,i)=>null); 
      } 
    }
  ];
  
  const curT = S.trendMode || 'month'; 
  const trend = trends.find(t=>t.key===curT) || trends[2]; // 預設使用月趨勢
  const days = trend.getDays(); 

  let html = `<div style="display:flex;gap:6px;margin-bottom:10px">
    ${trends.map(t=>`<button onclick="S.trendMode='${t.key}';renderRptTrend()" style="flex:1;padding:6px;border-radius:var(--rs);border:1px solid ${curT===t.key?'var(--acc)':'var(--border)'};background:${curT===t.key?'var(--acc-d)':'var(--bg-input)'};color:${curT===t.key?'var(--acc)':'var(--t2)'};font-size:12px;cursor:pointer;font-family:var(--sans);font-weight:${curT===t.key?'700':'500'}">${t.label}</button>`).join('')}
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
    <button class="mbtn" onclick="navTrend(-1)">◀</button>
    <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${navLabel}</span>
    <button class="mbtn" onclick="navTrend(1)">▶</button>
  </div>`;

  const plats = S.platforms.filter(p=>p.active);
  
  if (curT === 'year') {
    const labels = Array.from({length:12},(_,i)=>`${i+1}月`);
    const datasets =[];
    plats.forEach(p => {
      const data = Array.from({length:12}, (_,i)=> getMonthRecs(td.getFullYear(), i+1).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    const allTotal = S.records.filter(r=>r.date.startsWith(`${td.getFullYear()}-`)).reduce((s,r)=>s+recTotal(r),0);
    html += `<div class="card"><div style="height:260px; position:relative;"><canvas id="trend-chart"></canvas></div><div class="rpt-divider" style="margin-top:16px; margin-bottom:8px"></div><div class="rpt-total-row"><span class="rt-lbl gray">全年總收入</span><span class="rt-val" style="color:var(--green)">NT$ ${fmt(allTotal)}</span></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets);
  } 
  else if (curT === '4week') {
    // 獨立處理 4 週的繪圖資料
    const labels = [];
    const datasets =[];
    const weekRanges =[];
    
    const day = td.getDay() || 7; 
    const endOfThisWeek = new Date(td); endOfThisWeek.setDate(endOfThisWeek.getDate() + (7 - day));

    for (let w=3; w>=0; w--) {
      const startD = new Date(endOfThisWeek); startD.setDate(startD.getDate() - 6 - w*7);
      const endD = new Date(startD); endD.setDate(endD.getDate() + 6);
      labels.push(`${pad(startD.getMonth()+1)}/${pad(startD.getDate())} 起`); 
      weekRanges.push({ start: startD, end: endD });
    }

    plats.forEach(p => {
      const data = weekRanges.map(wt => {
        const sStr = `${wt.start.getFullYear()}-${pad(wt.start.getMonth()+1)}-${pad(wt.start.getDate())}`;
        const eStr = `${wt.end.getFullYear()}-${pad(wt.end.getMonth()+1)}-${pad(wt.end.getDate())}`;
        return S.records.filter(r => r.platformId === p.id && r.date >= sStr && r.date <= eStr && !r.isPunchOnly).reduce((s,r)=>s+recTotal(r),0);
      });
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    
    html += `<div class="card"><div style="height:260px; position:relative;"><canvas id="trend-chart"></canvas></div></div>`;
    el.innerHTML = html; 
    drawTrendBar('trend-chart', labels, datasets);
  }
  else if (curT === 'month') {
    const days1 = days.slice(0, 15); const days2 = days.slice(15);
    const labels1 = days1.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const labels2 = days2.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const datasets1 = []; const datasets2 =[];
    plats.forEach(p => {
      const data1 = days1.map(d=> getDayRecs(d).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      const data2 = days2.map(d=> getDayRecs(d).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data1.some(v => v > 0) || data2.some(v => v > 0)) { datasets1.push({ label: p.name, data: data1, backgroundColor: p.color, borderRadius: 4 }); datasets2.push({ label: p.name, data: data2, backgroundColor: p.color, borderRadius: 4 }); }
    });
    html += `<div class="card" style="margin-bottom:12px;"><div style="font-size:12px; font-weight:700; color:var(--t3); margin-bottom:8px;">上旬 (1-15日)</div><div style="height:220px; position:relative;"><canvas id="trend-chart-1"></canvas></div></div><div class="card"><div style="font-size:12px; font-weight:700; color:var(--t3); margin-bottom:8px;">下旬 (16-月底)</div><div style="height:220px; position:relative;"><canvas id="trend-chart-2"></canvas></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart-1', labels1, datasets1, true, null); drawTrendBar('trend-chart-2', labels2, datasets2, false, null);
  }
  else {
    const labels = days.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const datasets =[];
    plats.forEach(p => {
      const data = days.map(d=> getDayRecs(d).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    html += `<div class="card"><div style="height:260px; position:relative;"><canvas id="trend-chart"></canvas></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets);
  }
}

/* ══ 替換：修復趨勢圖表繪製 (加入平滑總收入趨勢線) ══ */
function drawTrendBar(canvasId, labels, datasets, showLegend = true, maxScale = null) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  
  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--chart-text').trim() || '#1C1917';
  
  // 將柱狀圖順序往後移，讓折線畫在最上面
  datasets.forEach(ds => ds.order = 1);

  // 1. 計算每天的總合，用來畫趨勢線
  const totalData = labels.map((_, i) => {
    return datasets.reduce((sum, ds) => sum + (ds.data[i] || 0), 0);
  });

  // 2. 建立趨勢線資料集 (使用紫色凸顯)
  const lineDataset = {
    type: 'line',
    label: '總收入趨勢',
    data: totalData,
    borderColor: '#8B5CF6', 
    backgroundColor: '#8B5CF6',
    borderWidth: 2,
    tension: 0.4, // 設定曲線平滑度
    pointRadius: 2.5,
    pointBackgroundColor: '#fff',
    fill: false,
    order: 0 // 畫在最上方
  };

  // 將趨勢線加進資料中
  const combinedDatasets = [...datasets];
  if (datasets.length > 0) combinedDatasets.push(lineDataset);

  const topTotalPlugin = {
    id: 'topTotalPlugin',
    afterDatasetsDraw: (chart) => {
      const ctx = chart.ctx;
      chart.data.labels.forEach((_, i) => {
        let total = 0; let meta;
        chart.data.datasets.forEach((dataset, j) => {
          // 略過趨勢線，只計算柱狀體數值
          if (dataset.type === 'line') return;
          meta = chart.getDatasetMeta(j);
          if (!meta.hidden) total += dataset.data[i];
        });
        if (total > 0 && meta) {
          const finalModel = meta.data[i];
          ctx.save();
          ctx.fillStyle = textColor; 
          ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
          // 把數字往上推一點，避免跟趨勢線的點擠在一起
          ctx.fillText(fmt(total), finalModel.x, finalModel.y - 8);
          ctx.restore();
        }
      });
    }
  };

  const yOpts = { 
    stacked: true, beginAtZero: true, suggestedMax: maxScale || 500, 
    ticks: { color: textColor, callback: v => v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : v, font: { size: 10 } }, 
    grid: { color: 'rgba(0,0,0,.05)', drawBorder: false } 
  };
  if (maxScale) yOpts.max = maxScale;
  
  const xOpts = { stacked: true, ticks: { color: textColor, font: { size: 9 }, maxRotation: 0, autoSkip: false }, grid: { display: false } };

  S.charts[canvasId] = new Chart(ctx, { 
    type: 'bar', // 主體依然是柱狀圖
    data: { labels, datasets: combinedDatasets }, 
    plugins: [topTotalPlugin],
    options: { 
      responsive: true, maintainAspectRatio: false, 
      layout: { padding: { top: 20 } }, // 上方多留白一點給數字
      plugins: { 
        legend: { display: showLegend, position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } }, 
        tooltip: { mode: 'index', intersect: false, callbacks: { label: c => `${c.dataset.label}: NT$ ${fmt(c.parsed.y)}` } } 
      }, 
      scales: { x: xOpts, y: yOpts }, 
      animation: { duration: 400 } 
    } 
  });
}

/* ══ 替換：同儕比較功能 ══ */    
function _initCmpPeriods() {
  if(S.cmpType === 'month') {
    S.cmpPeriods = [`${S.rptY}-${pad(S.rptM)}`, `${S.rptY-1}-${pad(S.rptM)}`, `${S.rptY-2}-${pad(S.rptM)}`];
  } else {
    S.cmpPeriods = [`${S.rptY}`, `${S.rptY-1}`, `${S.rptY-2}`];
  }
}

function renderRptCompare() {
  const el = document.getElementById('rv-compare');
  if(!S.cmpPeriods || S.cmpPeriods.length !== 3) _initCmpPeriods();

  let html = `<div class="card" style="padding-bottom:10px;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <label style="font-size:12px; color:var(--t3); font-weight:700;">比較類型</label>
      <select class="fsel" style="width:auto; padding:6px 10px; font-weight:600;" onchange="S.cmpType=this.value; _initCmpPeriods(); renderReport();">
        <option value="month" ${S.cmpType==='month'?'selected':''}>單月同儕 (自選3個月)</option>
        <option value="year" ${S.cmpType==='year'?'selected':''}>年度比較 (自選3個年)</option>
      </select>
    </div>
    <div style="display:flex; gap:8px;">`;
  
  for(let i=0; i<3; i++) {
    if(S.cmpType==='month') {
      html += `<input type="month" class="fsel" value="${S.cmpPeriods[i]}" onchange="S.cmpPeriods[${i}]=this.value; renderReport();" style="padding:6px 4px; font-size:11px; text-align:center;">`;
    } else {
      html += `<input type="number" class="finp" value="${S.cmpPeriods[i]}" onchange="S.cmpPeriods[${i}]=this.value; renderReport();" style="padding:6px 4px; font-size:13px; text-align:center; font-weight:600;">`;
    }
  }
  html += `</div></div>`;

  let comparisons = S.cmpPeriods.map((p, i) => {
    let total = 0; let label = '';
    if(S.cmpType === 'month') {
      const parts = p.split('-'); 
      if(parts.length===2) {
         total = getMonthRecs(parts[0], parts[1]).reduce((s,r)=>s+recTotal(r),0);
         label = `${parts[0]}年${parts[1]}月`;
      }
    } else {
      total = S.records.filter(r=>r.date.startsWith(`${p}-`)).reduce((s,r)=>s+recTotal(r),0);
      label = `${p}年`;
    }
    return { label: i===0 ? label + ' (基準)' : label, total, isBase: i===0 };
  });

  const baseVal = comparisons[0].total;
  const maxV = Math.max(...comparisons.map(c=>c.total), 1);

  html += `<div class="card">`;
  comparisons.forEach(c => {
    const pct = maxV>0 ? Math.round(c.total/maxV*100) : 0;
    const diff = c.total - baseVal; 
    let diffStr = diff===0 ? '—' : (diff>0 ? `+NT$ ${fmt(diff)}` : `-NT$ ${fmt(Math.abs(diff))}`);
    if(c.isBase) diffStr = '基準';
    const diffColor = c.isBase ? 'var(--acc)' : (diff>0 ? 'var(--green)' : diff<0 ? 'var(--red)' : 'var(--t3)');
    const barColor = c.isBase ? 'var(--acc)' : 'var(--t3)';
    
    html += `<div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:6px;">
        <span style="font-weight:700;color:${c.isBase?'var(--acc)':'var(--t2)'}">${c.label}</span>
        <div style="display:flex;gap:10px;align-items:baseline;">
          <span style="font-family:var(--mono);font-size:16px;font-weight:800;color:${c.isBase?'var(--green)':'var(--t1)'}">NT$ ${fmt(c.total)}</span>
          <span style="font-size:11px;color:${diffColor};font-weight:700;width:60px;text-align:right;">${diffStr}</span>
        </div>
      </div>
      <div class="progress-track" style="height:10px;"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

/* 替換：將 TOP 3 升級為 TOP 5 */
function renderRptTop3() {
  const el = document.getElementById('rv-top3'); const monthRecs = getMonthRecs(S.rptY, S.rptM); const dayMap = {};
  monthRecs.forEach(r => { dayMap[r.date] = (dayMap[r.date]||0) + recTotal(r); });
  const sorted = Object.entries(dayMap).sort((a,b)=>b[1]-a[1]); 
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣']; // 👈 加入四五名圖示

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
      <button class="mbtn" onclick="navRptMonth(-1)">◀</button>
      <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${S.rptY} 年 ${S.rptM} 月</span>
      <button class="mbtn" onclick="navRptMonth(1)">▶</button>
    </div>`;

  html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:12px">🏆 本月收入 TOP 5 日</div>`;
  if (!sorted.length) { 
    html += `<div class="empty-tip">本月暫無記錄</div>`; 
  } else {
    // 👈 改成 slice(0,5)
    sorted.slice(0,5).forEach(([date,total],i) => {
      const d = new Date(date+'T00:00:00'); const recs = getDayRecs(date); const orders = recs.reduce((s,r)=>s+pf(r.orders),0); const hours = recs.reduce((s,r)=>s+pf(r.hours),0);
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><span style="font-size:28px">${medals[i]||'▶'}</span><div style="flex:1"><div style="font-size:14px;font-weight:600">${date} （${['日','一','二','三','四','五','六'][d.getDay()]}）</div><div style="font-size:11px;color:var(--t3);margin-top:2px">${orders>0?`${orders}單 `:''}${hours>0?`${fmtHours(hours)} `:''}</div></div><div style="font-family:var(--mono);font-size:18px;font-weight:800;color:var(--green)">$${fmt(total)}</div></div>`;
    });
  }
  html += `</div>`;
  el.innerHTML = html;
}

function drawPie(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, { type: 'doughnut', data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#fff' }] }, options: { responsive:true, maintainAspectRatio:false, cutout:'60%', plugins:{ legend:{ display:true, position:'bottom', labels:{font:{size:11},padding:8} } }, animation:{ duration:400 } } });
}

function drawBar(canvasId, labels, data, color) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels, datasets:[{ data, backgroundColor:color+'99', borderRadius:6, borderWidth:0 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} }, scales:{ x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{callback:v=>v>=1000?(v/1000).toFixed(1).replace('.0','')+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} }, animation:{ duration:400 } } });
}
/* ══ 5. 收入分析 結束 ══════════════════════════════════════════ */

/* ══ 6. 車輛管理 開始 ══════════════════════════════════════════ */
function changeVehMonth(offset) { 
  // 若在年總覽或搜尋，切換時直接跳年份
  if (S.vehicleTab === 'yearly' || S.vehicleTab === 'search') {
    S.vehY += offset;
  } else {
    S.vehM += offset; 
    if (S.vehM < 1) { S.vehM = 12; S.vehY--; } 
    if (S.vehM > 12) { S.vehM = 1; S.vehY++; } 
  }
  renderVehicles(); 
}
function selectVehicle(id) { 
  S.selVehicleId = id; 
  _syncVehSelectorActive(id); // 呼叫更新樣式而不重繪
  renderVehicleContent();     // 只重繪下方的詳細紀錄與數據框
}

/* ══ 替換：車輛清單渲染 (排版對齊 11.jpg) ══ */
function renderVehicles() {
  const container = document.getElementById('vehicle-content'); 
  const selectorContainer = document.getElementById('veh-selector-container');
  
  container.style.minHeight = '0';
  container.style.WebkitOverflowScrolling = 'touch';

  const labelEl = document.getElementById('veh-month-label');
  if (S.vehicleTab === 'yearly' || S.vehicleTab === 'search') {
    labelEl.textContent = `${S.vehY} 年 全年`;
  } else {
    labelEl.textContent = `${S.vehY} 年 ${S.vehM} 月`;
  }
  if (S.vehicles.length === 0) { selectorContainer.innerHTML = ''; container.innerHTML = `<div class="empty-tip">請點擊右上角新增車輛</div>`; return; }
  if (!S.selVehicleId || !S.vehicles.find(v => v.id === S.selVehicleId)) { S.selVehicleId = S.vehicles[0].id; }

  let selectorHtml = `<div style="display:flex; gap:16px; overflow-x:auto; padding:4px 4px 8px;" class="hide-scroll">`;
  const fuelMap = { '92':'92 無鉛', '95':'95 無鉛', '98':'98 無鉛', 'electric':'電動車' };

  S.vehicles.forEach(v => {
    const isActive = v.id === S.selVehicleId;
    const fName = fuelMap[v.defaultFuel] || v.defaultFuel; 
    const isEV = v.defaultFuel === 'electric';
    const borderColor = isActive ? (isEV ? '#3b82f6' : 'var(--acc)') : 'transparent';
    const nameColor = isActive ? (isEV ? '#3b82f6' : 'var(--acc)') : 'var(--t2)';
    // 機車圖片數量
    selectorHtml += `<div data-vid="${v.id}" style="position:relative; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:64px; cursor:pointer;" onclick="selectVehicle('${v.id}')">
      <span class="veh-sel-name" style="font-size:12px; font-weight:700; color:${nameColor}; transition:0.2s;">${v.name}</span>
      <div style="position:relative;">
        <div onclick="event.stopPropagation(); deleteVehicle('${v.id}')" style="position:absolute; top:-6px; right:-6px; background:var(--red); color:#fff; border-radius:50%; width:16px; height:16px; font-size:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; box-shadow:0 2px 4px rgba(239,68,68,0.4);">✕</div>
        <div class="veh-sel-icon" style="width:50px; height:50px; border-radius:12px; background:var(--sf); border:2px solid ${borderColor}; display:flex; align-items:center; justify-content:center; box-shadow:${isActive ? '0 4px 10px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'}; transition:0.2s;">
          <img src="scooter/s${(v.icon && v.icon <= 9) ? v.icon : 1}.png" style="width:36px; height:36px; object-fit:contain;">
        </div>
      </div>
      <span style="font-size:11px; font-weight:600; color:var(--t3);">${fName}</span>
      <!-- 👇 新增車輛資訊按鈕 -->
      <span onclick="event.stopPropagation(); openVehInfo('${v.id}')" style="font-size:10px; color:var(--blue); font-weight:700; background:var(--blue-d); padding:2px 8px; border-radius:10px; margin-top:2px;">車輛資訊</span>
    </div>`;
  });
  selectorHtml += `</div>`; 
  selectorContainer.innerHTML = selectorHtml;
  
  renderVehicleContent();
}

function _syncVehSelectorActive(id) {
  // 不重新渲染整個列表 (避免圖片閃爍)，只改變 DOM 元素的樣式
  const container = document.getElementById('veh-selector-container');
  if (!container) return;
  
  const items = container.querySelectorAll('[data-vid]');
  items.forEach(el => {
    const vid = el.getAttribute('data-vid');
    const isActive = vid === id;
    
    const v = S.vehicles.find(x => x.id === vid);
    const isEV = v && v.defaultFuel === 'electric';
    const activeColor = isEV ? '#3b82f6' : 'var(--acc)';
    
    const nameEl = el.querySelector('.veh-sel-name');
    const iconWrap = el.querySelector('.veh-sel-icon');
    
    if (isActive) {
      nameEl.style.color = activeColor;
      iconWrap.style.borderColor = activeColor;
      iconWrap.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
    } else {
      nameEl.style.color = 'var(--t2)';
      iconWrap.style.borderColor = 'transparent';
      iconWrap.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
    }
  });
}

/* ══ 替換：車輛管理內容 (支援月度燃料/保養、年總覽與記錄搜尋) ══ */
function renderVehicleContent() {
  const container = document.getElementById('vehicle-content'); 
  if (!S.selVehicleId) { container.innerHTML = `<div class="empty-tip">請選擇車輛</div>`; return; }
  
  let html = '';

  // ── 1. 記錄搜尋頁籤 ──
  if (S.vehicleTab === 'search') {
    const isEV = S.vehicles.find(x => x.id === S.selVehicleId)?.defaultFuel === 'electric';
    const maintList = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;
    
    html += `
      <div style="background:var(--sf); padding:16px; border-radius:16px; margin-bottom:12px; border:1px solid var(--border); box-shadow:0 2px 8px rgba(0,0,0,0.02);">
        <div class="fg" style="margin-bottom:12px;">
          <label style="font-size:12px; font-weight:700; color:var(--t2);">🔍 搜尋保養/維修項目</label>
          <input type="text" class="finp" id="veh-search-kw" placeholder="請輸入關鍵字或點擊下方標籤..." oninput="doVehSearch()">
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${maintList.map(item => `<div class="item-chip" style="font-size:11px; padding:4px 10px;" onclick="document.getElementById('veh-search-kw').value='${item}'; doVehSearch();">${item}</div>`).join('')}
        </div>
      </div>
      <div id="veh-search-results" style="display:flex; flex-direction:column; gap:8px;">
        <div class="empty-tip">請輸入或點選標籤開始搜尋</div>
      </div>
    `;
    container.innerHTML = html;
    if(document.getElementById('veh-search-kw') && document.getElementById('veh-search-kw').value) doVehSearch();
    return;
  }

  // ── 2. 年總覽頁籤 ──
  if (S.vehicleTab === 'yearly') {
    const yearRecs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.date.startsWith(S.vehY + '-'));
    const isEV = S.vehicles.find(x => x.id === S.selVehicleId)?.defaultFuel === 'electric';
    
    let yDist = 0, yLiters = 0, yFuelAmt = 0, yMaintAmt = 0;
    const itemFreq = {};

    yearRecs.forEach(r => {
      if (r.type === 'fuel') {
        const diff = pf(r.km) - pf(r.prevKm); if (diff > 0) yDist += diff;
        yLiters += pf(r.liters); yFuelAmt += pf(r.amount);
      } else {
        yMaintAmt += pf(r.amount);
        if (r.items) r.items.forEach(it => { itemFreq[it] = (itemFreq[it] || 0) + 1; });
      }
    });
    
    const sortedItems = Object.entries(itemFreq).sort((a,b) => b[1] - a[1]);
    const totalExp = yFuelAmt + yMaintAmt;

    // 總支出卡片
    html += `
      <div style="background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; border-radius:16px; padding:16px; margin-bottom:12px; box-shadow:0 4px 12px rgba(245,158,11,0.3); text-align:center;">
        <div style="font-size:13px; font-weight:700; opacity:0.9; margin-bottom:6px;">${S.vehY}年 總支出金額 (油資+保養)</div>
        <div style="font-family:var(--mono); font-size:32px; font-weight:900;">$ ${fmt(totalExp)}</div>
      </div>
    `;

    // 燃料與里程統計
    html += `<div class="card" style="border:1px solid #3b82f650;">
      <h3 style="font-size:13px; color:var(--blue); margin-bottom:12px; border-bottom:1px dashed var(--border); padding-bottom:8px;">${isEV ? '🔋 年度換電與里程' : '⛽ 年度油資與里程'}</h3>
      <div style="display:flex; justify-content:space-around; text-align:center;">
        ${!isEV ? `
        <div><div style="font-size:11px; color:var(--t3); margin-bottom:4px;">總加油金額</div><div style="font-family:var(--mono); font-size:16px; font-weight:800; color:var(--t1);">$${fmt(yFuelAmt)}</div></div>
        <div style="width:1px; background:var(--border);"></div>
        <div><div style="font-size:11px; color:var(--t3); margin-bottom:4px;">總油量</div><div style="font-family:var(--mono); font-size:16px; font-weight:800; color:var(--t1);">${yLiters.toFixed(1)} L</div></div>
        <div style="width:1px; background:var(--border);"></div>
        ` : ''}
        <div><div style="font-size:11px; color:var(--t3); margin-bottom:4px;">行駛總里程</div><div style="font-family:var(--mono); font-size:16px; font-weight:800; color:var(--t1);">${fmt(yDist)} km</div></div>
      </div>
    </div>`;

    // 保養頻率與花費
    html += `<div class="card" style="border:1px solid #10b98150;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border); padding-bottom:8px; margin-bottom:12px;">
        <h3 style="font-size:13px; color:var(--green); margin:0;">🔧 保養維修總額</h3>
        <span style="font-family:var(--mono); font-size:16px; font-weight:800; color:var(--t1);">$${fmt(yMaintAmt)}</span>
      </div>
      <div style="font-size:11px; font-weight:700; color:var(--t3); margin-bottom:8px;">各項目保養次數分析：</div>
      ${sortedItems.length ? sortedItems.map(it => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--sf2);">
          <span style="font-size:13px; font-weight:700; color:var(--t2);">${it[0]}</span>
          <span style="font-family:var(--mono); font-size:14px; font-weight:800; color:var(--acc);">${it[1]} 次</span>
        </div>
      `).join('') : '<div class="empty-tip" style="padding:4px 0;">本年度尚無保養記錄</div>'}
    </div>`;

    container.innerHTML = html;
    return;
  }

  // ── 3. 月度：車輛燃料 / 保養維修 ──
  const prefix = `${S.vehY}-${pad(S.vehM)}`; 
  const monthRecs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.date.startsWith(prefix));
  const fuelRecs = monthRecs.filter(r => r.type === 'fuel'); 
  const maintRecs = monthRecs.filter(r => r.type === 'maintenance');

  let totalDistance = 0, totalLiters = 0, totalFuelPaid = 0, totalMaintPaid = 0;
  fuelRecs.forEach(r => { const diff = pf(r.km) - pf(r.prevKm); if (diff > 0) totalDistance += diff; totalLiters += pf(r.liters); totalFuelPaid += pf(r.amount); });
  maintRecs.forEach(r => totalMaintPaid += pf(r.amount)); 
  const avgKmL = totalLiters > 0 ? (totalDistance / totalLiters).toFixed(1) : 0;

  if (S.vehicleTab === 'fuel') {
    const v = S.vehicles.find(x => x.id === S.selVehicleId);
    const isEV = v && v.defaultFuel === 'electric';
    
    if (isEV) {
      html += `
        <div style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#fff; border-radius:16px; padding:5px 5px 5px 10px; margin-bottom:5px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:700;">本月【 電池 】總里程：</span>
            <span style="font-family:var(--mono); font-size:22px; font-weight:800;">${fmt(totalDistance)} <span style="font-size:15px;">（ km ）</span></span>
          </div>
        </div>`;
    } else {
      const fuelStatsHtml = `
        <div style="display:flex; justify-content:space-between; text-align:center; margin-top: 5px;">
          <div style="flex:1;">
            <div style="font-size:12px; color:rgba(255,255,255,0.8); margin-bottom:4px;">總加油量</div>
            <div style="font-weight:800; font-size:15px;">${totalLiters.toFixed(1)} L</div>
          </div>
          <div style="width:1px; background:rgba(255,255,255,0.3); margin:0 8px;"></div>
          <div style="flex:1;">
            <div style="font-size:12px; color:rgba(255,255,255,0.8); margin-bottom:4px;">總里程</div>
            <div style="font-weight:800; font-size:15px;">${fmt(totalDistance)} km</div>
          </div>
          <div style="width:1px; background:rgba(255,255,255,0.3); margin:0 8px;"></div>
          <div style="flex:1;">
            <div style="font-size:12px; color:rgba(255,255,255,0.8); margin-bottom:4px;">平均油耗</div>
            <div style="font-weight:800; font-size:15px;">${avgKmL} km/L</div>
          </div>
        </div>`;

      html += `
        <div style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#fff; border-radius:16px; padding:5px 5px 5px 10px; margin-bottom:5px;">
          <div onclick="toggleSummaryCard('veh-fuel-col')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:700;">本月【 汽油 】總金額：</span>
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-family:var(--mono); font-size:22px; font-weight:800;">$ ${fmt(totalFuelPaid)}</span>
              <div style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:8px;">
                <span style="font-size:11px; font-weight:700;">詳細資訊</span>
                <div id="veh-fuel-col-btn" style="font-size:10px; transition:transform 0.3s;">▼</div>
              </div>
            </div>
          </div>
          <div id="veh-fuel-col" style="max-height:0px; overflow:hidden; transition:max-height 0.3s ease;">
            ${fuelStatsHtml}
          </div>
        </div>`;
    }
  } else if (S.vehicleTab === 'maintenance') {
    html += `
      <div style="background:linear-gradient(135deg, #065f46, #10b981); color:#fff; border-radius:16px; padding:5px 5px 5px 10px; margin-bottom:5px;">
        <div onclick="toggleSummaryCard('veh-maint-col')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:14px; font-weight:400;">本月【 保養、維修 】總金額：</span>
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-family:var(--mono); font-size:22px; font-weight:800;">$ ${fmt(totalMaintPaid)}</span>
            <div style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:8px;">
              <span style="font-size:11px; font-weight:700;">詳細資訊</span>
              <div id="veh-maint-col-btn" style="font-size:10px; transition:transform 0.3s;">▼</div>
            </div>
          </div>
        </div>
        <div id="veh-maint-col" style="max-height:0px; overflow:hidden; transition:max-height 0.3s ease;">
          <div style="display:flex; justify-content:center; text-align:center; margin-top: 5px;">
            <div style="flex:1;">
              <div style="font-size:12px; color:rgba(255, 255, 255, 0.9); margin-bottom:4px;">本月保養次數：</div>
              <div style="font-weight:800; font-size:15px;">${maintRecs.length} 筆</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // 繪製記錄列表
  const typeRecs = monthRecs.filter(r => r.type === S.vehicleTab);
  if (typeRecs.length === 0) { 
    html += `<div class="empty-tip">本月尚未新增資料</div>`; 
  } else {
    typeRecs.sort((a, b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||'')).forEach(r => {
      const isFuel = r.type === 'fuel'; 
      const isEV = r.fuelType === 'electric'; 
      
      let htmlContent = '';

      if (isFuel) {
          // ── 燃料紀錄卡片 (無大圖示，極簡版) ──
          let fuelTypeTag = isEV 
            ? `<span class="vr-chip chip-fuel">🔋 電池 (電動車)</span>`
            : `<span class="vr-chip chip-fuel">⛽ ${r.fuelType||'95'} 無鉛汽油</span>`;
            
          let litersTag = (!isEV && r.liters) ? `<span class="vr-chip chip-liters">💧 ${r.liters} L</span>` : '';
          
          const diff = pf(r.km) - pf(r.prevKm);
          let distTag = diff > 0 ? `<span class="vr-chip chip-dist">🛣️ ${diff} km</span>` : '';
          let kmRangeTag = `<span class="vr-chip chip-km">${r.prevKm} → ${r.km}</span>`;

          const amountStr = isEV ? '' : `-$${fmt(r.amount)}`;

          htmlContent = `
            <div onclick="openAddVehRec('${safeText(r.id)}')" style="background:#ffffff; border-radius:16px; margin-bottom:8px; padding:10px 12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.04); border:1px solid #f1f5f9; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:13px; font-family:var(--mono); font-weight:700; color:#ea580c;">${r.date.slice(5).replace('-','/')} ${r.time||''}</span>
                <span style="font-size:16px; font-weight:900; color:#0f172a; font-family:var(--mono);">${amountStr}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${fuelTypeTag} ${litersTag} ${distTag} ${kmRangeTag}
              </div>
            </div>`;
      } else {
          // ── 保養維修紀錄卡片 (無大圖示，極簡版) ──
          const itemsTag = (r.items||[]).length ? (r.items||[]).map(i=>`<span class="vr-chip chip-item">🔧 ${safeText(i)}</span>`).join('') : '';
          const shopTag = r.shop ? `<span class="vr-chip chip-shop">🏠 ${safeText(r.shop)}</span>` : '';
          const kmTag = r.km ? `<span class="vr-chip chip-km">🛣️ ${r.km} km</span>` : '';
          const noteTag = r.note ? `<span class="vr-chip chip-note">📝 ${safeText(r.note)}</span>` : '';

          htmlContent = `
            <div onclick="openAddVehRec('${safeText(r.id)}')" style="background:#ffffff; border-radius:16px; margin-bottom:8px; padding:10px 12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.04); border:1px solid #f1f5f9; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:13px; font-family:var(--mono); font-weight:700; color:#3b82f6;">${r.date.slice(5).replace('-','/')} ${r.time||''}</span>
                <span style="font-size:16px; font-weight:900; color:#0f172a; font-family:var(--mono);">-$${fmt(r.amount)}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${itemsTag} ${shopTag} ${kmTag} ${noteTag}
              </div>
            </div>`;
      }
      html += htmlContent;
    });
  }
  container.innerHTML = html;
}

async function deleteVehicle(id) {
  const ok = await customConfirm('確定要刪除這台車輛嗎？<br><span style="color:var(--red); font-size:12px;">⚠️ 該車的所有記錄將一併刪除且無法復原</span>'); if(!ok) return;
  S.vehicles = S.vehicles.filter(v => v.id !== id); S.vehicleRecs = S.vehicleRecs.filter(r => r.vehicleId !== id); 
  if (S.selVehicleId === id) S.selVehicleId = null; saveVehicles(); saveVehicleRecs(); renderVehicles(); toast('車輛與記錄已刪除');
}

let editingVehRecId = null; 
const MAINT_ITEMS_GAS = ['機油', '齒輪油', '空濾', '前輪', '後輪', '煞車油', '前煞車皮', '後煞車皮', '皮帶', '傳動保養', '大保養'];
const MAINT_ITEMS_EV = ['齒輪油', '傳動皮帶', '鍊條', '煞車油', '煞車來令片', '後輪', '前輪', '其它'];

/* ══ 替換：新增車輛記錄 (阻擋電動車抓油價，並修正保養項目空白問題) ══ */
function openAddVehRec(recordId = null) {
  if (!USER.loggedIn) { toast('⚠️ 請先登入帳號才能新增車輛記錄'); return; }
  
  editingVehRecId = recordId; const isEdit = !!recordId; 
  if (!isEdit && S.vehicles.length === 0) { toast('請先新增車輛'); return; }
  
  document.getElementById('veh-rec-title').textContent = isEdit ? '編輯車輛記錄' : '新增車輛記錄'; 
  document.getElementById('veh-rec-del-btn').style.display = isEdit ? 'block' : 'none';
  
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = v && v.defaultFuel === 'electric'; // 👈 判斷是否為電動車

  if (v) {
    const iconNum = (v.icon && v.icon <= 11) ? v.icon : 1;
    document.getElementById('veh-rec-veh-icons').innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:4px; margin:0 auto;">
        <div style="width:50px; height:50px; border-radius:12px; background:var(--sf); border:2px solid var(--acc); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(255,107,53,0.2);">
          <img src="scooter/s${iconNum}.png" style="width:34px; height:34px; object-fit:contain;">
        </div>
        <span style="font-size:11px; font-weight:700; color:var(--acc);">${v.name}</span>
      </div>`;
  }

  let r = null; if (isEdit) { r = S.vehicleRecs.find(x => x.id === recordId); S.addVehRecType = r.type; } else { S.addVehRecType = S.vehicleTab; }
  document.getElementById('vr-date').value = r ? r.date : todayStr(); document.getElementById('vr-time').value = r ? (r.time || nowTime()) : nowTime();
  
  // 記錄已選取的保養項目
  currentSelItems = (r && r.type === 'maintenance') ? [...r.items] :[];
  
  // 👇 補回遺失的這段：根據車型(油車/電車)動態產生保養項目的按鈕
  const maintList = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;
  document.getElementById('vm-items-container').innerHTML = maintList.map(item => 
    `<div class="item-chip ${currentSelItems.includes(item) ? 'on' : ''}" onclick="toggleMaintItem(this, '${item}')">${item}</div>`
  ).join('');

  if (S.addVehRecType === 'fuel') { 
    document.getElementById('vr-fuel-type').value = r?.fuelType || (v ? v.defaultFuel : '95'); 
    document.getElementById('vr-discount').value = r?.discount || '0'; 
    document.getElementById('vr-prev-km').value = r?.prevKm || ''; 
    document.getElementById('vr-curr-km').value = r?.km || ''; 
    document.getElementById('vr-liters').value = r?.liters || ''; 
    document.getElementById('vr-price').value = r?.price || ''; 
    calcVehFuel(); 
  } else { 
    document.getElementById('vm-km').value = r?.km || ''; 
    document.getElementById('vm-shop').value = r?.shop || ''; 
    document.getElementById('vm-pay-method').value = r?.payMethod || '現金'; 
    document.getElementById('vm-amount').value = r?.amount || ''; 
    document.getElementById('vm-note').value = r?.note || ''; 
    renderShopHistory(); 
  }
  
  switchVehFormTab(S.addVehRecType, S.addVehRecType === 'fuel' ? 0 : 1); 
  openOverlay('veh-rec-add-page');

  if (!isEdit && S.addVehRecType === 'fuel' && !document.getElementById('vr-price').value) {
    applyGlobalGasPrice();
  }
}


/* ══ 替換：車輛表單頁籤切換 (電動車專屬顯示) ══ */
function switchVehFormTab(type, index) {
  S.addVehRecType = type; document.getElementById('veh-form-tab-bg').style.transform = `translateX(${index * 100}%)`; 
  document.getElementById('btn-form-fuel').classList.toggle('active', type === 'fuel'); document.getElementById('btn-form-maint').classList.toggle('active', type === 'maintenance'); 
  document.getElementById('form-area-fuel').style.display = type === 'fuel' ? 'block' : 'none'; document.getElementById('form-area-maint').style.display = type === 'maintenance' ? 'block' : 'none';
  
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = v && v.defaultFuel === 'electric';
  
  const vehPage = document.getElementById('veh-rec-add-page');
  const tabBg = document.getElementById('veh-form-tab-bg');
  
  if (type === 'fuel') {
    tabBg.style.backgroundColor = 'var(--red)';
    tabBg.style.boxShadow = '0 4px 10px rgba(239, 68, 68, 0.4)';
    vehPage.style.setProperty('--veh-inp-border', 'var(--red)');
    vehPage.style.setProperty('--veh-inp-bg', 'rgba(239,68,68,0.05)');
    vehPage.style.setProperty('--veh-inp-color', 'var(--red)');

    // 電動車隱藏油價相關欄位
    document.getElementById('vr-fuel-type').parentElement.style.display = isEV ? 'none' : 'flex';
    document.getElementById('vr-discount').parentElement.style.display = isEV ? 'none' : 'flex';
    document.getElementById('vr-liters').parentElement.style.display = isEV ? 'none' : 'flex';
    document.getElementById('vr-price').parentElement.style.display = isEV ? 'none' : 'flex';
    
    document.getElementById('vr-prev-km').parentElement.querySelector('label').textContent = isEV ? '上次換電里程 (km)' : '上次里程 (km)';
    document.getElementById('vr-curr-km').parentElement.querySelector('label').textContent = isEV ? '現在換電里程 (km)' : '加油里程 (km)';
    
    // 👈 替換下方總計區域，電動車改顯示里程
    const totalPanel = document.getElementById('vr-fuel-total-panel');
    if (totalPanel) {
      if (isEV) {
        totalPanel.innerHTML = `<div style="font-size:12px; color:var(--t3);">本次換電行駛：</div><div style="font-size:24px; font-weight:bold; color:var(--acc); margin-top:4px;"><span id="vr-ev-calc">0</span> <span style="font-size:14px; color:var(--t1);">km</span></div>`;
      } else {
        totalPanel.innerHTML = `<div style="font-size:12px; color:var(--t3);">折扣前總額：NT$ <span id="vr-before-total">0</span></div><div style="font-size:14px; font-weight:bold; color:var(--t1); margin-top:4px;">付款金額：<span style="font-size:24px; color:var(--acc);" id="vr-final-total">0</span></div>`;
      }
    }
  } else {
    tabBg.style.backgroundColor = 'var(--green)'; 
    tabBg.style.boxShadow = '0 4px 10px rgba(34, 197, 94, 0.4)';
    vehPage.style.setProperty('--veh-inp-border', 'var(--green)');
    vehPage.style.setProperty('--veh-inp-bg', 'rgba(34,197,94,0.05)');
    vehPage.style.setProperty('--veh-inp-color', 'var(--green)');
  }
}

function calcVehFuel() { 
  const prev = pf(document.getElementById('vr-prev-km').value);
  const curr = pf(document.getElementById('vr-curr-km').value);
  if (document.getElementById('vr-ev-calc')) {
    const diff = curr - prev;
    document.getElementById('vr-ev-calc').textContent = diff > 0 ? diff : '0';
  }

  const liters = pf(document.getElementById('vr-liters') ? document.getElementById('vr-liters').value : 0); 
  const price = pf(document.getElementById('vr-price') ? document.getElementById('vr-price').value : 0); 
  const discount = pf(document.getElementById('vr-discount') ? document.getElementById('vr-discount').value : 0); 
  const before = Math.round(liters * price); 
  const final = Math.round(Math.max(0, before - discount)); 
  if (document.getElementById('vr-before-total')) document.getElementById('vr-before-total').textContent = fmt(before); 
  if (document.getElementById('vr-final-total')) document.getElementById('vr-final-total').textContent = fmt(final); 
}

/* ══ 替換：儲存車輛記錄 (強制分流儲存資料) ══ */
function confirmAddVehRec() {
  const checkImg = document.getElementById('veh-save-img'); const checkBtn = document.getElementById('veh-save-btn'); if (checkBtn.disabled) return; if (!S.selVehicleId) { toast('請先選擇車輛'); return; }
  
  const isEV = S.vehicles.find(x => x.id === S.selVehicleId)?.defaultFuel === 'electric';
  let amount = 0; 
  
  if (S.addVehRecType === 'fuel') { 
    // 電動車不需檢查金額
    if (isEV) {
      amount = 0; 
    } else {
      const finalTotalEl = document.getElementById('vr-final-total');
      if (finalTotalEl) {
        amount = pf(finalTotalEl.textContent.replace(/,/g,'')); 
        if (amount <= 0) { toast('金額不能為 0'); return; }
      }
    }
  } else { 
    amount = pf(document.getElementById('vm-amount').value); 
    if (amount <= 0 || currentSelItems.length === 0) { toast('請選擇保養項目並輸入金額'); return; } 
  }

  checkBtn.disabled = true; 
  runSaveProgress(() => {
    const commonData = { id: editingVehRecId || newId(), vehicleId: S.selVehicleId, type: S.addVehRecType, date: document.getElementById('vr-date').value, time: document.getElementById('vr-time').value, amount: amount }; 
    let specificData = {};
    
    if (S.addVehRecType === 'fuel') { 
      specificData = { 
        fuelType: isEV ? 'electric' : document.getElementById('vr-fuel-type').value, 
        discount: isEV ? 0 : pf(document.getElementById('vr-discount').value), 
        prevKm: pf(document.getElementById('vr-prev-km').value), 
        km: pf(document.getElementById('vr-curr-km').value), 
        liters: isEV ? 0 : pf(document.getElementById('vr-liters').value), 
        price: isEV ? 0 : pf(document.getElementById('vr-price').value) 
      }; 
    } else { 
      const shop = document.getElementById('vm-shop').value.trim(); 
      if (shop && !S.settings.shopHistory.includes(shop)) { S.settings.shopHistory.push(shop); saveSettings(); } 
      specificData = { km: pf(document.getElementById('vm-km').value), items: currentSelItems, shop: shop, payMethod: document.getElementById('vm-pay-method').value, note: document.getElementById('vm-note').value }; 
    }
    
    const finalRec = { ...commonData, ...specificData }; 
    if (editingVehRecId) { const idx = S.vehicleRecs.findIndex(r => r.id === editingVehRecId); if (idx >= 0) S.vehicleRecs[idx] = finalRec; toast('✅ 記錄已更新'); } 
    else { S.vehicleRecs.push(finalRec); toast('✅ 記錄已新增'); }
    
    editingVehRecId = null; 
    saveVehicleRecs(); 
    checkImg.src = 'images/Check1.png';
    checkBtn.disabled = false; 
    closeOverlay('veh-rec-add-page'); 
    renderVehicles();
  });
}

async function deleteVehRecFromEdit() { const ok = await customConfirm('確定刪除此記錄嗎？<br><strong>此動作無法復原。</strong>'); if(!ok) return; S.vehicleRecs = S.vehicleRecs.filter(r => r.id !== editingVehRecId); saveVehicleRecs(); closeOverlay('veh-rec-add-page'); toast('✅ 記錄已刪除'); renderVehicles(); }

/* ══ 替換：新增車輛彈窗與左右滑動圖示選擇 ══ */
function openAddVehicle() {
  S.newVehIcon = 1; 
  const container = document.getElementById('vehicle-add-body');
  let iconsHtml = '';
  for (let i = 1; i <= 9; i++) {
    const isSel = S.newVehIcon === i;
    iconsHtml += `<img src="scooter/s${i}.png" id="veh-opt-${i}" onclick="selectNewVehIcon(${i})" style="width:70px; height:70px; object-fit:contain; border:2px solid ${isSel ? 'var(--acc)' : 'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel ? 'scale(1.05)' : 'scale(1)'}; flex-shrink:0; background:var(--sf); padding:4px;">`;
  }
  
  container.innerHTML = `
    <div style="padding:16px;">
      <div class="fg" style="margin-bottom:16px">
        <label style="font-weight:700; color:var(--t1);">車輛名稱 <span style="color:red">*</span></label>
        <input type="text" class="finp" id="v-name" placeholder="例如：我的愛車 Gogoro">
      </div>
      
      <div class="fg" style="margin-bottom:20px;">
        <label style="font-weight:700; color:var(--t1);">滑動選擇機車圖示</label>
        <div style="display:flex; overflow-x:auto; gap:12px; background:var(--bg-input); padding:16px; border-radius:16px; align-items:center;">
          ${iconsHtml}
        </div>
      </div>

      <div class="fg" style="margin-bottom:20px">
        <label style="font-weight:700; color:var(--t1);">預設燃料 <span style="color:red">*</span></label>
        <select class="fsel" id="v-fuel">
          <option value="92" selected>92 無鉛汽油</option>
          <option value="95">95 無鉛汽油</option>
          <option value="98">98 無鉛汽油</option>
          <option value="electric">電動車 (電池)</option>
        </select>
      </div>
      
      <!-- 新增詳細車輛資訊區塊 -->
      <h3 style="font-size:13px; color:var(--hint-color); margin-bottom:12px; border-bottom:1px dashed var(--border); padding-bottom:8px;">📝 進階車輛資訊 (選填)</h3>
      
      <div class="fg" style="margin-bottom:16px">
        <label style="font-weight:700; color:var(--t1);">車牌號碼</label>
        <input type="text" class="finp" id="v-plate" placeholder="例如：ABC-1234">
      </div>

      <div style="display:flex; gap:10px; margin-bottom:16px;">
        <div class="fg" style="flex:1;">
          <label style="font-weight:700; color:var(--t1);">排氣量 (cc)</label>
          <input type="number" class="finp" id="v-cc" placeholder="例如：125">
        </div>
        <div class="fg" style="flex:1;">
          <label style="font-weight:700; color:var(--t1);">車輛顏色</label>
          <input type="text" class="finp" id="v-color" placeholder="例如：消光黑">
        </div>
      </div>

      <div class="fg" style="margin-bottom:24px">
        <label style="font-weight:700; color:var(--t1);">出廠年月</label>
        <input type="month" class="finp" id="v-year">
      </div>

      <div style="display:flex;gap:10px;">
        <button onclick="closeOverlay('vehicle-add-page')" style="flex:1;padding:14px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-weight:700;cursor:pointer;">取消</button>
        <button onclick="saveNewVehicle()" class="btn-acc" style="flex:2;padding:14px;font-weight:800;border-radius:var(--rs);box-shadow:0 4px 12px rgba(255,107,53,0.3);">確認新增</button>
      </div>
    </div>`;
    
  openOverlay('vehicle-add-page');
}
// 機車圖片數量
function selectNewVehIcon(id) { 
  S.newVehIcon = id; 
  for (let i = 1; i <= 9; i++) { 
    const img = document.getElementById(`veh-opt-${i}`); 
    if (!img) continue; 
    if (i === S.newVehIcon) { 
      img.style.borderColor = 'var(--acc)'; 
      img.style.transform = 'scale(1.05)'; 
    } else { 
      img.style.borderColor = 'transparent'; 
      img.style.transform = 'scale(1)'; 
    } 
  } 
}
function updateVehIconUI() { for (let i = 4; i <= 14; i++) { const box = document.getElementById(`veh-icon-box-${i}`); const mask = document.getElementById(`veh-icon-mask-${i}`); if (!box || !mask) continue; if (i === S.newVehIcon) { box.style.borderColor = 'var(--acc)'; mask.style.backgroundColor = S.newVehColor; } else { box.style.borderColor = 'transparent'; mask.style.backgroundColor = '#ccc'; } } }
function saveNewVehicle() { 
  const name = document.getElementById('v-name').value.trim(); 
  if (!name) { toast('請輸入車輛名稱'); return; } 
  const fuel = document.getElementById('v-fuel').value; 
  
  // 抓取新的選填欄位
  const plate = document.getElementById('v-plate').value.trim();
  const cc = document.getElementById('v-cc').value.trim();
  const color = document.getElementById('v-color').value.trim();
  const year = document.getElementById('v-year').value;
  
  S.vehicles.push({ 
    id: newId(), 
    name: name, 
    icon: S.newVehIcon, 
    defaultFuel: fuel,
    plate: plate,
    cc: cc,
    color: color,
    year: year
  }); 
  
  saveVehicles(); 
  closeOverlay('vehicle-add-page'); 
  toast('✅ 成功新增車輛！'); 
  renderVehicles(); 
}

let currentSelItems = []; function toggleMaintItem(el, item) { el.classList.toggle('on'); if (currentSelItems.includes(item)) { currentSelItems = currentSelItems.filter(i => i !== item); } else { currentSelItems.push(item); } }
function setShopInput(value) {
  document.getElementById('vm-shop').value = value;
}

function renderShopHistory() {
  const container = document.getElementById('shop-history-container');
  if (!S.settings.shopHistory) S.settings.shopHistory = [];
  
  if (S.settings.shopHistory.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  // 使用新的 .shop-chip 樣式，並支援單引號跳脫防錯
  container.innerHTML = S.settings.shopHistory.map((shop, i) => {
    const safeShopStr = safeText(shop).replace(/'/g, "\\'");
    return `
      <div class="shop-chip">
        <span style="flex:1;" onclick="setShopInput('${safeShopStr}')">${safeText(shop)}</span>
        <span class="shop-chip-del" onclick="event.stopPropagation(); deleteShopHistory(${i})">✕</span>
      </div>
    `;
  }).join('');
}
function deleteShopHistory(index) { S.settings.shopHistory.splice(index, 1); saveSettings(); renderShopHistory(); }

// 執行車輛保養記錄搜尋與渲染精美時間軸
window.doVehSearch = function() {
  const kw = document.getElementById('veh-search-kw').value.trim().toLowerCase();
  const resEl = document.getElementById('veh-search-results');
  
  if (!kw) { resEl.innerHTML = '<div class="empty-tip">請輸入或點選標籤開始搜尋</div>'; return; }
  
  // 過濾當前車輛的保養記錄
  let recs = S.vehicleRecs.filter(r => 
    r.vehicleId === S.selVehicleId && 
    r.type === 'maintenance' && 
    (r.items.some(i => i.toLowerCase().includes(kw)) || (r.note||'').toLowerCase().includes(kw))
  );
  
  // 依日期由新到舊排序
  recs.sort((a,b) => b.date.localeCompare(a.date));

  if (!recs.length) {
    resEl.innerHTML = '<div class="empty-tip">找不到相符的保養記錄</div>';
    return;
  }

  // 產生白底卡片與標題
  let html = `
  <div style="background:var(--sf); border-radius:16px; padding:16px; border:1px solid var(--border); box-shadow:0 2px 8px rgba(0,0,0,0.03);">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:16px; font-size:15px; font-weight:800; color:var(--t1);">
      <span style="color:#0f766e;">💧</span> ${kw} 時間軸 <span style="font-size:13px; color:var(--t3); font-weight:600;">${recs.length}</span>
    </div>
    <div style="position:relative; padding-left:12px;">
      <!-- 貫穿時間軸的垂直線 -->
      <div style="position:absolute; left:16.5px; top:12px; bottom:20px; width:2px; background:#e2e8f0;"></div>`;
      
  recs.forEach((r, idx) => {
    const isLatest = idx === 0;
    const dotColor = isLatest ? '#0f766e' : '#cbd5e1'; // 最新一筆深綠，其餘淺灰綠
    
    // 計算與前一次(上一筆較舊的紀錄)的差異
    let diffHtml = '';
    if (idx < recs.length - 1) {
      const olderRec = recs[idx + 1];
      const kmDiff = pf(r.km) - pf(olderRec.km);
      const daysDiff = Math.round((new Date(r.date) - new Date(olderRec.date)) / 86400000);
      diffHtml = `
        <div style="display:flex; align-items:center; gap:12px; margin-top:6px; font-size:12px; color:var(--t3); font-weight:600;">
          <span>🛣️ ${fmt(kmDiff)} km</span>
          <span>🗓️ ${daysDiff} 天</span>
        </div>`;
    }

    // 優先顯示備註，若無備註才顯示保養項目
    const formatTitle = r.note ? safeTextWithBr(r.note) : (r.items || []).map(i => safeText(i)).join(', ');
    const shopText = r.shop ? ` @ ${safeText(r.shop)}` : '';

    html += `
      <div onclick="openAddVehRec('${safeText(r.id)}')" style="position:relative; padding-left:24px; padding-bottom:24px; cursor:pointer;">
        <!-- 時間軸圓點 -->
        <div style="position:absolute; left:-1px; top:4px; width:11px; height:11px; border-radius:50%; background:${dotColor}; box-shadow:0 0 0 4px var(--sf);"></div>
        
        <!-- 頂部資訊：日期、里程藥丸、最近標籤 -->
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-family:var(--mono); font-size:16px; font-weight:800; color:var(--t1); letter-spacing:0.5px;">${r.date.replace(/-/g, '/')}</span>
            <span style="background:#f1f5f9; color:#0369a1; padding:2px 8px; border-radius:12px; font-size:12px; font-family:var(--mono); font-weight:700;">${fmt(r.km)} km</span>
          </div>
          ${isLatest ? `<span style="background:#ecfdf5; color:#047857; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:800;">最近</span>` : ''}
        </div>
        
        <!-- 內容：項目名稱與店家 -->
        <div style="font-size:14px; font-weight:600; color:var(--t2);">
          ${formatTitle} <span style="color:var(--t3); font-size:12px;">${shopText}</span>
        </div>
        
        <!-- 里程與天數差異 (如果有上一筆) -->
        ${diffHtml}
      </div>
    `;
  });

  html += `</div></div>`;
  resEl.innerHTML = html;
}

// 顯示車輛詳細資訊彈窗
window.openVehInfo = function(id) {
  const v = S.vehicles.find(x => x.id === id);
  if(!v) return;
  
  document.getElementById('sub-title').textContent = '車輛資訊';
  document.getElementById('sub-top-right').innerHTML = '';
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      <div style="text-align:center; margin-bottom:24px;">
        <div style="width:80px; height:80px; border-radius:20px; background:var(--sf); border:3px solid var(--acc); margin:0 auto 12px; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 16px rgba(255,107,53,0.2);">
          <img src="scooter/s${v.icon || 1}.png" style="width:60px; height:60px; object-fit:contain;">
        </div>
        <h2 style="font-size:20px; font-weight:800; color:var(--t1); margin:0;">${safeText(v.name)}</h2>
        <span style="font-size:12px; font-weight:600; color:var(--blue); background:var(--blue-d); padding:4px 10px; border-radius:12px; display:inline-block; margin-top:6px;">
          ${safeText(v.defaultFuel === 'electric' ? '🔋 電動車' : '⛽ ' + v.defaultFuel + '無鉛汽油')}
        </span>
      </div>

      <div class="set-list" style="border:1px solid var(--border);">
        <div class="set-row"><span class="sn" style="color:var(--t3);">車牌號碼</span><span style="font-family:var(--mono); font-weight:800; color:var(--t1);">${safeText(v.plate || '未設定')}</span></div>
        <div class="set-row"><span class="sn" style="color:var(--t3);">排氣量</span><span style="font-family:var(--mono); font-weight:800; color:var(--t1);">${safeText(v.cc ? v.cc + ' cc' : '未設定')}</span></div>
        <div class="set-row"><span class="sn" style="color:var(--t3);">車輛顏色</span><span style="font-weight:800; color:var(--t1);">${safeText(v.color || '未設定')}</span></div>
        <div class="set-row"><span class="sn" style="color:var(--t3);">出廠年月</span><span style="font-family:var(--mono); font-weight:800; color:var(--t1);">${v.year || '未設定'}</span></div>
      </div>
    </div>
  `;
  openOverlay('sub-page');
}
/* ══ 6. 車輛管理 結束 ══════════════════════════════════════════ */

/* ══ 7. 設定管理與啟動 ═══════════════════════════════════ */
function renderSettings() {
  const isLogged = USER.loggedIn;
  const accStr = isLogged ? `👤 帳號：${USER.email}` : `✉️ 登入 / 註冊帳號`;
  
  // 判斷上次備份時間
  const lastBackupStr = S.settings.lastLocalBackup 
    ? `<span style="font-size:12px; color:var(--text-blue); font-weight:600; font-family:var(--mono);">上次備份：${S.settings.lastLocalBackup}</span>` 
    : `<span style="font-size:12px; color:var(--text-red);">尚未進行本機備份</span>`;

  const html  = `
  <!-- 縮小了區塊的 margin-bottom -->
  <div class="set-sec" style="margin-bottom:5px;"><h3>帳號登入狀態</h3><div class="set-list">
    <div class="set-row" onclick="${isLogged ? 'openAccountStats()' : 'openAuthModal()'}"><span class="sn" style="font-weight:700; color:var(--acc);">${accStr}</span><span class="arr">›</span></div>
  </div></div>

  <div class="set-sec" style="margin-bottom:12px;"><h3>功能設定</h3><div class="set-list">
    <div class="set-row" onclick="openPlatformList()"><span class="sn">🏪 平台列表與設定</span><span class="arr">›</span></div>
    <div class="set-row" onclick="openGoalSettings()"><span class="sn">🎯 收入目標設定</span><span class="arr">›</span></div>
    <div class="set-row" onclick="openRewardSettings()"><span class="sn">🎁 獎勵項目設定</span><span class="arr">›</span></div>
    <div class="set-row" onclick="openReminderSettings()"><span class="sn">⏰ 每日記錄通知提醒</span><span class="arr">›</span></div>
  </div></div>

  <div class="set-sec" style="margin-bottom:8px;"><h3>資料管理與備份</h3><div class="set-list">
      <div class="set-row" onclick="confirmBackupToFile()"><span class="sn">📂 備份到本機 (.json) │ ${lastBackupStr}</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doRestore()"><span class="sn">📤 從本機還原備份</span><span class="arr">↑</span></div>
      <div class="set-row" onclick="backupToGoogleDrive()"><span class="sn">☁️ 備份至 Google 雲端硬碟</span><span class="arr">↗</span></div>
      <div class="set-row" onclick="openExportModal()"><span class="sn">📊 匯出 Excel、試算表 (.xlsx)</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doClearData()"><span class="sn" style="color:var(--red)">🗑 清除所有資料</span><span class="arr" style="color:var(--red)">!</span></div>
      <div class="set-row" onclick="doReset()"><span class="sn" style="color:var(--red); font-weight:700;">⚠️ 重置設定和資料</span><span class="arr" style="color:var(--red)">!</span></div>
  </div></div>
  
  <!-- 將關於我們往上提，縮小字體讓比例更精緻 -->
  <div style="margin-top:0px; padding-bottom:8px; text-align:center;">
      <span onclick="openOverlay('about-page')" style="font-size:15px; color:var(--text-blue); font-weight:800; cursor:pointer; padding:6px 16px; display:inline-block;">關於我們</span>
  </div>`;
  
  document.getElementById('settings-content').innerHTML = html;
}

/* ✨ 新增：提醒設定彈窗 */
function openReminderSettings() {
  document.getElementById('sub-title').textContent = '每日記錄提醒';
  document.getElementById('sub-top-right').innerHTML = '';
  const r = S.settings.reminder || { enabled: false, time: '22:00' };

  document.getElementById('sub-body').innerHTML = `
    <div style="background:var(--sf2); padding:16px; border-radius:12px; margin-bottom:20px;">
      <div style="font-size:12px; color:var(--hint-color); line-height:1.6; font-weight:700;">
        💡 設定提醒時間，系統將在指定時間發送通知，提醒您記錄今天的收入與工時。
      </div>
    </div>
    
    <div class="card" style="display:flex; flex-direction:column; gap:16px; padding:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:14px; font-weight:700; color:var(--t1);">🔔 開啟每日提醒</span>
        <label class="switch">
          <input type="checkbox" id="rem-enabled" ${r.enabled ? 'checked' : ''} onchange="requestNotificationPermission(this)">
          <span class="slider"></span>
        </label>
      </div>
      
      <div style="border-top:1px dashed var(--border);"></div>
      
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">⏰ 提醒時間</label>
        <input type="time" class="finp" id="rem-time" value="${r.time}" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
    </div>
    
    <button onclick="saveReminderSettings()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3); margin-top:8px;">✅ 儲存提醒設定</button>
  `;
  openOverlay('sub-page');
}

// 請求瀏覽器通知權限
function requestNotificationPermission(checkbox) {
  if (checkbox.checked && "Notification" in window) {
    if (Notification.permission !== "granted") {
      Notification.requestPermission().then(permission => {
        if (permission !== "granted") {
          checkbox.checked = false;
          toast('⚠️ 請允許系統通知才能使用提醒功能');
        }
      });
    }
  }
}

function saveReminderSettings() {
  if (!S.settings.reminder) S.settings.reminder = {};
  S.settings.reminder.enabled = document.getElementById('rem-enabled').checked;
  S.settings.reminder.time = document.getElementById('rem-time').value || '22:00';
  saveSettings();
  toast('✅ 提醒設定已儲存');
  closeOverlay('sub-page');
}

/* ✨ 新增：初始化背景時間檢查機制 (包含聲音提醒) */
function initReminderCheck() {
  setInterval(() => {
    const r = S.settings.reminder;
    if (!r || !r.enabled) return;
    
    const now = new Date();
    const curTime = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const todayStrDate = todayStr(now);
    
    if (curTime === r.time && r.lastSent !== todayStrDate) {
      r.lastSent = todayStrDate;
      saveSettings();
      
      const title = "🛵 記錄提醒";
      const body = "今天跑單辛苦了！別忘了記錄今天的收入與工時喔！";

      // 🔊 1. 播放提示音效 (使用瀏覽器內建震盪器發出兩聲清脆的「嗶嗶」聲)
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const playBeep = (time, freq) => {
          const osc = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, audioCtx.currentTime + time);
          gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + time);
          gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + time + 0.5);
          osc.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          osc.start(audioCtx.currentTime + time);
          osc.stop(audioCtx.currentTime + time + 0.5);
        };
        playBeep(0, 800);   // 第一聲
        playBeep(0.15, 1200); // 第二聲高音
      } catch(e) { console.log('音效播放被瀏覽器阻擋'); }
      
      // 📱 2. 發送橫幅通知
      if ("Notification" in window && Notification.permission === "granted") {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(function(reg) {
            if (reg && reg.active) {
              reg.showNotification(title, { body: body, icon: 'images/scooter1.png', vibrate: [200, 100, 200] });
            } else {
              new Notification(title, { body: body, icon: 'images/scooter1.png' });
            }
          }).catch(() => { new Notification(title, { body: body, icon: 'images/scooter1.png' }); });
        } else {
          new Notification(title, { body: body, icon: 'images/scooter1.png' });
        }
      } else {
        toast(`🔔 ${title}：${body}`, 5000);
      }
    }
  }, 60000);
}

/* ══ 替換：登入系統拆分雙頁籤與頭像綁定 ══ */
let authMode = 'login'; // 'login' 或 'register'
let selectedAvatar = 'figure/1.webp'; 
let privacyAgreed = false; // 👈 新增：隱私權同意狀態

window.selectAvatar = function(src, el) {
    selectedAvatar = src;
    document.querySelectorAll('.avatar-opt').forEach(img => {
      img.style.borderColor = 'transparent';
      img.style.transform = 'scale(1)';
    });
    el.style.borderColor = 'var(--acc)';
    el.style.transform = 'scale(1.05)';
}

/* ══ 全新極簡風：登入與註冊彈窗 ══ */
window.switchAuthTab = function(mode) {
  authMode = mode;
  renderAuthContent();
};
function openAuthModal() {
  document.getElementById('sub-title').textContent = '帳號管理';
  document.getElementById('sub-top-right').innerHTML = '';
  authMode = 'login'; 
  privacyAgreed = false; 
  
  // 移除舊版的 slide-tabs，直接載入內容區域
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;" id="auth-content-area"></div>
  `;
  renderAuthContent();
  openOverlay('sub-page');
}
function renderAuthContent() {
  let contentHtml = '';
  
  if (authMode === 'login') {
    contentHtml = `
      <div class="auth-wrapper">
        <h2 class="auth-title">登入帳號</h2>
        <p class="auth-subtitle">請輸入您註冊時的電子郵件與密碼</p>
        
        <div class="auth-input-group">
          <label class="auth-input-label">電子郵件</label>
          <input type="email" class="auth-input" id="auth-email" placeholder="你的帳號@gmail.com">
        </div>
        
        <div class="auth-input-group">
          <label class="auth-input-label">密碼</label>
          <input type="password" class="auth-input" id="auth-pwd" placeholder="請輸入密碼">
        </div>

        <div id="turnstile-widget" style="margin-bottom:16px; min-height:65px;"></div>

        <button onclick="requestLogin()" class="auth-btn-blue">登入 ➔</button>
        
        <div class="auth-switch-text">
          還沒有帳號嗎？ 
          <button class="auth-switch-btn" onclick="window.switchAuthTab('register')">註冊新帳號</button>
        </div>
      </div>
    `;
  } else {
    let avatarsHtml = '';
    for(let i=1; i<=8; i++) {
      const isSel = selectedAvatar === `figure/${i}.webp`;
      avatarsHtml += `<img src="figure/${i}.webp" class="avatar-opt" onclick="selectAvatar('figure/${i}.webp', this)" style="width:48px; height:48px; object-fit:contain; border:2px solid ${isSel?'#2563eb':'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel?'scale(1.1)':'scale(1)'}; image-rendering: pixelated; image-rendering: crisp-edges;">`;
    }
    
    contentHtml = `
      <div class="auth-wrapper">
        <h2 class="auth-title">註冊新帳號</h2>
        <p class="auth-subtitle">填寫以下資訊即可免費建立專屬帳號</p>
        
        <div class="auth-input-group" style="padding:12px 16px;">
          <label class="auth-input-label">選擇專屬頭像</label>
          <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; margin-top:8px;">
            ${avatarsHtml}
          </div>
        </div>
        
        <div class="auth-input-group">
          <label class="auth-input-label">電子郵件</label>
          <input type="email" class="auth-input" id="auth-email" placeholder="你的帳號@gmail.com">
        </div>
        
        <div class="auth-input-group">
          <label class="auth-input-label">密碼</label>
          <input type="password" class="auth-input" id="auth-pwd" placeholder="請設定密碼">
        </div>

        <div style="font-weight:600; color:#64748b; font-size:11px; margin:-4px 0 16px 4px; line-height:1.5;">
          密碼需至少12字元，含大小寫、數字與特殊符號。<br>
          推薦使用 <a href="https://1password.com/zh-tw/password-generator" target="_blank" style="color:#2563eb; font-weight:700;">1Password 生成器</a>。
        </div>

        <div onclick="openPrivacyPolicy(true)" style="display:flex; align-items:flex-start; gap:12px; margin-bottom:16px; cursor:pointer;">
          <div id="privacy-chk-box" style="width:20px; height:20px; border-radius:6px; border:2px solid ${privacyAgreed ? '#2563eb' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; background:${privacyAgreed ? '#2563eb' : 'transparent'}; transition:0.2s; flex-shrink:0; margin-top:2px;">
            ${privacyAgreed ? '<span style="color:#fff; font-size:12px; font-weight:900;">✓</span>' : ''}
          </div>
          <span id="privacy-chk-text" style="font-size:12px; font-weight:600; color:${privacyAgreed ? '#0f172a' : '#64748b'}; line-height:1.5;">
            建立帳號即代表您同意我們的 <span style="color:#2563eb; font-weight:800;">服務條款與隱私權政策</span>
          </span>
        </div>

        <div id="turnstile-widget" style="margin-bottom:16px; min-height:65px;"></div>

        <button onclick="requestLogin()" class="auth-btn-blue" style="background:#93c5fd; color:#1e3a8a; box-shadow:0 8px 24px rgba(147, 197, 253, 0.4);">
          立即註冊 ➔
        </button>
        
        <div class="auth-switch-text">
          已經有帳號了？ 
          <button class="auth-switch-btn" onclick="window.switchAuthTab('login')">登入</button>
        </div>
      </div>
    `;
  }
  document.getElementById('auth-content-area').innerHTML = contentHtml;

  // ⚠️ 提醒：appearance: 'always' 僅在前端強制顯示元件。
  // 若要真正要求手動點擊驗證，您必須到 Cloudflare 網頁後台，
  // 將這個 Sitekey 的設定改為「互動式 (Interactive)」。
  const renderTurnstileWidget = () => {
    if (document.getElementById('turnstile-widget')) {
      turnstile.render('#turnstile-widget', {
        sitekey: '0x4AAAAAADC958xr-t5UGd36',
        theme: 'light',
        appearance: 'always' 
      });
    }
  };

  if (typeof turnstile !== 'undefined') { renderTurnstileWidget(); } else { window.onTurnstileLoad = renderTurnstileWidget; const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'; script.async = true; script.defer = true; document.body.appendChild(script); }
}

/* ══ 新增：更改頭像獨立設定頁 ══ */
window.openAvatarSettings = function() {
  document.getElementById('sub-title').textContent = '更改專屬頭像';
  
  // 👈 將「套用」按鈕注入至右上角
  document.getElementById('sub-top-right').innerHTML = `<button onclick="applyNewAvatar()" style="background:var(--acc); color:#fff; border:none; padding:6px 14px; border-radius:16px; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(255,107,53,0.3);">套用</button>`;
  
  // 預設選中目前頭像
  selectedAvatar = USER.avatar || 'figure/1.webp';

  let avatarsHtml = '';
  for(let i=1; i<=8; i++) {
    const isSel = selectedAvatar === `figure/${i}.webp`;
    avatarsHtml += `<img src="figure/${i}.webp" class="avatar-opt" onclick="selectAvatar('figure/${i}.webp', this)" style="width:80px; height:80px; object-fit:contain; border:2px solid ${isSel?'var(--acc)':'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel?'scale(1.05)':'scale(1)'}; flex-shrink:0; image-rendering: pixelated; image-rendering: crisp-edges;">`;
  }
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:16px; background:var(--bg-input); padding:16px; border-radius:16px; justify-content:center;">
        ${avatarsHtml}
      </div>
    </div>
  `;
}

window.applyNewAvatar = function() {
  USER.avatar = selectedAvatar;
  saveUser();
  toast('🎨 頭像已更新！');
  openAccountStats(); // 切回帳號資訊頁面
}

// 您的後端 API 網址 (本地測試為 localhost:3000，上線請改為實際網域)
const API_BASE_URL = 'https://delivery-api.fab2ci.workers.dev';

/* ══ 寄送真實 Email 驗證碼 ══ */
async function requestLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const pwd = document.getElementById('auth-pwd').value.trim();

  let turnstileToken = '';
  if (typeof turnstile !== 'undefined') {
    turnstileToken = turnstile.getResponse();
    if (!turnstileToken) {
      toast('⚠️ 請等待或點擊完成人機驗證');
      return;
    }
  }

  if(!email.includes('@')) { toast('請輸入有效的 E-mail 格式（您的帳號@gmail.com）'); return; }
  
  // 統一登入與註冊的嚴格密碼驗證 (無舊用戶，一律採用最高標準)
  const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s])\S{12,}$/;
  if (!pwdRegex.test(pwd)) {
    toast('密碼錯誤或強度不足：需至少12字元，並包含大小寫英文、數字及特殊符號');
    return;
  }

  if (authMode === 'register' && !privacyAgreed) {
    toast('⚠️ 請點擊上方並閱讀同意隱私權政策');
    return;
  }

  showProgress('登入連線中...');
  // ... (下方程式碼保持不變)
  
  try {
    // 呼叫更新後的 /auth/login API
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },

      // 👇 將 turnstileToken 一併送給後端
      body: JSON.stringify({ email, password: pwd, turnstileToken }) 
    });
    const data = await res.json();
    
    finishProgress(() => {
      if (data.success) {
        if (data.directLogin) {
          // ✅ 舊用戶，密碼正確，直接瞬間登入
          USER = { email: email, verified: true, loggedIn: true, joinDate: new Date(data.user.createdAt).toLocaleDateString(), token: data.token, role: data.user.role, avatar: selectedAvatar };
          saveUser();
          toast('✅ 登入成功');
          closeOverlay('sub-page');
          renderSettings();
        } else {
          // 📧 新用戶或未驗證帳號，顯示驗證碼輸入畫面
          document.getElementById('sub-body').innerHTML = `
            <div style="padding:16px;">
              <p style="font-size:13px;color:var(--t2);margin-bottom:16px; background:var(--bg-input); padding:12px; border-radius:12px; line-height:1.6;">
                ✅ 系統已寄出驗證信至 <b>${email}</b><br>
                <span style="color:var(--t3);font-size:12px;font-weight:600;">(請至信箱收取 6 位數驗證碼)</span>
              </p>
              <div class="fg" style="margin-bottom:20px;">
                <label style="font-weight:700; color:var(--t1);">6位數驗證碼</label>
                <input type="number" class="finp" id="auth-code" autocomplete="one-time-code" placeholder="請輸入信件中的數字" inputmode="numeric" style="font-size:24px; letter-spacing:8px; text-align:center; padding:12px; font-family:var(--mono);">
              </div>
              <button onclick="verifyAuthCode('${email}')" class="btn-acc" style="width:100%;padding:14px;font-size:15px;font-weight:800;border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">驗證並啟用帳號</button>
            </div>
          `;
        }
      } else {
        // ❌ 密碼錯誤等訊息
        toast('⚠️ ' + data.message);
      }
    });
  } catch (err) {
    finishProgress(() => toast('無法連線至伺服器'));
  }
}

/* ══ 驗證 Email 驗證碼 (儲存權限 role) ══ */
async function verifyAuthCode(email) {
  const code = document.getElementById('auth-code').value.trim();
  if(code.length < 4) { toast('請輸入正確的驗證碼'); return; }
  
  showProgress('帳號驗證中...');
  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    
    finishProgress(() => {
      if (data.success) {
        // 👈 將 data.user.role (權限) 一併存入
        USER = { email: email, verified: true, loggedIn: true, joinDate: new Date(data.user.createdAt).toLocaleDateString(), token: data.token, role: data.user.role, avatar: selectedAvatar };
        saveUser();
        toast('✅ 登入成功');
        closeOverlay('sub-page');
        renderSettings();
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch (err) {
    finishProgress(() => toast('無法連線至伺服器'));
  }
}

/* ══ 替換：帳號資訊 (開放統計 & 頭像支援) ══ */
async function openAccountStats() {
  document.getElementById('sub-title').textContent = '帳號資訊';
  document.getElementById('sub-top-right').innerHTML = '';
  document.getElementById('sub-body').innerHTML = `<div style="padding:32px; text-align:center; color:var(--t3);">載入資料中...</div>`;
  openOverlay('sub-page');

  let statsHtml = '';
  try {
    // 呼叫全新的公開統計 API
    const statRes = await fetch(`${API_BASE_URL}/stats`);
    const statData = await statRes.json();
    if (statData.success) {
      statsHtml = `
        <h4 style="font-size:13px; color:var(--hint-color); margin-bottom:8px;">📊 系統註冊統計</h4>
        <div class="set-list" style="margin-bottom:20px;">
          <div class="set-row"><span class="sn">總申請人數</span><span style="font-family:var(--mono);color:var(--t1);font-weight:700;">${statData.total} 人</span></div>
          <div class="set-row"><span class="sn">已完成驗證</span><span style="font-family:var(--mono);color:var(--green);font-weight:700;">${statData.verified} 人</span></div>
        </div>`;
    }
  } catch (e) {}

  /* 替換 openAccountStats() 裡面的 avatarImg 宣告 */
  const avatarImg = USER.avatar 
    ? `<div style="position:relative; display:inline-block;">
         <img src="${USER.avatar}" style="width:128px; height:128px; object-fit:contain; margin-bottom:12px; border:none; border-radius:0; image-rendering: pixelated; image-rendering: crisp-edges;">
         <div onclick="openAvatarSettings()" style="position:absolute; bottom:16px; right:-10px; background:var(--sf); border:2px solid var(--acc); color:var(--acc); width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">✎</div>
       </div>` 
    : `<div style="font-size:48px; margin-bottom:8px;">${USER.role === 'admin' ? '👑' : '🧑‍🚀'}</div>`;

  let baseHtml = `
    <div style="padding:16px;">
      <div class="card" style="text-align:center; padding:24px 16px; background:var(--collapse-bg); border-color:var(--border);">
        ${avatarImg}
        <div style="font-size:16px; font-weight:700; color:var(--t1); margin-bottom:6px;">${USER.email}</div>
        <div style="font-size:12px; color:#fff; background:var(--green); display:inline-block; padding:4px 12px; border-radius:20px; font-weight:700;">✓ 已驗證帳號</div>
      </div>
      
      <h4 style="font-size:13px; color:var(--hint-color); margin-bottom:8px;">個人資料</h4>
      <div class="set-list" style="margin-bottom:20px;">
        <div class="set-row"><span class="sn">加入日期</span><span style="font-family:var(--mono);color:var(--text-blue);font-weight:600;">${USER.joinDate || '未知'}</span></div>
        <div class="set-row"><span class="sn">個人總記錄數</span><span style="font-family:var(--mono);color:var(--text-blue);font-weight:600;">${S.records.length} 筆</span></div>
      </div>
      ${statsHtml}
  `;

  if (USER.role !== 'admin') {
    baseHtml += `<button onclick="logoutAccount()" class="btn-danger" style="width:100%;padding:14px;font-weight:700;font-size:15px;">登出帳號</button></div>`;
    document.getElementById('sub-body').innerHTML = baseHtml;
    return;
  }

  // 管理員專區
  try {
    let usersData = [];
    
    // 先嘗試呼叫後端 API
    try {
      const res = await fetch(`${API_BASE_URL}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminEmail: USER.email, token: USER.token })
      });
      const data = await res.json();
      if (data.success) {
        usersData = data.users;
      } else {
        throw new Error("後端回傳失敗");
      }
    } catch (apiErr) {
      // ⚠️ 如果 API 連線失敗 (無後端伺服器)，降級使用純前端 localStorage 模擬資料
      console.log('API 連線失敗，切換為本地模擬模式');
      const dbUsers = JSON.parse(localStorage.getItem('delivery_db_users') || '[]');
      
      // 確保至少有你自己的帳號顯示在列表
      if (dbUsers.length === 0) {
        usersData = [{ email: USER.email, role: 'admin', verified: true, createdAt: new Date().toISOString() }];
      } else {
        usersData = dbUsers;
      }
    }

    let adminHtml = '';
    usersData.forEach(u => {
      const vTag = u.verified ? '<span style="color:green;font-weight:700;">已驗證</span>' : '<span style="color:gray;">未驗證</span>';
      const roleTag = u.role === 'admin' ? '👑 ' : '';
      adminHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--t1);">${roleTag}${u.email}</div>
            <div style="font-size:11px; color:var(--t3);">${vTag} | ${new Date(u.createdAt).toLocaleDateString()}</div>
          </div>
          <button onclick="adminDeleteUser('${u.email}')" style="background:var(--red-d); color:var(--red); border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer;">刪除</button>
        </div>
      `;
    });

    document.getElementById('sub-body').innerHTML = baseHtml + `
      <h4 style="font-size:13px; color:var(--text-red); margin-bottom:8px;">⚙️ 會員權限管理 (管理員權限)</h4>
      <div class="card" style="max-height:200px; overflow-y:auto; padding:8px 12px; margin-bottom:16px;">
        ${adminHtml}
      </div>

      <button onclick="openAdminGasPriceEdit()" style="width:100%; padding:14px; border-radius:var(--rs); background:var(--blue); color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:12px; box-shadow:0 4px 12px rgba(59,130,246,0.3); cursor:pointer;">
        ⛽ 編輯全域油價設定
      </button>      

      <button onclick="openAnnouncementEdit()" style="width:100%; padding:14px; border-radius:var(--rs); background:var(--gold); color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:24px; box-shadow:0 4px 12px rgba(245,158,11,0.3); cursor:pointer;">
        📢 編輯首頁系統公告
      </button>

      <button onclick="logoutAccount()" class="btn-danger" style="width:100%;padding:14px;font-weight:700;font-size:15px;">登出當前帳號</button>
    </div>`;

  } catch (err) {
    // 只有在非常嚴重的渲染錯誤時才會顯示這段
    document.getElementById('sub-body').innerHTML = baseHtml + `
      <div style="text-align:center; color:var(--red); margin-bottom:16px;">介面載入發生錯誤</div>
      <button onclick="logoutAccount()" class="btn-danger" style="width:100%;padding:14px;font-weight:700;font-size:15px;">登出帳號</button>
    </div>`;
  }
}

/* ✨ 新增：管理員編輯全域油價設定 */
function openAdminGasPriceEdit() {
  document.getElementById('sub-title').textContent = '全域油價設定';
  document.getElementById('sub-top-right').innerHTML = '';
  
  // 預設油價
  let gp = { '92': 29.5, '95': 31.0, '98': 33.0 };
  try { 
    const saved = JSON.parse(localStorage.getItem('delivery_global_gas_prices'));
    if (saved) gp = saved;
  } catch(e) {}

  document.getElementById('sub-body').innerHTML = `
    <div class="card" style="display:flex; flex-direction:column; gap:16px; padding:16px;">
      <div style="font-size:12px; color:var(--hint-color); line-height:1.6; font-weight:700;">
        💡 在此設定的油價將會同步給所有外送員，他們新增車輛紀錄時將自動帶入此價格，且一般使用者無法手動修改。
      </div>
      <div style="border-top:1px dashed var(--border);"></div>
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">92 無鉛汽油 (NT$)</label>
        <input type="number" id="gp-92" class="finp" value="${gp['92']}" step="0.1" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">95 無鉛汽油 (NT$)</label>
        <input type="number" id="gp-95" class="finp" value="${gp['95']}" step="0.1" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">98 無鉛汽油 (NT$)</label>
        <input type="number" id="gp-98" class="finp" value="${gp['98']}" step="0.1" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
    </div>
    
    <button onclick="saveAdminGasPrice()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3); margin-top:8px;">✅ 發布全域油價</button>
  `;
  document.getElementById('sub-page').style.zIndex = '1100'; 
}

/* ✨ 修改：管理員真正將油價同步至 Cloudflare KV */
async function saveAdminGasPrice() {
  const gp = {
    '92': pf(document.getElementById('gp-92').value) || 29.5,
    '95': pf(document.getElementById('gp-95').value) || 31.0,
    '98': pf(document.getElementById('gp-98').value) || 33.0
  };

  showProgress('同步油價至伺服器...');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/gas-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({
        adminEmail: USER.email,
        prices: gp
      })
    });
    const data = await res.json();

    finishProgress(() => {
      if (data.success) {
        // 同步成功後，也更新自己手機的本地暫存
        localStorage.setItem('delivery_global_gas_prices', JSON.stringify(gp));
        toast('✅ 全域油價已更新並同步至雲端');
        document.getElementById('sub-page').style.zIndex = '200';
        openAccountStats(); 
      } else {
        toast('⚠️ 同步失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗，無法同步油價'));
  }
}

/* ✨ 新增：管理員編輯公告介面 */
function openAnnouncementEdit() {
  document.getElementById('sub-title').textContent = '系統公告設定';
  document.getElementById('sub-top-right').innerHTML = '';
  
  let ann = { active: false, text: '' };
  try { ann = JSON.parse(localStorage.getItem('delivery_global_announcement') || '{"active":false,"text":""}'); } catch(e){}

  document.getElementById('sub-body').innerHTML = `
    <div class="card" style="display:flex; flex-direction:column; gap:16px; padding:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:14px; font-weight:700; color:var(--t1);">📢 啟用首頁公告</span>
        <label class="switch">
          <input type="checkbox" id="ann-active" ${ann.active ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      
      <div style="border-top:1px dashed var(--border);"></div>
      
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">📝 公告內容支援換行</label>
        <textarea id="ann-text" class="finp" rows="5" placeholder="輸入要顯示給所有外送員的公告內容..." style="resize:none; font-size:14px; line-height:1.5;">${safeText(ann.text)}</textarea>
      </div>
    </div>
    
    <button onclick="saveAnnouncement()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3); margin-top:8px;">✅ 發布公告</button>
  `;
  // 透過提高 z-index 疊加在帳號頁面之上
  document.getElementById('sub-page').style.zIndex = '1100'; 
}

function saveAnnouncement() {
  const active = document.getElementById('ann-active').checked;
  const text = document.getElementById('ann-text').value.trim();
  
  if (active && text === '') {
    toast('⚠️ 啟用公告時內容不能為空');
    return;
  }
  
  localStorage.setItem('delivery_global_announcement', JSON.stringify({ active, text }));
  toast('✅ 公告設定已發布');
  
  // 關閉回到原本的管理員頁面並重新渲染首頁
  document.getElementById('sub-page').style.zIndex = '200';
  openAccountStats(); 
  if (S.tab === 'home') renderHome();
}

/* ══ 管理員刪除 API 呼叫 (帶上憑證) ══ */
async function adminDeleteUser(targetEmail) {
  const ok = await customConfirm(`確定要強制刪除並封鎖 <b>${targetEmail}</b> 嗎？`);
  if(!ok) return;
  
  showProgress('刪除帳號中...');
  try {
    const res = await fetch(`${API_BASE_URL}/admin/delete`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ adminEmail: USER.email, targetEmail: targetEmail })
    });
    const data = await res.json();
    
    finishProgress(() => {
      if(data.success) {
        toast('帳號已刪除');
        if (targetEmail === USER.email) logoutAccount(); 
        else openAccountStats(); 
      } else {
        toast('刪除失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗'));
  }
}

/* ══ 踢下線檢查 (顯示共用時間) ══ */
async function checkAccountStatus() {
  if (!USER.loggedIn) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ email: USER.email }) 
    });
    const data = await res.json();
    
    if (!data.active) {
      if (data.reason === 'kicked') {
        // 👈 將後端傳來的踢人時間格式化顯示
        const kickTime = new Date(data.kickedAt).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        toast(`⚠️ 此帳號已於 [${kickTime}] 在其他裝置登入，您已被強制登出`, 4000);
      } else {
        toast('⚠️ 您的帳號已被停權或刪除');
      }
      logoutAccount(); 
      return false;
    }
    return true;
  } catch(e) {
    return true; 
  }
}

// 攔截 confirmAddRecord (新增記錄) 加入檢查
/* ══ 替換：移除煩人的驗證進度條，登入後直接放行 ══ */
const originalConfirmAddRecord = confirmAddRecord;
confirmAddRecord = async function() {
  if (!USER.loggedIn) { toast('⚠️ 請先登入帳號'); return; }
  // 取消原本的「驗證權限中...」進度條，直接執行新增動作
  originalConfirmAddRecord();
}

/* ══ 登出清空權限 ══ */
function logoutAccount() {
  USER = { email: null, verified: false, loggedIn: false, joinDate: null, token: null, role: 'user' };
  saveUser();
  S.settings.autoBackup = false; 
  saveSettings();
  toast('已登出帳號');
  closeOverlay('sub-page');
  renderSettings();
}

/* ══ 升級版：外觀與主題設定 (深色模式與自訂背景) ══ */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', 'light');
}

function applyBackground() {
  document.body.style.background = '';
  document.body.style.boxShadow = 'none';
}

/* ══ 補齊：進階獎勵項目設定彈窗 ══ */
function openRewardSettings() {
  document.getElementById('sub-title').textContent = '獎勵項目設定';

    // 👈 將「新增」按鈕注入至右上角
  document.getElementById('sub-top-right').innerHTML = `<button onclick="openAddReward()" style="background:var(--acc); color:#fff; border:none; padding:6px 14px; border-radius:16px; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(255,107,53,0.3);">＋ 新增</button>`;

  let html = `<div class="set-list" style="margin-bottom:16px;">`;
  
  if (!S.settings.rewards || S.settings.rewards.length === 0) {
    html += `<div style="padding:16px; text-align:center; color:var(--t3); font-size:13px;">目前無設定任何獎勵</div>`;
  } else {
    S.settings.rewards.forEach((r, i) => {
      // 組合階距顯示字串
      let tiersStr = (r.tiers ||[]).map(t => `滿${t.orders}單 $${t.amount}`).join('｜');
      let dateStr = r.recurring ? '🔄 每週固定循環' : `📅 ${r.startDate} ~ ${r.endDate}`;
      
      html += `
        <div class="set-row" style="align-items:flex-start;">
          <span class="sn" style="flex:1;">
            <div style="font-weight:700; color:var(--t1); margin-bottom:4px;">${r.name}</div>
            <div class="sn-sub" style="color:var(--acc); font-weight:600; margin-bottom:2px;">${getPlatform(r.platformId).name}</div>
            <div class="sn-sub" style="font-size:10px;">${dateStr}</div>
            <div class="sn-sub" style="font-size:11px; margin-top:4px; color:var(--text-blue); font-family:var(--mono);">${tiersStr}</div>
          </span>
          <button onclick="event.stopPropagation(); deleteReward(${i});" class="del-btn" style="margin-top:4px;">✕</button>
        </div>`;
    });
  }
  html += `</div>`;
  
  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');
}

async function deleteReward(i) { 
  const ok = await customConfirm(`確定刪除「${S.settings.rewards[i]?.name}」？`); 
  if (!ok) return; 
  S.settings.rewards.splice(i, 1); 
  saveSettings(); 
  openRewardSettings(); // 重新渲染彈窗內的清單
  toast('✅ 獎勵已刪除'); 
}

/* 替換 openPlatformList 函式，並加上 togglePlatform 函式 */
function openPlatformList() {
  document.getElementById('sub-title').textContent = '平台列表';
  document.getElementById('sub-top-right').innerHTML = `<button onclick="closeOverlay('sub-page'); goPage('home');" style="background:var(--acc); color:#fff; border:none; padding:6px 14px; border-radius:16px; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(255,107,53,0.3);">完成</button>`;
  const platforms = Array.isArray(S.platforms) ? S.platforms : DEFAULT_PLATFORMS.map(p => ({ ...p }));
  const body = document.getElementById('sub-body');
  if (!body) {
    console.warn('sub-body element missing when opening platform list');
    return;
  }
  body.innerHTML = `
    <div class="set-list">
      ${platforms.length > 0 ? platforms.map(p => `
        <div class="set-row" onclick="openPlatformEdit('${safeText(p.id)}')">
          <div class="plat-color-dot" style="background:${p.color}"></div>
          <div class="sn">
            <div style="font-weight:600">${safeText(p.name)}</div>
            <div class="sn-sub">${p.active ? '✅ 已啟用' : '❌ 已停用'}</div>
          </div>
          <!-- 撥動開關 (stopPropagation 阻止點擊開關時進入編輯頁) -->
          <label class="switch" onclick="event.stopPropagation()">
            <input type="checkbox" ${p.active ? 'checked' : ''} onchange="togglePlatform('${safeText(p.id)}', this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      `).join('') : `<div class="empty-tip" style="padding:20px; text-align:center;">目前沒有可用平台，請稍後重新整理或回到設定頁</div>`}
    </div>
    <div style="margin-top:12px; font-size:11px; color:var(--hint-color); font-weight:700; text-align:center;">
      💡 點擊平台名稱可進入自訂顏色與詳細設定
    </div>`;
  openOverlay('sub-page');
}

/* 新增的獨立快速切換函式 */
function togglePlatform(id, isChecked) {
  const p = S.platforms.find(x => x.id === id);
  if (p) {
    p.active = isChecked;
    savePlatforms();
    if (S.tab === 'home') renderHome();
    renderSettings();
    openPlatformList(); // 重新渲染列表以更新文字狀態
  }
}

function openPlatformEdit(id) {
  const p = S.platforms.find(x=>x.id===id); if (!p) return;
  document.getElementById('sub-title').textContent = p.name; 
  document.getElementById('sub-body').innerHTML = `<div style="margin-bottom:16px; padding:12px; background:var(--sf2); border-radius:var(--rs); font-size:12px; color:var(--t2); line-height:1.6;"><strong>📝 結算與發薪規則：</strong><br>${p.ruleDesc ? p.ruleDesc.replace(/｜/g, '<br>') : ''}</div><div class="fg" style="margin-bottom:16px"><label>自訂平台顏色</label><div style="display:flex;gap:8px"><input type="color" id="sp-color-pick" value="${safeText(p.color)}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px"><input type="text" class="finp" id="sp-color" value="${safeText(p.color)}" style="flex:1"></div></div><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding:12px;background:var(--sf2);border-radius:var(--rs)"><label style="font-size:14px;font-weight:600;flex:1;cursor:pointer" for="sp-active">啟用此平台</label><input type="checkbox" id="sp-active" ${p.active?'checked':''} style="width:20px;height:20px;cursor:pointer"></div><div style="display:flex;gap:8px"><button onclick="openPlatformList()" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-size:14px;font-weight:600;cursor:pointer;">返回列表</button><button onclick="savePlatformEdit('${id}')" class="btn-acc" style="flex:2;padding:12px;font-size:14px;font-weight:700;border-radius:var(--rs)">儲存設定</button></div>`;
  document.getElementById('sp-color-pick').addEventListener('input', e => { document.getElementById('sp-color').value = e.target.value; });
}

function savePlatformEdit(id) { const p = S.platforms.find(x=>x.id===id); if (!p) return; p.color = document.getElementById('sp-color').value.trim() || p.color; p.active = document.getElementById('sp-active').checked; savePlatforms(); toast('✅ 平台已更新'); if (S.tab === 'home') renderHome(); renderSettings(); openPlatformList(); }
function openGoalSettings() { 
  document.getElementById('sub-title').textContent = '目標設定'; 
  document.getElementById('sub-top-right').innerHTML = '';
  document.getElementById('sub-add-btn')?.style.setProperty('display', 'none'); 
  const g = S.settings.goals || {}; 
  
  // 檢查是否為 0，若是則輸出空字串，透過 placeholder 提示，移除預設 0 的困擾
  const wVal = g.weekly > 0 ? g.weekly : '';
  const mVal = g.monthly > 0 ? g.monthly : '';
  const yVal = g.yearly > 0 ? g.yearly : '';

  // 美化版面配置
  document.getElementById('sub-body').innerHTML = `
    <div style="background:var(--sf2); padding:16px; border-radius:12px; margin-bottom:20px;">
      <div style="font-size:12px; color:var(--hint-color); line-height:1.6; font-weight:700;">
        💡 設定您的外送收入目標。<br>設定後即可在首頁「目標進度」追蹤您的達標狀況與剩餘天數！
      </div>
    </div>
    
    <div class="card" style="display:flex; flex-direction:column; gap:16px; padding:16px;">
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">📊 週目標 (NT$)</label>
        <input type="number" class="finp" id="g-weekly" value="${wVal}" placeholder="請輸入本週目標金額" inputmode="decimal" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
      
      <div style="border-top:1px dashed var(--border);"></div>
      
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">📈 月目標 (NT$)</label>
        <input type="number" class="finp" id="g-monthly" value="${mVal}" placeholder="請輸入本月目標金額" inputmode="decimal" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>

      <div style="border-top:1px dashed var(--border);"></div>

      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">👑 年目標 (NT$)</label>
        <input type="number" class="finp" id="g-yearly" value="${yVal}" placeholder="請輸入本年目標金額" inputmode="decimal" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
    </div>
    
    <button onclick="saveGoals()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3); margin-top:8px;">✅ 儲存目標設定</button>
  `; 
  openOverlay('sub-page'); 
}

function saveGoals() { 
  S.settings.goals = { 
    weekly: pf(document.getElementById('g-weekly').value), 
    monthly: pf(document.getElementById('g-monthly').value),
    yearly: pf(document.getElementById('g-yearly').value)
  }; 
  saveSettings(); 
  closeOverlay('sub-page'); 
  renderSettings(); 
  if(S.tab === 'home') renderHome();
  toast('✅ 目標已儲存'); 
}
/* ══ 替換：進階獎勵介面與邏輯 ══ */
let tempTiers =[];

/* ══ 替換：新增進階獎勵項目 ══ */
function openAddReward() { 
  document.getElementById('sub-title').textContent = '新增進階獎勵項目'; 
  
  // 👈 進入新增表單時，清空右上角按鈕，避免殘留
  document.getElementById('sub-top-right').innerHTML = ''; 
  
  tempTiers =[{orders:0, amount:0}, {orders:0, amount:0}];
  renderRewardForm();
}

window.addRewardTier = function() {
  tempTiers.push({orders:0, amount:0});
  renderRewardForm();
}

function renderRewardForm() {
  const platOpts = S.platforms.filter(p=>p.active).map(p=>`<option value="${safeText(p.id)}">${safeText(p.name)}</option>`).join(''); 
  let tiersHtml = '';
  tempTiers.forEach((t, idx) => {
    tiersHtml += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;background:var(--bg-input);padding:8px;border-radius:8px;">
      <div class="fg"><label>第 ${idx+1} 階 (單數)</label><input type="number" class="finp" value="${t.orders}" onchange="tempTiers[${idx}].orders=this.value"></div>
      <div class="fg"><label>獎金 (NT$)</label><input type="number" class="finp" value="${t.amount}" onchange="tempTiers[${idx}].amount=this.value"></div>
    </div>`;
  });

  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>獎勵名稱</label><input type="text" class="finp" id="rw-name" placeholder="例：週末衝單獎勵"></div>
    <div class="fg" style="margin-bottom:10px"><label>適用平台</label><select class="fsel" id="rw-plat">${platOpts}</select></div>
    <div style="display:flex; gap:8px; margin-bottom:10px;">
      <div class="fg" style="flex:1;"><label>開始日期</label><input type="date" class="finp" id="rw-start" value="${todayStr()}"></div>
      <div class="fg" style="flex:1;"><label>結束日期</label><input type="date" class="finp" id="rw-end" value="${todayStr()}"></div>
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; padding:10px; background:var(--bg-input); border-radius:8px;">
      <span style="font-size:13px; font-weight:700; color:var(--t1);">🔄 固定循環 (每週自動套用)</span>
      <label class="switch"><input type="checkbox" id="rw-recurring"><span class="slider"></span></label>
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:12px; color:var(--t3); font-weight:700;">設定獎勵階距</label>
      ${tiersHtml}
      <button onclick="addRewardTier()" style="width:100%; padding:8px; border:1px dashed var(--acc); background:transparent; color:var(--acc); border-radius:8px; cursor:pointer; font-weight:700; margin-top:4px;">+ 再新增一階獎勵</button>
    </div>
    <button onclick="saveNewReward()" class="btn-acc" style="width:100%;padding:14px;font-size:15px;font-weight:800;border-radius:var(--rs); margin-top:8px;">✅ 儲存獎勵</button>
  `; 
  openOverlay('sub-page'); 
}

function saveNewReward() { 
  const name = document.getElementById('rw-name').value.trim(); 
  if (!name) { toast('請輸入獎勵名稱'); return; } 
  if (!S.settings.rewards) S.settings.rewards=[]; 
  
  const tiers = tempTiers.map(t => ({ orders: pf(t.orders), amount: pf(t.amount) })).filter(t => t.orders > 0 && t.amount > 0);
  if(tiers.length === 0) { toast('請至少設定一階有效的獎勵'); return; }

  S.settings.rewards.push({ 
    id: newId(), name, 
    platformId: document.getElementById('rw-plat').value, 
    startDate: document.getElementById('rw-start').value,
    endDate: document.getElementById('rw-end').value,
    recurring: document.getElementById('rw-recurring').checked,
    tiers: tiers
  }); 
  saveSettings(); 
  closeOverlay('sub-page'); 
  renderSettings(); 
  toast('✅ 獎勵已新增'); 
}

function doBackup() { const data = { exportedAt:new Date().toISOString(), records:S.records, platforms:S.platforms, settings:S.settings, vehicles:S.vehicles, vehicleRecs:S.vehicleRecs }; const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `外送記錄_${todayStr()}.json`; a.click(); URL.revokeObjectURL(url); toast('✅ 備份完成'); }
function doRestore() { const fi = document.getElementById('restore-file'); fi.onchange = async () => { const file = fi.files[0]; if(!file) return; try { const text = await file.text(); const data = JSON.parse(text); const ok = await customConfirm('確定用此備份<strong>覆蓋</strong>現有資料？'); if (!ok) return; if (data.records) { S.records=data.records; saveRecords(); } if (data.platforms) { S.platforms=data.platforms; savePlatforms(); } if (data.settings) { S.settings=data.settings; saveSettings(); } if (data.vehicles) { S.vehicles=data.vehicles; saveVehicles(); } if (data.vehicleRecs) { S.vehicleRecs=data.vehicleRecs; saveVehicleRecs(); } toast('✅ 還原成功'); renderSettings(); renderHome(); } catch { toast('❌ 檔案格式錯誤'); } fi.value=''; }; fi.click(); }
/* ══ 匯出 Excel：彈出年份選擇 ══ */
function openExportModal() {
  document.getElementById('sub-title').textContent = '匯出 Excel';
  document.getElementById('sub-top-right').innerHTML = '';

  // 自動抓取資料中包含的所有年份
  let years = new Set();
  S.records.forEach(r => { if(r.date) years.add(r.date.substring(0,4)); });
  S.vehicleRecs.forEach(r => { if(r.date) years.add(r.date.substring(0,4)); });
  
  // 轉為陣列並由大到小排序 (最新年份在最上)
  let yearArr = Array.from(years).sort((a,b) => b.localeCompare(a)); 
  if(yearArr.length === 0) yearArr = [new Date().getFullYear().toString()];

  let optionsHtml = `<option value="all">全部年份</option>`;
  yearArr.forEach(y => {
    // 預設選中當前年份
    const isCurrent = y === new Date().getFullYear().toString();
    optionsHtml += `<option value="${y}" ${isCurrent ? 'selected' : ''}>${y} 年</option>`;
  });

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      <div class="card" style="display:flex; flex-direction:column; gap:16px;">
        <div style="font-size:13px; color:var(--t2); font-weight:700; line-height:1.5;">
          💡 請選擇要匯出的資料年份，系統將會為您產生多活頁簿的 Excel 檔案。
        </div>
        <select id="export-year-select" class="fsel" style="font-size:16px; font-weight:800; text-align:center; color:var(--acc);">
          ${optionsHtml}
        </select>
        <button onclick="executeExcelExport()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">📊 確定匯出</button>
      </div>
    </div>
  `;
  openOverlay('sub-page');
}

/* 執行匯出前置作業 */
window.executeExcelExport = function() {
  const targetYear = document.getElementById('export-year-select').value;
  closeOverlay('sub-page');
  doExportExcel(targetYear);
}

/* ══ 匯出多活頁簿 Excel 檔案 (.xlsx) - 支援年份過濾 ══ */
function doExportExcel(targetYear) {
  if (typeof XLSX === 'undefined') {
    toast('⚠️ Excel 匯出套件載入中，請稍後再試');
    return;
  }

  showProgress('產生 Excel 檔案中...');

  setTimeout(() => {
    // 建立時間過濾器
    const isMatch = (r) => targetYear === 'all' || (r.date && r.date.startsWith(targetYear));

    // 1. 行程記錄
    const regularRecs = S.records.filter(r => isMatch(r) && !r.isCashTip && !r.isPunchOnly).map(r => {
      const p = getPlatform(r.platformId);
      return { '日期': r.date, '平台': p.name, '接單數': r.orders||0, '里程(km)': r.mileage||0, '行程收入': r.income||0, '固定獎勵': r.bonus||0, '臨時獎勵': r.tempBonus||0, 'APP小費': r.tips||0, '總收入': recTotal(r), '工時(小時)': r.hours||0, '上線時間': r.punchIn||'', '下線時間': r.punchOut||'', '備註': r.note||'' };
    });

    // 2. 現金小費
    const cashTipRecs = S.records.filter(r => isMatch(r) && r.isCashTip).map(r => {
      const p = getPlatform(r.platformId);
      return { '日期': r.date, '時間': r.time||'', '平台': p.name, '客給金額': r.givenAmt||0, '應收金額': r.costAmt||0, '實收小費': r.cashTipAmt||0, '備註': r.note||'' };
    });

    // 3. 加油記錄 (排除電動車)
    const gasRecs = S.vehicleRecs.filter(r => isMatch(r) && r.type === 'fuel' && r.fuelType !== 'electric').map(r => {
      const v = S.vehicles.find(x => x.id === r.vehicleId);
      const diff = pf(r.km) - pf(r.prevKm);
      return { '日期': r.date, '時間': r.time||'', '車輛名稱': v ? v.name : '未知', '油品': r.fuelType||'', '上次里程': r.prevKm||0, '加油里程': r.km||0, '行駛里程': diff > 0 ? diff : 0, '加油量(L)': r.liters||0, '單價': r.price||0, '折扣': r.discount||0, '花費金額': r.amount||0 };
    });

    // 4. 電動車換電與里程
    const evRecs = S.vehicleRecs.filter(r => isMatch(r) && r.type === 'fuel' && r.fuelType === 'electric').map(r => {
      const v = S.vehicles.find(x => x.id === r.vehicleId);
      const diff = pf(r.km) - pf(r.prevKm);
      return { '日期': r.date, '時間': r.time||'', '車輛名稱': v ? v.name : '未知', '上次里程': r.prevKm||0, '換電里程': r.km||0, '行駛里程': diff > 0 ? diff : 0 };
    });

    // 5. 保養維修記錄
    const maintRecs = S.vehicleRecs.filter(r => isMatch(r) && r.type === 'maintenance').map(r => {
      const v = S.vehicles.find(x => x.id === r.vehicleId);
      return { '日期': r.date, '時間': r.time||'', '車輛名稱': v ? v.name : '未知', '保養里程': r.km||0, '保養項目': (r.items||[]).join(', '), '花費金額': r.amount||0, '店家': r.shop||'', '付款方式': r.payMethod||'', '備註': r.note||'' };
    });

    // 防止空資料表報錯的保護機制
    const safeData = (arr) => arr.length > 0 ? arr : [{'系統提示': '該年份尚無此項目記錄'}];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(regularRecs)), "行程記錄");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(cashTipRecs)), "現金小費");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(gasRecs)), "加油記錄");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(evRecs)), "電動車里程");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(maintRecs)), "保養維修");

    const fileNameYear = targetYear === 'all' ? '全部' : targetYear;
    try {
      XLSX.writeFile(wb, `外送記錄（${fileNameYear}年）${todayStr()}.xlsx`);
      finishProgress(() => toast(`✅ ${fileNameYear}年 Excel 匯出完成`));
    } catch (err) {
      finishProgress(() => toast('❌ 匯出失敗，請重試'));
    }
  }, 500); 
} 

async function doClearData() { 
  const ok = await customConfirm('⚠️ 確定要<strong>清除所有記錄與車輛資料</strong>嗎？<br>（這將保留您的平台設定與目標）此動作無法復原！'); 
  if (!ok) return; 
  S.records=[]; S.vehicles=[]; S.vehicleRecs=[]; 
  saveRecords(); saveVehicles(); saveVehicleRecs(); 
  toast('已清除記錄與車輛資料'); 
  renderHome(); renderSettings(); 
}

async function doReset() { 
  const ok = await customConfirm('⚠️ 確定要<strong>重置所有設定和資料</strong>嗎？<br>App將完全恢復到剛安裝的初始狀態！此動作無法復原！'); 
  if (!ok) return; 
  S.records = []; 
  S.settings = { ...DEFAULT_SETTINGS, shopHistory:[] }; 
  S.platforms = DEFAULT_PLATFORMS.map(p => ({...p}));
  S.vehicles = []; 
  S.vehicleRecs = []; 
  saveRecords(); saveSettings(); savePlatforms(); saveVehicles(); saveVehicleRecs(); 
  toast('已重置所有設定和資料'); 
  renderHome(); renderSettings(); 
}

/* ══ 聯絡我們：信箱與一鍵複製 ══ */
function openContactUs() {
  document.getElementById('sub-title').textContent = '聯絡我們';
  document.getElementById('sub-top-right').innerHTML = '';
  
  const email = 'cws38721@gmail.com'; // 👈 這裡可以替換成您真實的 Email
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; text-align:center;">
      <div style="font-size:54px; margin-bottom:16px;">✉️</div>
      <div style="font-size:15px; font-weight:700; color:var(--t1); margin-bottom:12px; line-height:1.6;">
        如有任何問題、功能建議，<br>或帳號相關協助，歡迎來信：
      </div>
      <div style="font-family:var(--mono); font-size:20px; font-weight:800; color:var(--acc); margin-bottom:24px; background:var(--bg-input); padding:16px; border-radius:12px; border:2px dashed var(--acc);">
        ${email}
      </div>
      <button onclick="copyEmailToClipboard('${email}')" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">
        📋 一鍵複製信箱
      </button>
    </div>
  `;
  
  document.getElementById('sub-page').style.zIndex = '1100'; // 確保蓋過關於我們頁面
  openOverlay('sub-page');
}

// 支援各種手機瀏覽器的一鍵複製功能 (Fallback 機制)
function copyEmailToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      toast('✅ 信箱已複製成功！');
    }).catch(() => {
      fallbackCopyTextToClipboard(text);
    });
  } else {
    fallbackCopyTextToClipboard(text);
  }
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  // 避免手機畫面往下捲動
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    toast('✅ 信箱已複製成功！');
  } catch (err) {
    toast('⚠️ 複製失敗，請長按信箱手動複製');
  }
  document.body.removeChild(textArea);
}

/* ══ 關於我們：彈窗內容渲染函式 ══ */
function openSpecialThanks() {
  document.getElementById('sub-title').textContent = '特別感謝';
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px 8px; font-size:14px; color:var(--t1); line-height:1.6;">
      <p style="margin-bottom:16px; font-weight:700;">💡 特別感謝【 心酸熊貓人 】提供「 外送薪資記錄 」的想法。</p>
      <hr style="border-color:2px; border-color: #000000;"></hr></br>
      <p style="margin-bottom:16px; font-weight:500;">之前看過運轉手帳本APP，那時就在想「外送員要是也有這種APP就好了」，只是當時我在忙，就沒放在心上；</p>
      <p style="margin-bottom:16px; font-weight:500;">這時剛好遇到【 心酸熊貓人 】提出做「 外送薪資記錄 」的想法，因此也想做看看；開發過程不斷地有新想法，一直加入新功能，修改了數不清次，終於把『 外送記錄與分析APP 』做出來！</p>
      <hr style="border-color:2px; border-color: #000000;"></hr></br>
      <p style="margin-bottom:16px; font-weight:800;">真的非常感謝【 心酸熊貓人 】的這個想法，沒有這個想法，就沒有這個APP！🙏</p>
      <a href="https://www.facebook.com/share/1LjsAm2Afv/" target="_blank" style="display:flex; align-items:center; justify-content:center; gap:8px; padding:12px 16px; background: #DB2A75; color:var(--schedule-bg); text-decoration:none; border-radius:18px; font-weight:800; font-size:18px;">
        f  按讚 心酸熊貓人 🐼
      </a>
    </div>
  `;
  // 動態提高 sub-page 的 z-index，使其能完美覆蓋在 about-page 之上
  document.getElementById('sub-page').style.zIndex = '1100';
  openOverlay('sub-page');
}

/* ══ 替換：隱私權政策彈窗 (全螢幕獨立視窗與返回按鈕) ══ */
function openPrivacyPolicy(fromRegister = false) {
  let btnHtml = '';
  if (fromRegister) {
    btnHtml = `<button onclick="agreePrivacyPolicy()" class="btn-acc" style="width:100%;padding:14px;font-size:16px;font-weight:600;border-radius:var(--rs); margin-top:24px; box-shadow:0 4px 12px rgba(255,107,53,0.3);">✅ 我已完整閱讀並同意</button>`;
  }

  document.getElementById('privacy-body').innerHTML = `
    <div style="font-size:13px; color:var(--t1); line-height:1.8; padding:0px 4px;">
      
      <div style="color:var(--acc); font-size:16px; font-weight:700; margin-bottom:3px;">1. 我們使用到的資料</div>
      <div style="background:var(--sf2); padding:10px 14px; border-radius:12px; margin-bottom:16px;">
        • 您的帳號（電子郵件）僅作為註冊與登入身份驗證使用。
      </div>

      <div style="color:var(--acc); font-size:16px; font-weight:700; margin-bottom:3px;">2. 我們如何使用資訊</div>
      <div style="background:var(--sf2); padding:10px 14px; border-radius:12px; margin-bottom:16px;">
        • 僅用於統計系統整體的「總使用人數」，不做任何其他商業用途。
      </div>

      <div style="color:var(--acc); font-size:16px; font-weight:700; margin-bottom:3px;">3. 資料及使用安全</div>
      <div style="background:var(--sf2); padding:14px; border-radius:12px; border:1px solid var(--border); margin-bottom:16px; box-shadow:0 2px 8px rgba(0,0,0,0.02);">
        
        <div style="display:flex; align-items:center; gap:6px; color:var(--text-blue); font-weight:800; font-size:12px; margin-bottom:6px;">
          <span>🛡️</span> 基礎防禦與本機隱私
        </div>
        <div style="padding-left:4px; margin-bottom:12px;">
          • 採用 Cloudflare 部署，預設啟用最高等級 <b>TLS 1.3 (HTTPS)</b> 加密傳輸。<br>
          • 您的外送記錄與資料<b>僅儲存於「您的個人裝置」上</b>，絕不會上傳至任何雲端伺服器。
        </div>

        <div style="display:flex; align-items:center; gap:6px; color:var(--red); font-weight:800; font-size:12px; margin-top:16px; margin-bottom:6px;">
          <span>🔐</span> 軍規級密碼安全 (PBKDF2)
        </div>
        <div style="padding-left:4px;">
          • 我們採用美國國家標準技術研究所 (NIST) 認可的 <b>PBKDF2</b> 安全演算法。<br>
          <div style="margin-top:8px; padding:10px; border-left:3px solid var(--acc); background:var(--sf); border-radius:4px 8px 8px 4px;">
            <span style="color:var(--acc); font-weight:800;">優勢一：</span>每次產生獨立隨機鹽值（Salting），徹底無效化彩虹表（Rainbow Table）攻擊。<br>
            <span style="color:var(--acc); font-weight:800;">優勢二：</span>超高強度迭代運算（高達 10 萬次），大幅增加暴力破解所需的時間與成本。<br>
            <span style="color:var(--acc); font-weight:800;">優勢三：</span>強制嚴格的 12 字元密碼長度與複雜度要求，從源頭阻斷字典攻擊。
          </div>
        </div>
      </div>

      <div style="color:var(--acc); font-size:16px; font-weight:700; margin-bottom:3px;">4. 您的權利與聯絡方式</div>
      <div style="background:var(--sf2); padding:10px 14px; border-radius:12px; margin-bottom:16px;">
        • 您可隨時聯繫我們，要求永久刪除您的註冊帳號。<br>
        • 如有任何問題，請透過【設定】→「關於我們」→『聯絡我們』與我們聯繫。
      </div>

      ${btnHtml}
      <div style="height:32px;"></div>
    </div>
  `;
  
  openOverlay('privacy-page');
}

/* ══ 同意隱私權後，關閉全螢幕視窗並回到註冊頁 ══ */
function agreePrivacyPolicy() {
  privacyAgreed = true;
  
  // 關閉隱私權頁面，下方原本的註冊頁 (sub-page) 就會完美顯露出來
  closeOverlay('privacy-page');
  
  // 動態修改註冊表單上的勾選框，而不重新渲染整個表單，以保留使用者輸入的帳密！
  const chkBox = document.getElementById('privacy-chk-box');
  const chkText = document.getElementById('privacy-chk-text');
  if (chkBox) {
    chkBox.style.borderColor = 'var(--acc)';
    chkBox.style.background = 'var(--acc)';
    chkBox.innerHTML = '<span style="color:#fff; font-size:14px; font-weight:900;">✓</span>';
  }
  if (chkText) {
    chkText.style.color = 'var(--t1)';
  }
}

/* ══ 驗證工時輸入限制 ══ */
function enforceTimeLimits() {
  const hEl = document.getElementById('f-hrs-val');
  const mEl = document.getElementById('f-min-val');
  
  if (hEl.value !== '') {
    let h = parseInt(hEl.value);
    if (h < 0) hEl.value = 0;
    if (h > 24) hEl.value = 24;
  }
  if (mEl.value !== '') {
    let m = parseInt(mEl.value);
    if (m < 0) mEl.value = 0;
    if (m > 59) mEl.value = 59;
  }
  // 當輸入 24 小時時，分鐘自動鎖定為 0
  if (parseInt(hEl.value) === 24) {
    mEl.value = 0;
  }
}

/* ══ 驗證工時邏輯規則 (失去焦點時觸發) ══ */
function enforceTimeRules() {
  const hEl = document.getElementById('f-hrs-val');
  const mEl = document.getElementById('f-min-val');
  let h = parseInt(hEl.value || 0);
  let m = parseInt(mEl.value || 0);

  if (h === 24) {
    mEl.value = 0;
  } else if (h === 0) {
    // 當小時輸入0時，若使用者有輸入且分鐘為0，強制改為1分鐘以符合防呆
    if (m === 0 && (hEl.value !== '' || mEl.value !== '')) {
       mEl.value = 1;
       toast('⏱️ 工時不能為 0，已自動設為 1 分鐘');
    }
  }
}

/* ══ 智慧油價系統 (帶入管理員全域預設，且允許自行修改) ══ */
window.applyGlobalGasPrice = function() {
  const fuelTypeEl = document.getElementById('vr-fuel-type');
  const priceEl = document.getElementById('vr-price');

  if (!fuelTypeEl || !priceEl) return;

  const type = fuelTypeEl.value;

  // 預設油價
  let gp = { '92': 29.5, '95': 31.0, '98': 33.0 };
  
  try { 
    const saved = JSON.parse(localStorage.getItem('delivery_global_gas_prices'));
    // 🛡️ 防呆機制：將預設值與本地存檔「合併」，避免缺少單一油品導致無法更新
    if (saved && typeof saved === 'object') {
      gp = { ...gp, ...saved }; 
    }
  } catch(e) {
    console.error("油價讀取失敗，使用預設值", e);
  }

  // 確保價格存在（即便是 0 也能寫入）
  if (gp[type] !== undefined) {
    // 自動帶入對應的油價
    priceEl.value = gp[type];
    
    // 確保輸入框為可編輯狀態
    priceEl.readOnly = false;
    priceEl.style.opacity = '1';
    priceEl.style.pointerEvents = 'auto';
    
    // 觸發總計計算
    calcVehFuel(); 
  }
};

/* ══ Service Worker 正式註冊 ══ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(r => console.log('SW 已註冊', r.scope))
      .catch(e => console.warn('SW 註冊失敗', e));
  });
}

/* ══ 升級版：外觀與自訂背景套用 ══ */
function applyBackground() {
  const bg = S.settings.bg;
  const root = document.documentElement;
  
  if (bg && bg !== '#fafafa' && bg !== '#424242') {
    // 設定身體背景圖片與白色半透明遮罩
    document.body.style.background = `url('${bg}') center/cover fixed no-repeat`;
    document.body.style.boxShadow = 'inset 0 0 0 9999px rgba(255, 255, 255, 0.3)';
    
    // 讓主頁面透明化以透出背景圖
    root.style.setProperty('--bg', 'transparent');
    root.style.setProperty('--bg-header', 'rgba(255, 255, 255, 0.6)');
    root.style.setProperty('--overlay-bg', 'rgba(240, 244, 248, 0.95)');
  } else {
    // 沒選背景圖時，恢復純色
    document.body.style.background = ''; 
    document.body.style.boxShadow = 'none';
    
    root.style.setProperty('--bg', '#f0f4f8');
    root.style.setProperty('--bg-header', 'rgba(240, 244, 248, 0.85)');
    root.style.setProperty('--overlay-bg', '#f0f4f8');
  }
}

/* ══ 真正儲存為實體檔案至本機資料夾 (File System API 或 下載) ══ */
async function confirmBackupToFile() {
  const ok = await customConfirm('是否要備份目前資料到本機 JSON 檔？');
  if (ok) {
    await doBackupToFile();
  }
}

async function doBackupToFile() {
  const data = { 
    exportedAt: new Date().toISOString(), 
    records: S.records, 
    platforms: S.platforms, 
    settings: S.settings, 
    vehicles: S.vehicles, 
    vehicleRecs: S.vehicleRecs 
  };
  
  const jsonStr = JSON.stringify(data, null, 2);
  const fileName = `外送記錄_${todayStr()}.json`;

  try {
    // 優先嘗試使用 File System Access API (支援 Chrome/Edge/Android)
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types:[{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      
      // ✅ 只有在這裡 (真正寫入檔案完畢後) 才會更新備份時間
      updateLocalBackupTime();
      toast('✅ 成功儲存至本機資料夾！');
      
    } else {
      // 蘋果 iOS / Safari 降級使用傳統下載模式
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      
      // ⚠️ 備註：傳統下載模式無法偵測使用者是否點擊取消，所以只要點了就會更新時間
      updateLocalBackupTime();
      toast('✅ 備份檔已下載');
    }
  } catch (err) {
    // 如果使用者按了「取消」，瀏覽器會拋出 AbortError，此時什麼都不做 (也不會更新時間)
    if (err.name === 'AbortError') {
      console.log('使用者取消了儲存檔案');
    } else {
      console.error(err);
      toast('⚠️ 儲存失敗');
    }
  }
}

// 將更新時間的邏輯抽出來，讓程式碼更乾淨
function updateLocalBackupTime() {
  const now = new Date();
  S.settings.lastLocalBackup = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  saveSettings();
  renderSettings(); // 重新渲染設定頁面，更新顯示的時間
}

/* ══ 替換：備份至 Google Drive 引導 ══ */
function backupToGoogleDrive() {
  customConfirm(`
    <div style="text-align:center;">
      <div style="font-size:40px; margin-bottom:12px;">☁️</div>
      <h3 style="margin-bottom:8px; color:var(--t1);">備份至 Google 雲端硬碟</h3>
      <p style="font-size:13px; color:var(--t2); line-height:1.6; text-align:left;">
        請先下載「Google雲端硬碟APP」，並登入您的帳號。<br><br>
        依照下方指示：<br>
        1. 點擊「確定」後，會跳出【下載視窗】，請點擊「<b>儲存位置</b>」按鈕。<br>
        2. 請您選擇「Google雲端硬碟」，然後按「<b>儲存！</b>」即可完成備份。<br>
      </p>
    </div>
  `).then(ok => {
    if (ok) {
      doBackupToFile(); // 僅觸發下載，不開啟新網頁
    }
  });
}

/* ══ 從雲端還原資料 ══ */
async function restoreFromCloud(email) {
  showProgress('正在從雲端還原資料...');
  try {
    const res = await fetch(`${API_BASE_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ email: email })
    });
    const result = await res.json();
    
    finishProgress(() => {
      if (result.success && result.data) {
        // 如果雲端有資料，就覆蓋掉手機本機的資料
        if (result.data.records.length > 0) S.records = result.data.records;
        if (result.data.vehicles.length > 0) S.vehicles = result.data.vehicles;
        if (result.data.vehicleRecs.length > 0) S.vehicleRecs = result.data.vehicleRecs;
        
        // 若雲端有設定，與預設值合併
        if (Object.keys(result.data.settings).length > 0) {
          S.settings = { ...S.settings, ...result.data.settings };
          if (result.data.settings.platforms && result.data.settings.platforms.length > 0) {
            S.platforms = result.data.settings.platforms;
          }
        }
        
        // 儲存到 LocalStorage
        saveRecords();
        saveVehicles();
        saveVehicleRecs();
        saveSettings();
        savePlatforms();

        toast('☁️ 雲端資料還原成功！');
        
        // 重新整理畫面
        renderHome();
        renderSettings();
      }
    });
  } catch (e) {
    finishProgress(() => toast('⚠️ 雲端還原失敗，請檢查網路'));
  }
}

/* ══ 初次使用平台懸浮設定 ══ */
window.checkAndPromptPlatformSetup = function() {
  const hasActivePlatform = S.platforms && S.platforms.some(p => p.active);
  if (!hasActivePlatform) {
    setTimeout(() => {
      showInitialSetupModal();
    }, 400);
  }
};
function showInitialSetupModal() {
  const ov = document.createElement('div');
  ov.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:24px; opacity:0; transition:0.3s;";
  
  let platHtml = DEFAULT_PLATFORMS.map(p => `
    <label style="display:flex; align-items:center; gap:12px; padding:14px; background:var(--bg-input); border-radius:12px; margin-bottom:8px; cursor:pointer; border:1px solid var(--border);">
      <input type="checkbox" value="${p.id}" style="width:20px; height:20px; accent-color:var(--acc);">
      <span style="font-weight:700; font-size:15px; color:var(--t1);">${p.name}</span>
    </label>
  `).join('');

  ov.innerHTML = `
    <div style="background:#fff; border-radius:24px; padding:24px; width:100%; max-width:340px; box-shadow:0 20px 50px rgba(0,0,0,0.2); transform:translateY(20px); transition:0.3s;" id="init-setup-box">
      <div style="font-size:44px; text-align:center; margin-bottom:12px;">👋</div>
      <h3 style="text-align:center; font-size:22px; font-weight:800; color:var(--t1); margin-bottom:8px;">歡迎使用！</h3>
      <p style="text-align:center; font-size:13px; color:var(--t2); font-weight:600; margin-bottom:24px;">請先勾選您有在跑的外送平台：</p>
      ${platHtml}
      <button id="init-setup-btn" style="width:100%; background:var(--acc); color:#fff; border:none; padding:16px; border-radius:16px; font-size:16px; font-weight:800; margin-top:16px; box-shadow:0 6px 16px rgba(255,107,53,0.3); cursor:pointer; transition:0.2s;">開始記錄 ➔</button>
    </div>
  `;
  document.body.appendChild(ov);

  requestAnimationFrame(() => {
    ov.style.opacity = '1';
    document.getElementById('init-setup-box').style.transform = 'translateY(0)';
  });

  document.getElementById('init-setup-btn').addEventListener('click', () => {
    const checks = ov.querySelectorAll('input[type="checkbox"]');
    let hasChecked = false;
    checks.forEach(chk => {
      const p = S.platforms.find(x => x.id === chk.value);
      if (p) p.active = chk.checked;
      if (chk.checked) hasChecked = true;
    });

    if (!hasChecked) { toast('⚠️ 請至少選擇一個平台'); return; }

    savePlatforms();
    
    // 👇 平滑退場，不重新整理網頁
    ov.style.opacity = '0';
    document.getElementById('init-setup-box').style.transform = 'translateY(20px)';
    setTimeout(() => {
      ov.remove();
      // 強制寫入狀態並重新渲染
      S.homeSubTab = 'schedule';
      goPage('home');
      renderSettings();
      setTimeout(() => updateNavIndicator('home'), 100);
      toast('✅ 平台設定完成！');
    }, 300);
  });
}
/* ══ 讓「底部導覽列的滑動背景膠囊」能夠在手機轉向（直向轉橫向）、或是螢幕大小改變時，自動重新計算位置並對齊圖示。 ══ */
window.addEventListener('resize', () => { if (S.tab) updateNavIndicator(S.tab); });

async function init() {
  try { await loadAll(); } catch (e) { console.error(e); toast('資料載入失敗'); }
  
  applyBackground();
  fetchGlobalGasPrice();
  initReminderCheck();

  if (!S.platforms || S.platforms.length === 0) {
    S.platforms = DEFAULT_PLATFORMS.map(p => ({...p}));
    savePlatforms();
  }

  // 設定頁面狀態並強制渲染
  S.homeSubTab = 'schedule'; 
  goPage('home');

  // 給予一點時間讓 DOM 繪製，再對齊導覽列 (確保滑動正常)
  setTimeout(() => {
    updateNavIndicator('home');
  }, 100);

  // 檢查是否初次使用
  setTimeout(() => {
    if (window.checkAndPromptPlatformSetup) window.checkAndPromptPlatformSetup();
  }, 600);
}

/* ══ iOS Safari 安全啟動：確保 DOM 完全就緒後才執行所有初始化 ══
   defer 在 iOS 上不保證 DOMContentLoaded 已觸發，
   必須明確包在事件內才能防止白屏。 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    _bindNavEvents();
    init();
  });
} else {
  // readyState 已是 interactive 或 complete（reload / bfcache）
  _bindNavEvents();
  init();
}
/* ══ 7. 設定管理與啟動 結束 ═══════════════════════════════════ */
