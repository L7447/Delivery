/* ══════════════════════════════════════════════════════
   外送記帳 App — script.js
   功能：打卡、多平台記帳、報表、目標、獎勵設定
   ══════════════════════════════════════════════════════ */

/* ── localStorage 資料鍵值 ──────────────────────── */
const KEYS = {
  records:   'delivery_records',    // 記錄陣列
  platforms: 'delivery_platforms',  // 平台設定
  settings:  'delivery_settings',   // App 設定（目標、獎勵等）
  punch:     'delivery_punch_live',  // 即時打卡狀態
};

/* ── 預設平台（三家主流外送平台）─────────────────── */
const DEFAULT_PLATFORMS = [
  { id:'uber',      name:'Uber Eats', color:'#06C167', active:true,  settleDay:15, payDay:25 },
  { id:'foodpanda', name:'foodpanda', color:'#D70F64', active:true,  settleDay:1,  payDay:10 },
  { id:'lalamove',  name:'LaLaMove',  color:'#FF6600', active:false, settleDay:0,  payDay:0  },
];

/* ── 預設 App 設定 ───────────────────────────────── */
const DEFAULT_SETTINGS = {
  goals:   { weekly: 0, monthly: 0 }, // 週目標/月目標
  rewards: [],                         // 獎勵列表
};

/* ══ 全域狀態物件 ════════════════════════════════ */
const S = {
  tab:       'home',                  // 目前 tab
  rptY:      new Date().getFullYear(), // 報表年份
  rptM:      new Date().getMonth()+1,  // 報表月份
  rptView:   'overview',              // 報表子頁
  calY:      new Date().getFullYear(), // 日曆年份
  calM:      new Date().getMonth()+1,  // 日曆月份
  selDate:   todayStr(),              // 歷史頁選取日期
  records:   [],                       // 所有記錄
  platforms: [],                       // 平台陣列
  settings:  { ...DEFAULT_SETTINGS }, // App 設定
  punch: null,                         // {startTime, date} 目前打卡狀態
  editingId: null,                     // 編輯中的記錄 ID
  selPlatformId: null,                 // 新增表單選取的平台 ID
  charts: {},                          // Chart.js 實例快取
  subMode: '',                         // 子頁目前模式
};

/* ══ 工具函式 ════════════════════════════════════ */
/** 今日日期字串 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
/** 目前時間字串 HH:MM */
function nowTime() { return new Date().toTimeString().slice(0,5); }
/** 數字格式化（加千位分隔） */
const fmt = n => Number(n||0).toLocaleString('zh-TW', { minimumFractionDigits:0 });
/** 產生唯一 ID */
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
/** 兩位補零 */
const pad = n => String(n).padStart(2,'0');
/** 安全 parseFloat */
const pf = v => parseFloat(v)||0;
/** 根據 ID 取得平台物件 */
const getPlatform = id => S.platforms.find(p=>p.id===id)||{name:'未知',color:'#999'};
/** 取得指定日期的所有記錄 */
const getDayRecs = date => S.records.filter(r=>r.date===date);
/** 取得指定月份所有記錄 */
const getMonthRecs = (y,m) => {
  const prefix = `${y}-${pad(m)}`;
  return S.records.filter(r => r.date && r.date.startsWith(prefix));
};
/** 計算單筆記錄的總收入 */
const recTotal = r => pf(r.income)+pf(r.bonus)+pf(r.tempBonus)+pf(r.tips);
/** 顯示 Toast 訊息 */
function toast(msg, ms=2200) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), ms);
}
/** 自訂確認框（回傳 Promise<boolean>）*/
function customConfirm(msg) {
  return new Promise(resolve => {
    const ov = document.getElementById('confirm-overlay');
    document.getElementById('confirm-msg').innerHTML = msg;
    ov.classList.add('show');
    const ok     = document.getElementById('confirm-ok-btn');
    const cancel = document.getElementById('confirm-cancel-btn');
    function done(v) {
      ov.classList.remove('show');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(v);
    }
    function onOk()     { done(true);  }
    function onCancel() { done(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    ov.addEventListener('click', e=>{ if(e.target===ov) done(false); }, {once:true});
  });
}
/** 開啟／關閉 Overlay */
function openOverlay(id)  { document.getElementById(id)?.classList.add('show');    }
function closeOverlay(id) { document.getElementById(id)?.classList.remove('show'); }
/** 關閉詳情抽屜 */
function closeDetailOverlay() {
  document.getElementById('detail-overlay').classList.remove('show');
}

/* ══ 資料讀寫（localStorage）════════════════════ */
/** 讀取所有資料到 S 狀態 */
function loadAll() {
  try { S.records   = JSON.parse(localStorage.getItem(KEYS.records)||'[]'); }   catch { S.records=[]; }
  try { S.platforms = JSON.parse(localStorage.getItem(KEYS.platforms)||'null') || DEFAULT_PLATFORMS.map(p=>({...p})); }
       catch { S.platforms = DEFAULT_PLATFORMS.map(p=>({...p})); }
  try { S.settings  = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEYS.settings)||'{}') }; }
       catch { S.settings  = { ...DEFAULT_SETTINGS }; }
  try { S.punch     = JSON.parse(localStorage.getItem(KEYS.punch)||'null'); }    catch { S.punch=null; }
}
/** 儲存記錄 */
function saveRecords()   { localStorage.setItem(KEYS.records,   JSON.stringify(S.records));   }
/** 儲存平台設定 */
function savePlatforms() { localStorage.setItem(KEYS.platforms, JSON.stringify(S.platforms)); }
/** 儲存 App 設定 */
function saveSettings()  { localStorage.setItem(KEYS.settings,  JSON.stringify(S.settings));  }
/** 儲存即時打卡狀態 */
function savePunch()     { localStorage.setItem(KEYS.punch,     JSON.stringify(S.punch));     }

/* ══ 導覽 ════════════════════════════════════════ */
/** 切換到指定頁面（tab 名稱） */
function goPage(name) {
  S.tab = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni[data-pg]').forEach(n => {
    const isActive = n.dataset.pg === name;
    n.classList.toggle('active', isActive);
    // 切換圖示：選中=2號彩色圖，未選中=1號黑色圖
    const img = n.querySelector('.ni-img');
    if (img) {
      img.src = isActive ? n.dataset.img2 : n.dataset.img1;
    }
  });
  document.getElementById(`page-${name}`)?.classList.add('active');
  // 切換時觸發對應渲染
  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'report')   renderReport();
  if (name === 'settings') renderSettings();
}
// 綁定底部導覽點擊
document.querySelectorAll('.ni[data-pg]').forEach(el =>
  el.addEventListener('click', () => {
    const pg = el.dataset.pg;
    if (pg === 'add' && S.tab !== 'add') {
      openAddPage(); // 點擊新增按鈕時，清空表單
    } else {
      goPage(pg);
    }
  })
);

/* ══ 首頁渲染 ════════════════════════════════════ */
function renderHome() {
  const today    = todayStr();
  const dayRecs  = getDayRecs(today);                           // 今日所有記錄
  const total    = dayRecs.reduce((s,r)=>s+recTotal(r), 0);    // 今日總收入
  const orders   = dayRecs.reduce((s,r)=>s+pf(r.orders), 0);  // 今日總單數
  const hours    = dayRecs.reduce((s,r)=>s+pf(r.hours), 0);   // 今日總工時
  const dateObj  = new Date(today+'T00:00:00');
  const dow      = ['日','一','二','三','四','五','六'][dateObj.getDay()];

  // ── 今日總覽大卡片 ──
  let html = `
  <div class="today-hero">
    <div class="hero-date">${dateObj.getFullYear()} 年 ${dateObj.getMonth()+1} 月 ${dateObj.getDate()} 日 星期${dow}</div>
    <div class="hero-total">NT$ ${fmt(total)}</div>
    <div class="hero-label">今日總收入</div>
    <div class="hero-stats">
      <div class="stat-item"><div class="stat-num">${orders}</div><div class="stat-lbl">接單數</div></div>
      <div class="stat-item"><div class="stat-num">${hours>0?hours.toFixed(1):'—'}</div><div class="stat-lbl">工時(h)</div></div>
      <div class="stat-item"><div class="stat-num">${orders>0&&hours>0?(orders/hours).toFixed(1):'—'}</div><div class="stat-lbl">單/時</div></div>
    </div>
  </div>`;

  // ── 今日各平台小徽章 ──
  const activePlatforms = S.platforms.filter(p=>p.active);
  const platSums = activePlatforms.map(p=>({
    ...p, sum: dayRecs.filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0)
  })).filter(p=>p.sum>0);
  if (platSums.length) {
    html += `<div class="today-platform-row">`;
    platSums.forEach(p => {
      html += `<div class="plat-badge" style="background:${p.color}">
        ${p.name} <span class="pb-amt">$${fmt(p.sum)}</span></div>`;
    });
    html += `</div>`;
  }

  // ── 打卡卡片 ──
  const isPunched = S.punch && S.punch.date === today;
  let punchElapsed = '';
  if (isPunched) {
    const startMs = new Date(`${today}T${S.punch.startTime}`).getTime();
    const diffMin = Math.floor((Date.now() - startMs) / 60000);
    punchElapsed = `已工作 ${Math.floor(diffMin/60)}h${diffMin%60}m`;
  }
  html += `
  <div class="punch-card">
    <div class="punch-status">
      <div class="punch-dot${isPunched?' active':''}"></div>
      <span style="font-size:13px;font-weight:600;color:${isPunched?'var(--green)':'var(--t3)'}">
        ${isPunched?'在線中':'離線'}
      </span>
      ${isPunched?`<span style="font-size:11px;color:var(--t3);margin-left:auto">${punchElapsed}</span>`:''}
    </div>
    ${isPunched?`<div class="punch-time-row">
      <span>🟢 上線：${S.punch.startTime}</span>
    </div>`:''}
    <button class="punch-main-btn ${isPunched?'go-offline':'go-online'}"
      onclick="${isPunched?'punchOut()':'punchIn()'}">
      ${isPunched?'⏹ 下線打卡':'▶ 上線打卡'}
    </button>
  </div>`;

  // ── 結算日 / 發薪日倒數 ──
  const todayDate   = new Date();
  const todayDay    = todayDate.getDate();
  const daysInMonth = new Date(todayDate.getFullYear(), todayDate.getMonth()+1, 0).getDate();
  const activeP     = activePlatforms.filter(p=>p.settleDay>0||p.payDay>0).slice(0,2);
  if (activeP.length) {
    html += `<div class="settle-row">`;
    activeP.forEach(p => {
      const settle  = p.settleDay||0;
      const pay     = p.payDay||0;
      // 計算下個結算日的剩餘天數
      let dSettle = settle>0 ? (settle>todayDay?settle-todayDay:daysInMonth-todayDay+settle) : -1;
      let dPay    = pay>0    ? (pay>todayDay?pay-todayDay:daysInMonth-todayDay+pay) : -1;
      html += `<div class="settle-chip" style="border-left:3px solid ${p.color}">
        <div style="font-size:10px;font-weight:600;color:${p.color};margin-bottom:4px">${p.name}</div>
        ${dSettle>=0?`<div style="font-size:11px;color:var(--t2)">結算日 <strong style="color:var(--acc)">${dSettle===0?'今天':dSettle+'天後'}</strong></div>`:''}
        ${dPay>=0   ?`<div style="font-size:11px;color:var(--t2)">發薪日 <strong style="color:var(--green)">${dPay===0?'今天':dPay+'天後'}</strong></div>`:''}
      </div>`;
    });
    html += `</div>`;
  }

  // ── 月目標進度 ──
  const monthly = pf(S.settings.goals?.monthly);
  if (monthly > 0) {
    const monthRecs  = getMonthRecs(todayDate.getFullYear(), todayDate.getMonth()+1);
    const monthTotal = monthRecs.reduce((s,r)=>s+recTotal(r), 0);
    const pct        = Math.min(100, Math.round(monthTotal/monthly*100));
    const remain     = Math.max(0, monthly-monthTotal);
    html += `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--t2)">📈 本月目標進度</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--acc)">${pct}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${pct}%;background:${pct>=100?'var(--green)':pct>=70?'var(--gold)':'var(--acc)'}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:4px">
        <span>已達 NT$ ${fmt(monthTotal)}</span>
        <span>${remain>0?`還差 NT$ ${fmt(remain)}`:'🎉 已達標！'}</span>
      </div>
    </div>`;
  }

  // ── 今日記錄列表 ──
  html += `<div class="sec-title" style="margin-top:4px">今日記錄</div>`;
  if (!dayRecs.length) {
    html += `<div class="empty-tip">✨ 今天還沒有記錄<br>點下方 ＋ 開始記帳</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px">`;
    // 由新到舊排序
    dayRecs.slice().sort((a,b)=>(b.time||'').localeCompare(a.time||'')).forEach(r => {
      html += buildRecItem(r);
    });
    html += `</div>`;
  }

  document.getElementById('home-content').innerHTML = html;
}

/* ══ 打卡功能 ════════════════════════════════════ */
/** 上線打卡 */
function punchIn() {
  const today = todayStr();
  S.punch = { date: today, startTime: nowTime() };
  savePunch();
  toast(`✅ 上線打卡：${S.punch.startTime}`);
  renderHome();
}
/** 下線打卡 */
function punchOut() {
  if (!S.punch) return;
  const endTime   = nowTime();
  const startMs   = new Date(`${S.punch.date}T${S.punch.startTime}`).getTime();
  const endMs     = new Date(`${S.punch.date}T${endTime}`).getTime();
  const diffHours = Math.max(0, (endMs - startMs) / 3600000);
  // 自動開啟新增記錄，並填入打卡時間
  openAddPage(null, {
    punchIn:  S.punch.startTime,
    punchOut: endTime,
    hours:    diffHours.toFixed(1),
    date:     S.punch.date,
  });
  // 清除打卡狀態
  S.punch = null; savePunch();
}

/* ══ 歷史記錄頁 ══════════════════════════════════ */
function renderHistory() {
  renderHistCalendar();
  renderHistRecords(S.selDate);
}
/** 渲染月曆格 */
function renderHistCalendar() {
  const { calY:y, calM:m } = S;
  // 月份標題
  document.getElementById('hist-label').textContent = `${y} 年 ${m} 月`;
  const grid  = document.getElementById('hist-calendar');
  const first = new Date(y, m-1, 1).getDay(); // 月份第一天是星期幾
  const days  = new Date(y, m, 0).getDate();   // 本月天數
  const DOW   = ['日','一','二','三','四','五','六'];

  let html = `<div class="month-row">`;
  DOW.forEach(d => { html += `<div class="month-cell month-dow">${d}</div>`; });
  html += `</div>`;

  let col = 0;
  html += `<div class="month-row">`;
  // 填充第一周的空白格
  for (let i=0; i<first; i++) { html += `<div class="month-cell"></div>`; col++; }

  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`;
    // 計算當日收入合計（顯示在格子下方）
    const sum = getDayRecs(ds).reduce((s,r)=>s+recTotal(r), 0);
    const cls = [
      'month-cell',
      ds === todayStr() ? 'today' : '',
      ds === S.selDate  ? 'sel'   : '',
    ].filter(Boolean).join(' ');
    const amtHtml = sum>0 ? `<div class="day-amt">${sum>=1000?Math.round(sum/1000)+'k':sum}</div>` : '';
    html += `<div class="${cls}" data-ds="${ds}">
      <div class="day-num">${day}</div>${amtHtml}
    </div>`;
    col++;
    if (col % 7 === 0 && day < days) { html += `</div><div class="month-row">`; }
  }
  html += `</div>`;
  grid.innerHTML = html;

  // 綁定日期點擊
  grid.querySelectorAll('.month-cell[data-ds]').forEach(cell => {
    cell.addEventListener('click', () => {
      S.selDate = cell.dataset.ds;
      // 更新選取樣式
      grid.querySelectorAll('.month-cell').forEach(c => {
        c.classList.toggle('sel', c.dataset.ds === S.selDate);
      });
      renderHistRecords(S.selDate);
    });
  });
}
/** 渲染歷史記錄的當日列表 */
function renderHistRecords(ds) {
  const d   = new Date(ds+'T00:00:00');
  const dow = ['日','一','二','三','四','五','六'][d.getDay()];
  document.getElementById('hist-day-label').textContent =
    `${d.getMonth()+1} 月 ${d.getDate()} 日（星期${dow}）記錄`;

  // 當日摘要
  const recs  = getDayRecs(ds);
  const total = recs.reduce((s,r)=>s+recTotal(r), 0);
  const sumEl = document.getElementById('hist-day-summary');
  if (total > 0) {
    const orders = recs.reduce((s,r)=>s+pf(r.orders), 0);
    const hours  = recs.reduce((s,r)=>s+pf(r.hours), 0);
    sumEl.innerHTML = `<div class="day-sum-row">
      <div class="day-sum-chip" style="background:var(--green-d);color:var(--green)">💰 NT$ ${fmt(total)}</div>
      ${orders>0?`<div class="day-sum-chip" style="background:var(--sf);border:1px solid var(--border)">📦 ${orders} 單</div>`:''}
      ${hours>0 ?`<div class="day-sum-chip" style="background:var(--sf);border:1px solid var(--border)">⏱ ${hours.toFixed(1)} h</div>`:''}
    </div>`;
  } else { sumEl.innerHTML = ''; }

  // 記錄列表
  const listEl = document.getElementById('hist-rec-list');
  if (!recs.length) {
    listEl.innerHTML = `<div class="empty-tip">✨ 這天沒有記錄</div>`;
    return;
  }
  listEl.innerHTML = recs.slice().sort((a,b)=>(b.time||'').localeCompare(a.time||''))
    .map(r => buildRecItem(r)).join('');

  // 綁定點擊開啟詳情
  listEl.querySelectorAll('.rec-item[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetailOverlay(el.dataset.id));
  });
}

/* ══ 記錄卡片 HTML（共用）═══════════════════════ */
function buildRecItem(r) {
  const plat    = getPlatform(r.platformId);
  const total   = recTotal(r);
  const chips   = [];
  if (r.orders > 0) chips.push(`📦${r.orders}單`);
  if (r.hours  > 0) chips.push(`⏱${pf(r.hours).toFixed(1)}h`);
  const bonusBits = [];
  if (r.bonus    > 0) bonusBits.push(`🎁${fmt(r.bonus)}`);
  if (r.tempBonus> 0) bonusBits.push(`⚡${fmt(r.tempBonus)}`);
  if (r.tips     > 0) bonusBits.push(`🤑${fmt(r.tips)}`);

  return `<div class="rec-item" data-id="${r.id}">
    <div class="rec-plat-dot" style="background:${plat.color}"></div>
    <div class="rec-info">
      <div class="rec-plat-name">${plat.name}${r.time?` · ${r.time}`:''}</div>
      <div class="rec-main">
        ${chips.map(c=>`<span class="rec-chip">${c}</span>`).join('')}
        ${bonusBits.length?`<span class="rec-chip" style="color:var(--gold)">${bonusBits.join(' ')}</span>`:''}
      </div>
      ${r.note?`<div class="rec-sub">${r.note}</div>`:''}
    </div>
    <div class="rec-amt">+${fmt(total)}</div>
  </div>`;
}

/* ══ 月份切換（歷史頁）════════════════════════════ */
document.getElementById('hist-prev').addEventListener('click', () => {
  S.calM--; if(S.calM<1){S.calM=12;S.calY--;}
  S.selDate = `${S.calY}-${pad(S.calM)}-01`;
  renderHistory();
});
document.getElementById('hist-next').addEventListener('click', () => {
  S.calM++; if(S.calM>12){S.calM=1;S.calY++;}
  S.selDate = `${S.calY}-${pad(S.calM)}-01`;
  renderHistory();
});

/* ══ 新增／編輯記錄 Overlay ═════════════════════ */
/**
 * 開啟新增/編輯 Overlay
 * @param {Object|null} record 編輯時傳入既有記錄
 * @param {Object}      prefill 預填欄位（打卡下線時使用）
 */
function openAddPage(record=null, prefill={}) {
  S.editingId    = record ? record.id : null;
  S.selPlatformId = record ? record.platformId : (S.platforms.find(p=>p.active)?.id||null);

  document.getElementById('add-page-title').textContent = record ? '編輯記錄' : '新增記錄';

  // 填入表單欄位
  document.getElementById('f-date').value      = record?.date      || prefill.date || S.selDate || todayStr();
  document.getElementById('f-punch-in').value  = record?.punchIn   || prefill.punchIn  || '';
  document.getElementById('f-punch-out').value = record?.punchOut  || prefill.punchOut || '';
  document.getElementById('f-hours').value     = record?.hours     || prefill.hours     || '';
  document.getElementById('f-orders').value    = record?.orders    || '';
  document.getElementById('f-income').value    = record?.income    || '';
  document.getElementById('f-bonus').value     = record?.bonus     || '';
  document.getElementById('f-temp-bonus').value= record?.tempBonus || '';
  document.getElementById('f-tips').value      = record?.tips      || '';
  document.getElementById('f-note').value      = record?.note      || '';

  // 渲染平台選擇 chips
  renderPlatformChips();
  calcAddTotal();
  // 替換掉原本的 openOverlay('add-page');
  goPage('add');
}
/** 渲染新增頁平台選擇 chips */
function renderPlatformChips() {
  const container = document.getElementById('platform-chips');
  const active    = S.platforms.filter(p=>p.active);
  if (!S.selPlatformId && active.length) S.selPlatformId = active[0].id;

  container.innerHTML = active.map(p => `
    <div class="platform-chip${S.selPlatformId===p.id?' on':''}"
         style="${S.selPlatformId===p.id?`background:${p.color};border-color:${p.color}`:''}"
         onclick="selectPlatform('${p.id}')">
      <span>${p.name}</span>
    </div>`).join('');
}
/** 選取平台 */
function selectPlatform(id) {
  S.selPlatformId = id;
  renderPlatformChips();
}
/** 由上線/下線時間自動計算工時 */
function autoCalcHours() {
  const inVal  = document.getElementById('f-punch-in').value;
  const outVal = document.getElementById('f-punch-out').value;
  if (!inVal || !outVal) return;
  const base = document.getElementById('f-date').value || todayStr();
  const inMs  = new Date(`${base}T${inVal}`).getTime();
  const outMs = new Date(`${base}T${outVal}`).getTime();
  const diff  = (outMs - inMs) / 3600000;
  if (diff > 0) {
    document.getElementById('f-hours').value = diff.toFixed(1);
  }
  calcAddTotal();
}
/** 設定打卡欄位為「現在」時間 */
function setPunchNow(field) {
  const el = document.getElementById(field==='in'?'f-punch-in':'f-punch-out');
  el.value = nowTime();
  autoCalcHours();
}
/** 即時計算本筆總收入並更新顯示 */
function calcAddTotal() {
  const income    = pf(document.getElementById('f-income').value);
  const bonus     = pf(document.getElementById('f-bonus').value);
  const tempBonus = pf(document.getElementById('f-temp-bonus').value);
  const tips      = pf(document.getElementById('f-tips').value);
  const total     = income + bonus + tempBonus + tips;
  document.getElementById('add-total-val').textContent = fmt(total);

  // 顯示分解（有值的才顯示）
  const parts = [];
  if (income    >0) parts.push(`行程 $${fmt(income)}`);
  if (bonus     >0) parts.push(`固定獎勵 $${fmt(bonus)}`);
  if (tempBonus >0) parts.push(`臨時獎勵 $${fmt(tempBonus)}`);
  if (tips      >0) parts.push(`小費 $${fmt(tips)}`);
  document.getElementById('add-breakdown').textContent = parts.join(' + ');
}
// 確認新增記錄
document.getElementById('add-confirm').addEventListener('click', () => {
  if (!S.selPlatformId) { toast('請先選擇平台'); return; }
  const income = pf(document.getElementById('f-income').value);
  const bonus  = pf(document.getElementById('f-bonus').value);
  const temp   = pf(document.getElementById('f-temp-bonus').value);
  const tips   = pf(document.getElementById('f-tips').value);
  if (income+bonus+temp+tips <= 0) { toast('請輸入至少一項收入金額'); return; }

  const rec = {
    id:          S.editingId || newId(),
    date:        document.getElementById('f-date').value || todayStr(),
    time:        document.getElementById('f-punch-out').value || nowTime(),
    platformId:  S.selPlatformId,
    punchIn:     document.getElementById('f-punch-in').value,
    punchOut:    document.getElementById('f-punch-out').value,
    hours:       pf(document.getElementById('f-hours').value),
    orders:      pf(document.getElementById('f-orders').value),
    income,
    bonus,
    tempBonus:   temp,
    tips,
    note:        document.getElementById('f-note').value.trim(),
  };

  if (S.editingId) {
    // 更新記錄
    const idx = S.records.findIndex(r=>r.id===S.editingId);
    if (idx >= 0) S.records[idx] = rec;
    toast('✅ 記錄已更新');
  } else {
    // 新增記錄
    S.records.push(rec);
    toast('✅ 記錄成功！');
  }

  saveRecords();
  S.editingId = null;
  // 替換掉原本的 closeOverlay('add-page');
  // 儲存後自動跳回首頁
  goPage('home'); 
  toast('✅ 記錄成功！');
});
// 取消新增的那行 document.getElementById('add-cancel') 可以直接刪除，因為頁面沒有取消按鈕了

/* ══ 詳情抽屜 ════════════════════════════════════ */
function openDetailOverlay(id) {
  const r = S.records.find(r=>r.id===id);
  if (!r) return;
  const plat  = getPlatform(r.platformId);
  const total = recTotal(r);
  const rows  = [
    ['🏪 平台',    `<span style="color:${plat.color};font-weight:600">${plat.name}</span>`],
    ['📆 日期',    r.date],
    ['⏱ 打卡',    r.punchIn&&r.punchOut?`${r.punchIn} → ${r.punchOut}`:(r.punchIn?r.punchIn:'—')],
    ['🕐 工時',    r.hours>0?`${pf(r.hours).toFixed(1)} 小時`:'—'],
    ['📦 接單數',  r.orders>0?`${r.orders} 單`:'—'],
    ['💰 行程收入',`NT$ ${fmt(r.income)}`],
    ['🎁 固定獎勵',r.bonus>0?`NT$ ${fmt(r.bonus)}`:'—'],
    ['⚡ 臨時獎勵',r.tempBonus>0?`NT$ ${fmt(r.tempBonus)}`:'—'],
    ['🤑 小費',    r.tips>0?`NT$ ${fmt(r.tips)}`:'—'],
    ['📝 備註',    r.note||'—'],
  ];
  document.getElementById('detail-body').innerHTML = `
    <div style="text-align:center;padding:10px 0 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:13px;color:var(--t3);margin-bottom:4px">本筆總收入</div>
      <div style="font-family:var(--mono);font-size:38px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div>
    </div>
    <div style="margin-top:12px">${rows.map(([l,v])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--t3)">${l}</span>
        <span style="font-size:13px;font-weight:500">${v}</span>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button onclick="closeDetailOverlay();openAddPage(${JSON.stringify(r).replace(/"/g,'&quot;')})" 
        style="flex:1;padding:12px;border-radius:var(--rs);background:var(--acc-d);color:var(--acc);border:1px solid rgba(255,107,53,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">
        ✎ 編輯
      </button>
      <button onclick="deleteRecord('${r.id}')" 
        style="flex:1;padding:12px;border-radius:var(--rs);background:var(--red-d);color:var(--red);border:1px solid rgba(239,68,68,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">
        🗑 刪除
      </button>
    </div>`;
  document.getElementById('detail-overlay').classList.add('show');
}
/** 刪除記錄 */
async function deleteRecord(id) {
  closeDetailOverlay();
  const ok = await customConfirm('確定要刪除這筆記錄嗎？<br><strong>此動作無法復原。</strong>');
  if (!ok) return;
  S.records = S.records.filter(r=>r.id!==id);
  saveRecords();
  toast('已刪除');
  if (S.tab==='home')    renderHome();
  if (S.tab==='history') renderHistory();
}

/* ══ 搜尋 ════════════════════════════════════════ */
function openSearch() { openOverlay('search-page'); document.getElementById('search-kw').focus(); }
function doSearch() {
  const kw   = document.getElementById('search-kw').value.trim().toLowerCase();
  const from = document.getElementById('search-from').value;
  const to   = document.getElementById('search-to').value;
  const el   = document.getElementById('search-results');

  let recs = S.records.filter(r => {
    if (from && r.date < from) return false;
    if (to   && r.date > to)   return false;
    if (!kw) return true;
    const plat = getPlatform(r.platformId).name.toLowerCase();
    return plat.includes(kw)
      || (r.note||'').toLowerCase().includes(kw)
      || String(recTotal(r)).includes(kw)
      || String(r.orders||'').includes(kw);
  }).sort((a,b)=>b.date.localeCompare(a.date));

  if (!recs.length) { el.innerHTML = `<div class="empty-tip">找不到符合記錄</div>`; return; }
  el.innerHTML = recs.map(r=>buildRecItem(r)).join('');
  el.querySelectorAll('.rec-item[data-id]').forEach(item => {
    item.addEventListener('click', () => {
      closeOverlay('search-page');
      openDetailOverlay(item.dataset.id);
    });
  });
}
document.getElementById('search-kw').addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });

/* ══ 報表頁 ══════════════════════════════════════ */
function renderReport() {
  document.getElementById('rpt-label').textContent = `${S.rptY} 年 ${S.rptM} 月`;
  // 根據目前子頁顯示
  if (S.rptView === 'overview') renderRptOverview();
  if (S.rptView === 'trend')    renderRptTrend();
  if (S.rptView === 'compare')  renderRptCompare();
  if (S.rptView === 'top3')     renderRptTop3();
}
// 報表月份切換
document.getElementById('rpt-prev').addEventListener('click', ()=>{ S.rptM--; if(S.rptM<1){S.rptM=12;S.rptY--;} renderReport(); });
document.getElementById('rpt-next').addEventListener('click', ()=>{ S.rptM++; if(S.rptM>12){S.rptM=1;S.rptY++;} renderReport(); });
// 報表 tab 切換
document.querySelectorAll('#rpt-tabs .seg-tab').forEach(t => t.addEventListener('click', ()=>{
  document.querySelectorAll('#rpt-tabs .seg-tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on'); S.rptView = t.dataset.rv;
  ['overview','trend','compare','top3'].forEach(v => {
    document.getElementById(`rv-${v}`).style.display = v===S.rptView?'':'none';
  });
  renderReport();
}));

/** 報表：總覽 */
function renderRptOverview() {
  const recs   = getMonthRecs(S.rptY, S.rptM);
  const total  = recs.reduce((s,r)=>s+recTotal(r), 0);
  const income = recs.reduce((s,r)=>s+pf(r.income), 0);
  const bonus  = recs.reduce((s,r)=>s+pf(r.bonus)+pf(r.tempBonus), 0);
  const tips   = recs.reduce((s,r)=>s+pf(r.tips), 0);
  const orders = recs.reduce((s,r)=>s+pf(r.orders), 0);
  const hours  = recs.reduce((s,r)=>s+pf(r.hours), 0);

  let html = `
  <div class="card">
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;text-align:center">
        <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">本月總收入</div>
      </div>
    </div>
    <div class="rpt-divider"></div>
    <div class="rpt-total-row"><span class="rt-lbl">💰 行程收入</span><span class="rt-val" style="color:var(--green)">NT$ ${fmt(income)}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">🎁 獎勵小計</span><span class="rt-val" style="color:var(--gold)">NT$ ${fmt(bonus)}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">🤑 小費小計</span><span class="rt-val" style="color:var(--blue)">NT$ ${fmt(tips)}</span></div>
    <div class="rpt-divider"></div>
    <div class="rpt-total-row"><span class="rt-lbl">📦 接單數</span><span class="rt-val">${fmt(orders)} 單</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">⏱ 累計工時</span><span class="rt-val">${hours.toFixed(1)} h</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">💵 平均時薪</span><span class="rt-val" style="color:var(--acc)">${hours>0?`NT$ ${fmt(Math.round(total/hours))}/h`:'—'}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">📦 平均每單</span><span class="rt-val" style="color:var(--acc)">${orders>0?`NT$ ${fmt(Math.round(total/orders))}/單`:'—'}</span></div>
  </div>`;

  // 平台分解圓餅圖
  const platData = S.platforms.filter(p=>p.active).map(p=>({
    name: p.name, color: p.color,
    val:  recs.filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0)
  })).filter(p=>p.val>0);

  if (platData.length > 1) {
    html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">各平台佔比</div>
      <div style="position:relative;height:220px;margin-bottom:10px"><canvas id="plat-pie"></canvas></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${platData.map(p=>{
          const pct = total>0?Math.round(p.val/total*100):0;
          return `<div style="display:flex;align-items:center;gap:8px">
            <div style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0"></div>
            <span style="flex:1;font-size:13px">${p.name}</span>
            <span style="font-family:var(--mono);font-size:13px;color:var(--t2)">${pct}%</span>
            <span style="font-family:var(--mono);font-size:13px;font-weight:600">NT$ ${fmt(p.val)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // 收入結構（行程 vs 獎勵 vs 小費）圓餅
  if (total > 0 && (bonus>0||tips>0)) {
    html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">收入結構</div>
      <div style="position:relative;height:200px"><canvas id="income-pie"></canvas></div>
      <div style="display:flex;justify-content:space-around;margin-top:10px;font-size:12px;text-align:center">
        <div><div style="color:var(--green);font-family:var(--mono);font-weight:600">${total>0?Math.round(income/total*100):0}%</div><div style="color:var(--t3)">行程</div></div>
        <div><div style="color:var(--gold);font-family:var(--mono);font-weight:600">${total>0?Math.round(bonus/total*100):0}%</div><div style="color:var(--t3)">獎勵</div></div>
        <div><div style="color:var(--blue);font-family:var(--mono);font-weight:600">${total>0?Math.round(tips/total*100):0}%</div><div style="color:var(--t3)">小費</div></div>
      </div>
    </div>`;
  }

  document.getElementById('rv-overview').innerHTML = html;

  // 渲染圓餅圖
  if (platData.length>1) drawPie('plat-pie', platData.map(p=>p.name), platData.map(p=>p.val), platData.map(p=>p.color));
  if (total>0&&(bonus>0||tips>0)) drawPie('income-pie',['行程','獎勵','小費'],[income,bonus,tips],['#22C55E','#F59E0B','#3B82F6']);
}

/** 報表：趨勢 */
function renderRptTrend() {
  const el = document.getElementById('rv-trend');
  // 趨勢模式（週/月/年）
  const trends = [
    { key:'week',  label:'7天趨勢',   getDays: () => Array.from({length:7}, (_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}) },
    { key:'month', label:'本月趨勢',   getDays: () => { const n=new Date(S.rptY,S.rptM,0).getDate(); return Array.from({length:n},(_,i)=>`${S.rptY}-${pad(S.rptM)}-${pad(i+1)}`); } },
    { key:'year',  label:'年趨勢',    getDays: () => Array.from({length:12},(_,i)=>null) }, // 月份資料特殊處理
  ];
  const curT = S.trendMode||'month';
  const trend = trends.find(t=>t.key===curT)||trends[1];

  let html = `<div style="display:flex;gap:6px;margin-bottom:10px">
    ${trends.map(t=>`<button onclick="S.trendMode='${t.key}';renderRptTrend()" 
      style="flex:1;padding:6px;border-radius:var(--rs);border:1px solid ${curT===t.key?'var(--acc)':'var(--border)'};background:${curT===t.key?'var(--acc-d)':'var(--sf2)'};color:${curT===t.key?'var(--acc)':'var(--t2)'};font-size:12px;cursor:pointer;font-family:var(--sans)">${t.label}</button>`).join('')}
  </div>`;
  html += `<div class="card"><div style="position:relative;height:${curT==='year'?180:220}px"><canvas id="trend-chart"></canvas></div></div>`;

  // 年趨勢：12個月
  if (curT === 'year') {
    const months = Array.from({length:12},(_,i)=>i+1);
    const labels = months.map(m=>`${m}月`);
    const data   = months.map(m=>getMonthRecs(S.rptY,m).reduce((s,r)=>s+recTotal(r),0));
    html += `<div class="card">
      <div class="rpt-divider" style="margin-bottom:8px"></div>
      <div class="rpt-total-row"><span class="rt-lbl">全年總收入</span><span class="rt-val" style="color:var(--green)">NT$ ${fmt(data.reduce((a,b)=>a+b,0))}</span></div>
      <div class="rpt-total-row"><span class="rt-lbl">月均收入</span><span class="rt-val">NT$ ${fmt(Math.round(data.reduce((a,b)=>a+b,0)/12))}</span></div>
    </div>`;
    el.innerHTML = html;
    drawLine('trend-chart', labels, [{ label:'月收入', data, color:'#FF6B35' }]);
    return;
  }

  // 週/月趨勢
  const days  = trend.getDays();
  const labels = days.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
  const data   = days.map(d=>getDayRecs(d).reduce((s,r)=>s+recTotal(r),0));

  el.innerHTML = html;
  drawLine('trend-chart', labels, [{ label:'日收入', data, color:'#FF6B35' }]);
}

/** 報表：比較 */
function renderRptCompare() {
  const el = document.getElementById('rv-compare');
  const thisRecs = getMonthRecs(S.rptY, S.rptM);
  const thisTotal = thisRecs.reduce((s,r)=>s+recTotal(r),0);

  // 比較對象：上月、去年同月、前年同月
  const comparisons = [
    { label:'上個月',   y:S.rptM>1?S.rptY:S.rptY-1,  m:S.rptM>1?S.rptM-1:12 },
    { label:'去年同月', y:S.rptY-1, m:S.rptM },
    { label:'前年同月', y:S.rptY-2, m:S.rptM },
  ].map(c=>({
    ...c, total: getMonthRecs(c.y,c.m).reduce((s,r)=>s+recTotal(r),0)
  }));

  const maxV = Math.max(thisTotal, ...comparisons.map(c=>c.total), 1);
  let html = `<div class="card">
    <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:12px">📊 與歷史比較</div>
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="font-weight:600;color:var(--acc)">${S.rptY}年${S.rptM}月（本月）</span>
        <span style="font-family:var(--mono);font-weight:700;color:var(--green)">NT$ ${fmt(thisTotal)}</span>
      </div>
      <div class="progress-track" style="height:10px">
        <div class="progress-fill" style="width:100%;background:var(--acc)"></div>
      </div>
    </div>
    ${comparisons.map(c=>{
      const pct = maxV>0?Math.round(c.total/maxV*100):0;
      const diff = thisTotal - c.total;
      const diffStr = diff===0?'持平':(diff>0?`+NT$ ${fmt(diff)}`:`-NT$ ${fmt(Math.abs(diff))}`);
      const diffColor = diff>0?'var(--green)':diff<0?'var(--red)':'var(--t3)';
      return `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${c.label}（${c.y}/${pad(c.m)}）</span>
          <div style="display:flex;gap:8px;align-items:baseline">
            <span style="font-family:var(--mono);color:var(--t2)">NT$ ${fmt(c.total)}</span>
            <span style="font-size:11px;color:${diffColor};font-weight:600">${diffStr}</span>
          </div>
        </div>
        <div class="progress-track" style="height:6px">
          <div class="progress-fill" style="width:${pct}%;background:var(--t3)"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;

  el.innerHTML = html;
}

/** 報表：TOP3 */
function renderRptTop3() {
  const el = document.getElementById('rv-top3');
  // 依日期加總，取每日總收入
  const monthRecs = getMonthRecs(S.rptY, S.rptM);
  const dayMap = {};
  monthRecs.forEach(r => {
    dayMap[r.date] = (dayMap[r.date]||0) + recTotal(r);
  });
  const sorted = Object.entries(dayMap).sort((a,b)=>b[1]-a[1]);
  const medals = ['🥇','🥈','🥉'];

  let html = `<div class="card">
    <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:12px">🏆 本月收入 TOP 3 日</div>`;

  if (!sorted.length) {
    html += `<div class="empty-tip">本月暫無記錄</div>`;
  } else {
    sorted.slice(0,3).forEach(([date,total],i) => {
      const d    = new Date(date+'T00:00:00');
      const recs = getDayRecs(date);
      const orders = recs.reduce((s,r)=>s+pf(r.orders),0);
      const hours  = recs.reduce((s,r)=>s+pf(r.hours),0);
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:28px">${medals[i]||'▶'}</span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">${date} （${['日','一','二','三','四','五','六'][d.getDay()]}）</div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">
            ${orders>0?`${orders}單 `:''}${hours>0?`${hours.toFixed(1)}h `:''}
          </div>
        </div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div>
      </div>`;
    });
  }

  html += `</div>`;

  // 週趨勢 TOP3（近4週）
  const weekTotals = [];
  for (let w=3; w>=0; w--) {
    const startD = new Date(); startD.setDate(startD.getDate()-w*7);
    const endD   = new Date(startD); endD.setDate(endD.getDate()+6);
    let sum = 0;
    S.records.forEach(r=>{
      if(r.date>=`${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}`&&
         r.date<=`${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}`)
        sum += recTotal(r);
    });
    weekTotals.push({ label:`第${w+1}週前`, val:sum });
  }
  weekTotals.reverse();

  html += `<div class="card" style="margin-top:8px">
    <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">📅 近4週收入</div>
    <div style="position:relative;height:160px"><canvas id="week-bar"></canvas></div>
  </div>`;

  el.innerHTML = html;
  drawBar('week-bar', weekTotals.map(w=>w.label.replace('第','W')), weekTotals.map(w=>w.val), '#FF6B35');
}

/* ══ Chart.js 輔助函式 ═══════════════════════════ */
/** 繪製圓餅圖 */
function drawPie(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#fff' }] },
    options: {
      responsive:true, maintainAspectRatio:false, cutout:'60%',
      plugins:{ legend:{ display:true, position:'bottom', labels:{font:{size:11},padding:8} } },
      animation:{ duration:400 }
    }
  });
}
/** 繪製折線圖 */
function drawLine(canvasId, labels, datasets) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: datasets.map(d=>({
      label:d.label, data:d.data,
      borderColor:d.color, backgroundColor:d.color+'22',
      borderWidth:2, pointRadius:3, tension:.3, fill:true
    }))},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} },
      scales:{ x:{ticks:{font:{size:9},maxRotation:45,autoSkip:true}}, y:{ticks:{callback:v=>v>=1000?Math.round(v/1000)+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} },
      animation:{ duration:400 }
    }
  });
}
/** 繪製長條圖 */
function drawBar(canvasId, labels, data, color) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets:[{ data, backgroundColor:color+'99', borderRadius:6, borderWidth:0 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} },
      scales:{ x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{callback:v=>v>=1000?Math.round(v/1000)+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} },
      animation:{ duration:400 }
    }
  });
}

/* ══ 設定頁 ══════════════════════════════════════ */
function renderSettings() {
  const goals = S.settings.goals||{};
  const html  = `
  <div class="set-sec">
    <h3>平台管理</h3>
    <div class="set-list">
      ${S.platforms.map(p=>`
        <div class="set-row" onclick="openPlatformEdit('${p.id}')">
          <div class="plat-color-dot" style="background:${p.color}"></div>
          <div class="sn">
            <div>${p.name}</div>
            <div class="sn-sub">${p.active?'✅ 啟用':'⭕ 停用'}${p.settleDay?`　結算日：${p.settleDay}號`:''}${p.payDay?`　發薪日：${p.payDay}號`:''}</div>
          </div>
          <span class="arr">›</span>
        </div>`).join('')}
      <div class="set-row" onclick="openAddPlatform()">
        <span style="font-size:20px">➕</span>
        <span class="sn">新增平台</span>
      </div>
    </div>
  </div>

  <div class="set-sec">
    <h3>目標設定</h3>
    <div class="set-list">
      <div class="set-row" onclick="openGoalSettings()">
        <span class="sn">
          <div>週/月收入目標</div>
          <div class="sn-sub">週目標：NT$ ${fmt(goals.weekly||0)}　月目標：NT$ ${fmt(goals.monthly||0)}</div>
        </span>
        <span class="arr">›</span>
      </div>
    </div>
  </div>

  <div class="set-sec">
    <h3>獎勵清單</h3>
    <div class="set-list">
      ${(S.settings.rewards||[]).map((r,i)=>`
        <div class="set-row">
          <span class="sn">
            <div>${r.name}</div>
            <div class="sn-sub">${getPlatform(r.platformId).name}　≥${r.minOrders}單　NT$ ${fmt(r.amount)}</div>
          </span>
          <button onclick="event.stopPropagation();deleteReward(${i})" class="del-btn">✕</button>
        </div>`).join('')}
      <div class="set-row" onclick="openAddReward()">
        <span style="font-size:20px">➕</span>
        <span class="sn">新增獎勵項目</span>
      </div>
    </div>
  </div>

  <div class="set-sec">
    <h3>資料管理</h3>
    <div class="set-list">
      <div class="set-row" onclick="doBackup()"><span class="sn">📥 備份資料（JSON）</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doRestore()"><span class="sn">📤 還原備份</span><span class="arr">↑</span></div>
      <div class="set-row" onclick="doExportCSV()"><span class="sn">📊 匯出試算表（CSV）</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doReset()"><span class="sn" style="color:var(--red)">⚠️ 清除所有資料</span><span class="arr" style="color:var(--red)">!</span></div>
    </div>
  </div>`;

  document.getElementById('settings-content').innerHTML = html;
}

/* ══ 設定子頁：平台編輯 ══════════════════════════ */
function openPlatformEdit(id) {
  const p = S.platforms.find(x=>x.id===id);
  if (!p) return;
  S.subMode = 'platform_edit';
  document.getElementById('sub-title').textContent = '編輯平台';
  document.getElementById('sub-add-btn').style.display = 'none';
  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>平台名稱</label>
      <input type="text" class="finp" id="sp-name" value="${p.name}"></div>
    <div class="fg" style="margin-bottom:10px"><label>顏色（Hex）</label>
      <div style="display:flex;gap:8px">
        <input type="color" id="sp-color-pick" value="${p.color}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px">
        <input type="text"  class="finp" id="sp-color" value="${p.color}" style="flex:1">
      </div></div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <div class="fg" style="flex:1"><label>結算日（每月幾號）</label>
        <input type="number" class="finp" id="sp-settle" value="${p.settleDay||0}" min="0" max="31"></div>
      <div class="fg" style="flex:1"><label>發薪日（每月幾號）</label>
        <input type="number" class="finp" id="sp-pay" value="${p.payDay||0}" min="0" max="31"></div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:12px;background:var(--sf2);border-radius:var(--rs)">
      <label style="font-size:13px;font-weight:500;flex:1">啟用此平台</label>
      <input type="checkbox" id="sp-active" ${p.active?'checked':''} style="width:18px;height:18px;cursor:pointer">
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="savePlatformEdit('${id}')" class="btn-acc" style="flex:1;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">儲存</button>
      <button onclick="deletePlatform('${id}')" style="padding:12px 14px;border-radius:var(--rs);background:var(--red-d);color:var(--red);border:1px solid rgba(239,68,68,.3);font-size:13px;cursor:pointer;font-family:var(--sans)">刪除</button>
    </div>`;
  // 顏色選取器同步
  document.getElementById('sp-color-pick').addEventListener('input', e => { document.getElementById('sp-color').value = e.target.value; });
  openOverlay('sub-page');
}
function savePlatformEdit(id) {
  const p = S.platforms.find(x=>x.id===id);
  if (!p) return;
  p.name      = document.getElementById('sp-name').value.trim()||p.name;
  p.color     = document.getElementById('sp-color').value.trim()||p.color;
  p.settleDay = parseInt(document.getElementById('sp-settle').value)||0;
  p.payDay    = parseInt(document.getElementById('sp-pay').value)||0;
  p.active    = document.getElementById('sp-active').checked;
  savePlatforms();
  closeOverlay('sub-page');
  renderSettings();
  toast('✅ 平台已更新');
}
async function deletePlatform(id) {
  const ok = await customConfirm('確定刪除此平台？<br><strong>相關記錄不會被刪除，但會顯示為「未知平台」。</strong>');
  if (!ok) return;
  S.platforms = S.platforms.filter(p=>p.id!==id);
  savePlatforms();
  closeOverlay('sub-page');
  renderSettings();
  toast('已刪除平台');
}
function openAddPlatform() {
  S.subMode = 'platform_add';
  document.getElementById('sub-title').textContent = '新增平台';
  document.getElementById('sub-add-btn').style.display = 'none';
  const colors = ['#06C167','#D70F64','#FF6600','#3B82F6','#8B5CF6','#F59E0B'];
  const rndColor = colors[Math.floor(Math.random()*colors.length)];
  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>平台名稱</label>
      <input type="text" class="finp" id="np-name" placeholder="例：Uber Eats"></div>
    <div class="fg" style="margin-bottom:10px"><label>顏色</label>
      <div style="display:flex;gap:8px">
        <input type="color" id="np-color-pick" value="${rndColor}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px">
        <input type="text"  class="finp" id="np-color" value="${rndColor}" style="flex:1">
      </div></div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="fg" style="flex:1"><label>結算日</label>
        <input type="number" class="finp" id="np-settle" value="0" min="0" max="31"></div>
      <div class="fg" style="flex:1"><label>發薪日</label>
        <input type="number" class="finp" id="np-pay" value="0" min="0" max="31"></div>
    </div>
    <button onclick="saveNewPlatform()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">新增平台</button>`;
  document.getElementById('np-color-pick').addEventListener('input', e=>{ document.getElementById('np-color').value=e.target.value; });
  openOverlay('sub-page');
}
function saveNewPlatform() {
  const name = document.getElementById('np-name').value.trim();
  if (!name) { toast('請輸入平台名稱'); return; }
  S.platforms.push({
    id:        'plat_'+newId(),
    name,
    color:     document.getElementById('np-color').value.trim()||'#999',
    active:    true,
    settleDay: parseInt(document.getElementById('np-settle').value)||0,
    payDay:    parseInt(document.getElementById('np-pay').value)||0,
  });
  savePlatforms();
  closeOverlay('sub-page');
  renderSettings();
  toast('✅ 平台已新增');
}

/* ══ 設定子頁：目標 ═══════════════════════════════ */
function openGoalSettings() {
  document.getElementById('sub-title').textContent = '目標設定';
  document.getElementById('sub-add-btn').style.display = 'none';
  const g = S.settings.goals||{};
  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>📅 週目標（NT$）</label>
      <input type="number" class="finp" id="g-weekly" value="${g.weekly||0}" inputmode="decimal"></div>
    <div class="fg" style="margin-bottom:14px"><label>📆 月目標（NT$）</label>
      <input type="number" class="finp" id="g-monthly" value="${g.monthly||0}" inputmode="decimal"></div>
    <button onclick="saveGoals()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">儲存目標</button>`;
  openOverlay('sub-page');
}
function saveGoals() {
  S.settings.goals = {
    weekly:  pf(document.getElementById('g-weekly').value),
    monthly: pf(document.getElementById('g-monthly').value),
  };
  saveSettings();
  closeOverlay('sub-page');
  renderSettings();
  toast('✅ 目標已儲存');
}

/* ══ 設定子頁：獎勵 ═══════════════════════════════ */
function openAddReward() {
  document.getElementById('sub-title').textContent = '新增獎勵項目';
  document.getElementById('sub-add-btn').style.display = 'none';
  const platOpts = S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>獎勵名稱</label>
      <input type="text" class="finp" id="rw-name" placeholder="例：週末衝單獎勵"></div>
    <div class="fg" style="margin-bottom:10px"><label>適用平台</label>
      <select class="fsel" id="rw-plat">${platOpts}</select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="fg"><label>最低單數</label>
        <input type="number" class="finp" id="rw-min" value="0" inputmode="numeric"></div>
      <div class="fg"><label>上限單數（0=無限）</label>
        <input type="number" class="finp" id="rw-max" value="0" inputmode="numeric"></div>
    </div>
    <div class="fg" style="margin-bottom:14px"><label>獎勵金額（NT$）</label>
      <input type="number" class="finp" id="rw-amt" value="0" inputmode="decimal"></div>
    <button onclick="saveNewReward()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">新增獎勵</button>`;
  openOverlay('sub-page');
}
function saveNewReward() {
  const name = document.getElementById('rw-name').value.trim();
  if (!name) { toast('請輸入獎勵名稱'); return; }
  if (!S.settings.rewards) S.settings.rewards=[];
  S.settings.rewards.push({
    id:         newId(),
    name,
    platformId: document.getElementById('rw-plat').value,
    minOrders:  pf(document.getElementById('rw-min').value),
    maxOrders:  pf(document.getElementById('rw-max').value),
    amount:     pf(document.getElementById('rw-amt').value),
  });
  saveSettings();
  closeOverlay('sub-page');
  renderSettings();
  toast('✅ 獎勵已新增');
}
async function deleteReward(i) {
  const ok = await customConfirm(`確定刪除「${S.settings.rewards[i]?.name}」？`);
  if (!ok) return;
  S.settings.rewards.splice(i,1);
  saveSettings();
  renderSettings();
  toast('已刪除');
}
/** sub-page 的＋按鈕（根據目前 subMode 決定動作）*/
function subAddAction() {}

/* ══ 備份 / 還原 / 匯出 ════════════════════════ */
/** 備份為 JSON 檔 */
function doBackup() {
  const data = { exportedAt:new Date().toISOString(), records:S.records, platforms:S.platforms, settings:S.settings };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `外送記帳_${todayStr()}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('✅ 備份完成');
}
/** 還原 JSON 備份 */
function doRestore() {
  const fi = document.getElementById('restore-file');
  fi.onchange = async () => {
    const file = fi.files[0]; if(!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const ok   = await customConfirm('確定用此備份<strong>覆蓋</strong>現有資料？');
      if (!ok) return;
      if (data.records)   { S.records=data.records;     saveRecords();   }
      if (data.platforms) { S.platforms=data.platforms;  savePlatforms(); }
      if (data.settings)  { S.settings=data.settings;   saveSettings();  }
      toast('✅ 還原成功');
      renderSettings(); renderHome();
    } catch { toast('❌ 檔案格式錯誤'); }
    fi.value='';
  };
  fi.click();
}
/** 匯出 CSV 試算表 */
function doExportCSV() {
  const headers = ['日期','平台','接單數','行程收入','固定獎勵','臨時獎勵','小費','總收入','工時','上線','下線','備註'];
  const rows = S.records.map(r=>{
    const p = getPlatform(r.platformId);
    return [r.date, p.name, r.orders||0, r.income||0, r.bonus||0, r.tempBonus||0, r.tips||0,
      recTotal(r), r.hours||0, r.punchIn||'', r.punchOut||'', r.note||''].join(',');
  });
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`外送記帳_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('✅ CSV 匯出完成');
}
/** 清除所有資料 */
async function doReset() {
  const ok = await customConfirm('⚠️ 確定要<strong>清除所有記錄和設定</strong>嗎？<br>此動作無法復原！');
  if (!ok) return;
  S.records=[]; S.settings={...DEFAULT_SETTINGS};
  saveRecords(); saveSettings();
  toast('已清除所有資料');
  renderHome(); renderSettings();
}

/* ══ Service Worker 註冊 ════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(r=>console.log('SW 已註冊：', r.scope))
      .catch(e=>console.log('SW 註冊失敗：', e));
  });
}

/* ══ 初始化 ══════════════════════════════════════ */
function init() {
  loadAll();
  // 若尚無平台資料，使用預設值
  if (!S.platforms || !S.platforms.length) {
    S.platforms = DEFAULT_PLATFORMS.map(p=>({...p}));
    savePlatforms();
  }
  renderHome();
}
// 啟動 App
init();
