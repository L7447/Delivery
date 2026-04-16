/* ══════════════════════════════════════════════════════
   外送記帳 App — script.js
   設計：由上到下分區註解，結構清晰，不閃爍，功能完整
   ══════════════════════════════════════════════════════ */

/* ══ 1. 共用工具函式與狀態 開始 ══════════════════════════════ */
const KEYS = { records: 'delivery_records', platforms: 'delivery_platforms', settings: 'delivery_settings', punch: 'delivery_punch_live', vehicles: 'delivery_vehicles', vehicleRecs: 'delivery_vehicle_recs' };
const DEFAULT_PLATFORMS = [
  { id:'uber', name:'Uber Eats', color:'#008000', active:false, ruleDesc:'每週一、四結算｜每週四發薪' },
  { id:'foodpanda', name:'foodpanda', color:'#D70F64', active:false, ruleDesc:'雙週日結算｜結算後週三明細｜隔週三發薪' },
  { id:'foodomo', name:'foodomo', color:'#ff0000', active:false, ruleDesc:'每月15及月底結算｜每月5及20發薪' },
];
// 加入 yearly: 0
const DEFAULT_SETTINGS = { goals: { weekly: 0, monthly: 0, yearly: 0 }, rewards: [], shopHistory: [] };

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

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
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
let isSimulatingProgress = false;

function showProgress(text) {
  const ov = document.getElementById('progress-overlay');
  const fill = document.getElementById('big-progress-fill');
  const txt = document.getElementById('big-progress-text');
  
  txt.textContent = text;
  fill.style.transition = 'none';
  fill.style.width = '0%';
  ov.classList.add('show');
  
  void fill.offsetWidth; // 強制重繪
  
  // 啟動緩步前進的模擬進度 (3秒跑到 85%)
  fill.style.transition = 'width 3s cubic-bezier(0.1, 0.8, 0.2, 1)';
  fill.style.width = '85%';
  isSimulatingProgress = true;
}

function finishProgress(callback) {
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
  setTimeout(() => { finishProgress(callback); }, 1200); 
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
function closeOverlay(id) { document.getElementById(id)?.classList.remove('show'); }
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

/* ══ 替換：產生總結卡片 (統一版面、背景 #FFF0F5、深色數據) ══ */
function buildSummaryCard(title, total, orders, hours, bonus, tempBonus, tips, cardId) {
  if (total <= 0) return '';
  const totalBonus = bonus + tempBonus; 
  let tagsHtml = '';
  if (orders > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${fmt(orders)} 單</span>`;
  if (hours > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${fmtHours(hours)}</span>`;
  if (totalBonus > 0) tagsHtml += `<span class="h-div"></span><span class="lbl-bonus">獎勵 $${fmt(totalBonus)}</span>`;
  if (tips > 0) tagsHtml += `<span class="h-div"></span><span class="lbl-tips">小費 $${fmt(tips)}</span>`;

  const avgOrd = orders > 0 ? Math.round(total / orders) : 0;
  const ordHr = hours > 0 ? (orders / hours).toFixed(1) : 0;
  const avgHr = hours > 0 ? Math.round(total / hours) : 0;

  return `
    <div class="hist-rec-card" style="border: 1.5px solid #708090; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
      <div class="hrc-top" onclick="foldCard('${cardId}', event)">
        <div class="hrc-toggle" id="${cardId}-btn">▼</div>
        <div class="hrc-row1">
          <span class="hrc-plat-tag" style="background:var(--t2);">${title}</span>
        </div>
        <div class="hrc-row2">
          <span class="hrc-amt" style="color:var(--acc);">$${fmt(total)}</span>
          ${tagsHtml}
        </div>
      </div>
      <div id="${cardId}" class="hrc-collapse" style="background: #FFF0F5; overflow:hidden; transition:max-height 0.3s ease;">
        <div style="border-top:3px dashed #778899; margin-bottom:3px;"></div>
        <div style="padding:8px 12px; display:flex; justify-content:center; align-items:center; font-size:11px; font-weight:700; color:var(--t2); width:100%;">
          <div style="flex:1; text-align:center;">一單： <span style="font-family:var(--mono); color: #00BFFF; font-size:18px; font-weight:800;">$${fmt(avgOrd)}</span></div>
          <div class="h-div" style="height:20px;"></div>
          <div style="flex:1; text-align:center;">1 h： <span style="font-family:var(--mono); color: #ff0000; font-size:18px; font-weight:800;">${ordHr} <small style="color: rgb(185, 56, 255);font-size:11px">單</small></span></div>
          <div class="h-div" style="height:20px;"></div>
          <div style="flex:1; text-align:center;">時薪： <span style="font-family:var(--mono); color: #1E90FF; font-size:18px; font-weight:800;">$${fmt(avgHr)}</span></div>
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

function loadAll() {
  try { S.records = JSON.parse(localStorage.getItem(KEYS.records)||'[]'); } catch { S.records=[]; }
  try { 
    const saved = JSON.parse(localStorage.getItem(KEYS.platforms)||'[]'); 
    if (saved && saved.length > 0) {
      S.platforms = DEFAULT_PLATFORMS.map(dp => {
        const sp = saved.find(s => s.id === dp.id);
        return sp ? { ...dp, ...sp } : { ...dp };
      });
    } else {
      S.platforms = DEFAULT_PLATFORMS.map(p => ({...p}));
    }
  } catch { 
    S.platforms = DEFAULT_PLATFORMS.map(p => ({...p})); 
  }
  try { S.settings = { ...DEFAULT_SETTINGS, shopHistory: [], ...JSON.parse(localStorage.getItem(KEYS.settings)||'{}') }; } catch { S.settings = { ...DEFAULT_SETTINGS, shopHistory: [] }; }
  try { S.punch = JSON.parse(localStorage.getItem(KEYS.punch)||'null'); } catch { S.punch=null; }
  try { S.vehicles = JSON.parse(localStorage.getItem(KEYS.vehicles)||'[]'); } catch { S.vehicles=[]; }
  try { S.vehicleRecs = JSON.parse(localStorage.getItem(KEYS.vehicleRecs)||'[]'); } catch { S.vehicleRecs=[]; }
}  

function saveRecords()     { localStorage.setItem(KEYS.records,   JSON.stringify(S.records));     }
function savePlatforms()   { localStorage.setItem(KEYS.platforms, JSON.stringify(S.platforms));   }
function saveSettings()    { localStorage.setItem(KEYS.settings,  JSON.stringify(S.settings));    }
function savePunch()       { localStorage.setItem(KEYS.punch,     JSON.stringify(S.punch));       }
function saveVehicles()    { localStorage.setItem(KEYS.vehicles,  JSON.stringify(S.vehicles));    }
function saveVehicleRecs() { localStorage.setItem(KEYS.vehicleRecs,JSON.stringify(S.vehicleRecs)); }

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
  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'report')   renderReport();
  if (name === 'vehicles') renderVehicles(); 
  if (name === 'settings') renderSettings();
}
document.querySelectorAll('.ni[data-pg]').forEach(el => el.addEventListener('click', () => { const pg = el.dataset.pg; if (pg === 'add' && S.tab !== 'add') openAddPage(); else goPage(pg); }));

function switchHomeTab(tab, index) { S.homeSubTab = tab; document.getElementById('home-tab-bg').style.transform = `translateX(${index * 100}%)`; document.getElementById('btn-home-schedule').classList.toggle('active', tab==='schedule'); document.getElementById('btn-home-goal').classList.toggle('active', tab==='goal'); renderHome(); }
function switchHistTab(tab, index) { S.histTab = tab; S.histNavDate = new Date(); document.getElementById('hist-tab-bg').style.transform = `translateX(${index * 100}%)`; document.querySelectorAll('#page-history .slide-btn').forEach((btn, i) => btn.classList.toggle('active', i === index)); renderHistory(); }
function switchRptTab(tab, index, btnEl) { S.rptView = tab; document.getElementById('rpt-tab-bg').style.transform = `translateX(${index * 100}%)`; document.querySelectorAll('#rpt-tabs .slide-btn').forEach(btn => btn.classList.remove('active')); btnEl.classList.add('active'); ['overview','trend','compare','top3'].forEach(v => { document.getElementById(`rv-${v}`).style.display = v===S.rptView ? '' : 'none'; }); renderReport(); }
function switchVehicleTab(tab, index) { S.vehicleTab = tab; document.getElementById('veh-tab-bg').style.transform = `translateX(${index * 100}%)`; document.getElementById('btn-veh-fuel').classList.toggle('active', tab === 'fuel'); document.getElementById('btn-veh-maint').classList.toggle('active', tab === 'maintenance'); renderVehicleContent(); }
/* ══ 1. 共用工具函式與狀態 結束 ══════════════════════════════ */

/* ══ 2. 首頁 開始 ══════════════════════════════════════════ */
function renderHome() {
  try {
    const today = todayStr();
    const dayRecs = getDayRecs(today) || [];
    
    const total   = dayRecs.reduce((s, r) => s + recTotal(r), 0);
    const orders  = dayRecs.reduce((s, r) => s + pf(r.orders), 0);
    const hours   = dayRecs.filter(r => !r.isPunchOnly).reduce((s, r) => s + pf(r.hours), 0);
    
    const dateObj = new Date(today + 'T00:00:00');
    const dow     = ['日','一','二','三','四','五','六'][dateObj.getDay() || 0];

    const activePlatforms = (S.platforms || []).filter(p => p.active);
    const platStats = activePlatforms.map(p => {
      const recs = dayRecs.filter(r => r.platformId === p.id);
      return {
        ...p,
        sum:    recs.reduce((s, r) => s + recTotal(r), 0),
        orders: recs.reduce((s, r) => s + pf(r.orders), 0),
        hours:  recs.reduce((s, r) => s + pf(r.hours), 0)
      };
    }).filter(p => p.sum > 0 || p.orders > 0 || p.hours > 0);

    let topHtml = `
      <div style="padding:16px 16px 0; flex-shrink:0;">
        <div class="home-header" style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px;">
          <div class="home-pg-title" style="font-family:var(--title); font-size:24px; font-weight:800; color:var(--t1); line-height:1.2;">今日概況</div>
          <div class="home-pg-date" style="font-size:13px; color:var(--t2); font-weight:500; background:var(--sf); padding:6px 12px; border-radius:20px; border:1px solid var(--border); box-shadow:0 2px 6px rgba(0,0,0,0.03);">
            <b>${dateObj.getFullYear()}</b> 年 <b>${dateObj.getMonth()+1}</b> 月 <b>${dateObj.getDate()}</b> 日 星期 <b>${dow}</b>
          </div>
        </div>
        <div class="today-hero">`;

    if (platStats.length > 0) {
      topHtml += `<div class="hero-plat-list" style="display:flex; flex-direction:column; gap:4px;">`;
      platStats.forEach(p => {
        topHtml += `
          <div class="hero-plat-row" style="display:flex; align-items:center; padding:8px 14px; border-radius:12px; font-size:13px; font-weight:600; background:${p.color}15; border: 1px solid ${p.color}60; color: ${p.color};">
            <span class="hp-name" style="width:35%; white-space:nowrap;">${p.name}收入：</span>
            <span class="hp-sum" style="font-family:var(--mono); font-weight:800; width:25%; text-align:right;">$ ${fmt(p.sum)}</span>
            <span class="hp-ord" style="font-weight:600; width:20%; text-align:right;">${p.orders} 單</span>
            <span class="hp-hrs" style="font-weight:600; width:20%; text-align:right; opacity:0.8;">${p.hours > 0 ? fmtHours(p.hours) : 0}</span>
          </div>`;
      });
      topHtml += `</div>`;
    } else {
      topHtml += `<div style="text-align:center; font-size:13px; color:var(--t3); margin:12px 0;">今日尚未有收入資料</div>`;
    }

    const dayBonus = dayRecs.reduce((s,r)=>s+pf(r.bonus), 0);
    const dayTemp  = dayRecs.reduce((s,r)=>s+pf(r.tempBonus), 0);
    const dayTips  = dayRecs.reduce((s,r)=>s+pf(r.tips), 0);
    
    topHtml += buildSummaryCard('總計', total, orders, hours, dayBonus, dayTemp, dayTips, 'home-summary-card');
    topHtml += `</div>`;

    const isPunched = S.punch && S.punch.date === today;
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
      <div class="punch-card-new" style="background:linear-gradient(145deg, #ffffff, #f9fafb); border:1px solid #f3f4f6; border-radius:20px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; margin:8px 0; box-shadow:0 8px 20px rgba(0,0,0,0.03);">
        <div class="punch-status-left" style="display:flex; align-items:center; gap:10px; font-size:15px; font-weight:700;">
          <div class="punch-dot-new ${isPunched ? 'online' : ''}"></div>
          <span style="color:${isPunched ? 'var(--green)' : 'var(--t2)'}">${punchStatusStr}</span>
        </div>
        <button class="punch-btn-right ${isPunched ? 'btn-go-offline' : 'btn-go-online'}" onclick="${isPunched ? 'punchOut()' : 'punchIn()'}">
          ${isPunched ? '⏹ 下線打卡' : '▶ 上線打卡'}
        </button>
      </div>`;

    if (!S.homeSubTab) S.homeSubTab = 'schedule';
    let bottomHtml = '';

    if (S.homeSubTab === 'schedule') {
      if (activePlatforms.length === 0) {
        bottomHtml += `<div class="empty-tip">請先至「設定」頁，啟用平台</div>`;
      } else {
        bottomHtml += `<div style="display:flex; flex-direction:column; gap:4px; padding:0 3px;">`;
        activePlatforms.forEach(p => {
          const events = calcNextDates(p.id); 
          if (!events) return;
          bottomHtml += `
            <div style="border: 2px solid ${p.color}; background: ${p.color}20; border-radius: 22px; padding: 8px 10px; margin-bottom: 2px;">
              <div style="display:flex; align-items:center; gap:5px; margin-bottom: 5px;">
                <div style="width:10px; height:10px; border-radius:50%; background:${p.color}; box-shadow: 0 0 0 3px rgba(255,255,255,0.95);"></div>
                <span style="font-size:14px; font-weight:800; color:${p.color}; letter-spacing:0.5px;">${p.name}</span>
              </div>
              <div style="display:flex; gap:6px;">${events.map(ev => {
                const isToday = ev.diff === 0;
                const dateColor = isToday ? 'var(--green)' : 'var(--t1)';
                let diffColor = isToday ? 'var(--green)' : 'var(--t2)';
                let nameColor = 'var(--t3)';
                if (ev.name.includes('結算') || ev.name.includes('取單')) nameColor = 'var(--red)';
                else if (ev.name.includes('明細')) nameColor = 'var(--acc)';
                else if (ev.name.includes('發薪')) nameColor = '#0040ff';
                if (!isToday && (ev.name.includes('結算') || ev.name.includes('發薪') || ev.name.includes('明細') || ev.name.includes('取單'))) diffColor = '#22C55E';
                return `
                  <div style="flex:1; background: var(--sf); border: 2.5px solid #10a3ff; border-radius: 20px; padding: 4px 4px; text-align: center; display:flex; flex-direction:column; justify-content:center;">
                    <span style="font-size:14px; color:${nameColor}; font-weight:800; margin-bottom:2px; letter-spacing:0.5px;">${ev.name}</span>
                    <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:${dateColor};">${ev.dateStr} <span style="font-size:13px; font-weight:600; color:${diffColor};">(${ev.diffStr})</span></span>
                  </div>`;
              }).join('')}</div>
            </div>`;
        });
        bottomHtml += `</div>`;
      }
    } 

    else if (S.homeSubTab === 'goal') {
      const goals = S.settings.goals || {};
      const weekly = pf(goals.weekly);
      const monthly = pf(goals.monthly);
      const yearly = pf(goals.yearly);
      
      if (weekly > 0 || monthly > 0 || yearly > 0) {
        bottomHtml += `<div class="card" style="border: 2px solid var(--border); display:flex; flex-direction:column; gap:16px;">`;
        
        // 本週目標 (計算剩餘天數)
        if (weekly > 0) {
          const wDate = new Date(dateObj); const wDay = wDate.getDay() || 7; wDate.setDate(wDate.getDate() - wDay + 1); let weekTotal = 0;
          for(let i=0; i<7; i++) { const dStr = `${wDate.getFullYear()}-${pad(wDate.getMonth()+1)}-${pad(wDate.getDate())}`; weekTotal += getDayRecs(dStr).reduce((s,r)=>s+recTotal(r),0); wDate.setDate(wDate.getDate() + 1); }
          const wPct = Math.min(100, Math.round(weekTotal/weekly*100)); const wRemain = Math.max(0, weekly-weekTotal); const wColor = wPct >= 100 ? 'var(--green)' : wPct >= 70 ? 'var(--blue)' : 'var(--red)';
          const remainDaysW = 7 - wDay;
          
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">📊 本週目標進度 <span style="font-size:11px;color:var(--t3);font-weight:500;">(剩 ${remainDaysW} 天)</span></span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${wColor}">${wPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${wPct}%;background:${wColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(weekTotal)}</span><span>${wRemain>0?`還差 $ ${fmt(wRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        
        // 本月目標 (計算剩餘天數)
        if (monthly > 0) {
          const monthRecs  = getMonthRecs(dateObj.getFullYear(), dateObj.getMonth()+1); const monthTotal = monthRecs.reduce((s,r)=>s+recTotal(r), 0);
          const mPct = Math.min(100, Math.round(monthTotal/monthly*100)); const mRemain = Math.max(0, monthly-monthTotal); const mColor = mPct >= 100 ? 'var(--green)' : mPct >= 70 ? 'var(--blue)' : 'var(--red)';
          const remainDaysM = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate() - dateObj.getDate();
          
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">📈 本月目標進度 <span style="font-size:11px;color:var(--t3);font-weight:500;">(剩 ${remainDaysM} 天)</span></span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${mColor}">${mPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${mPct}%;background:${mColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(monthTotal)}</span><span>${mRemain>0?`還差 $ ${fmt(mRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        
        // 本年目標 (計算剩餘天數)
        if (yearly > 0) {
          const yearRecs = S.records.filter(r => r.date.startsWith(`${dateObj.getFullYear()}-`)); const yearTotal = yearRecs.reduce((s,r)=>s+recTotal(r), 0);
          const yPct = Math.min(100, Math.round(yearTotal/yearly*100)); const yRemain = Math.max(0, yearly-yearTotal); const yColor = yPct >= 100 ? 'var(--green)' : yPct >= 70 ? 'var(--blue)' : 'var(--red)';
          const remainDaysY = Math.ceil((new Date(dateObj.getFullYear(), 11, 31) - dateObj) / 86400000);
          
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">👑 本年目標進度 <span style="font-size:11px;color:var(--t3);font-weight:500;">(剩 ${remainDaysY} 天)</span></span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${yColor}">${yPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${yPct}%;background:${yColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(yearTotal)}</span><span>${yRemain>0?`還差 $ ${fmt(yRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }

        bottomHtml += `</div>`;
      } else {
        bottomHtml += `<div class="empty-tip">請先至「設定」頁，設定目標</div>`;
      }
    }

    const topEl = document.getElementById('home-top-content');
    const botEl = document.getElementById('home-bottom-content');
    if (topEl) topEl.innerHTML = topHtml;
    if (botEl) botEl.innerHTML = bottomHtml;

  } catch (error) {
    console.error("首頁渲染錯誤：", error);
    document.getElementById('home-bottom-content').innerHTML = `<div class="empty-tip">渲染發生錯誤，請重新整理頁面。</div>`;
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
  if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { el.style.maxHeight = '45px'; btn.style.transform = 'rotate(180deg)'; } 
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

/* ══ 替換：產生單筆記錄卡片 (修正點擊事件、備註紅字、摺疊內容置中) ══ */
function buildRecItem(r) {
  const cid = `hrc-${r.id}`;
  if (r.isCashTip) {
    const plat = getPlatform(r.platformId);
    return `
      <div class="hist-rec-card cashtip-card" data-id="${r.id}" onclick="openDetailOverlay('${r.id}')">
        <div class="hrc-top" style="padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="hrc-plat-tag" style="background:${plat.color};">${plat.name}</span>
              <span style="font-size:11px; font-weight:700; color: #16a34a;">💵 現金小費</span>
              <span style="font-size:11px; color:var(--t3);">${r.time||''}</span>
            </div>
            ${r.note ? `<div style="font-size:11px; color:var(--red); font-weight:700;">${r.note}</div>` : ''}
          </div>
          <div style="font-family:var(--mono); font-size:18px; font-weight:800; color:#16a34a;">$${fmt(r.cashTipAmt)}</div>
        </div>
      </div>`;
  }
  if (r.isPunchOnly) {
    return `
      <div class="hist-rec-card punch-card-compact" data-id="${r.id}" onclick="openDetailOverlay('${r.id}')">
        <span style="background:var(--t2); color:#fff; font-size:10px; padding:3px 8px; border-radius:6px; font-weight:700; letter-spacing:0.5px;">🕒 上線打卡</span>
        <div class="h-div" style="margin:0 12px;"></div>
        <span style="font-family:var(--mono); color:var(--t1); font-size:13px; font-weight:600; flex:1; text-align:center;">${r.punchIn} <span style="color:var(--t3);font-size:11px;">→</span> ${r.punchOut}</span>
        <div class="h-div" style="margin:0 12px;"></div>
        <span style="font-size:13px; font-weight:800; color:var(--t2); font-family:var(--mono);">${fmtHours(r.hours)}</span>
      </div>`;
  }
  
  const plat = getPlatform(r.platformId); const total = recTotal(r);
  const totalBonus = pf(r.bonus) + pf(r.tempBonus);
  const _orders = pf(r.orders); const _hours = pf(r.hours);
  const avgOrd = _orders > 0 ? Math.round(total / _orders) : 0;
  const ordHr = _hours > 0 ? (_orders / _hours).toFixed(1) : 0;
  const avgHr = _hours > 0 ? Math.round(total / _hours) : 0;
  
  let tagsHtml = '';
  if (_orders > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${_orders} 單</span>`;
  if (r.mileage > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${r.mileage} km</span>`; 
  if (_hours > 0) tagsHtml += `<span class="h-div"></span><span class="hrc-stat">${fmtHours(_hours)}</span>`;
  if (totalBonus > 0) tagsHtml += `<span class="h-div"></span><span class="lbl-bonus">獎勵 $${fmt(totalBonus)}</span>`;
  if (r.tips > 0) tagsHtml += `<span class="h-div"></span><span class="lbl-tips">小費 $${fmt(r.tips)}</span>`;

  return `
    <div class="hist-rec-card" data-id="${r.id}">
      <!-- 外層加上 onclick 開啟詳情 -->
      <div class="hrc-top" onclick="openDetailOverlay('${r.id}')">
        <!-- ▼ 折疊按鈕：獨立事件折疊卡片 -->
        <div class="hrc-toggle" id="${cid}-btn" onclick="foldCard('${cid}', event)">▼</div>
        <div class="hrc-row1">
          <span class="hrc-plat-tag" style="background:${plat.color};">${plat.name}</span>
          <span>${r.time||''}</span>
          ${r.note ? `<span class="h-div"></span><span style="color:var(--red); font-weight:700;"> ${r.note}</span>` : ''}
        </div>
        <div class="hrc-row2">
          <span class="hrc-amt">$${fmt(total)}</span>
          ${tagsHtml}
        </div>
      </div>

      <div id="${cid}" class="hrc-collapse" style="background: rgba(255, 240, 245, 0.90); overflow:hidden; transition:max-height 0.3s ease;">
        <div style="border-top:3px dashed #708090; margin-bottom:3px;"></div>
        <div style="padding:8px; display:flex; justify-content:center; align-items:center; font-size:11px; font-weight:700; color:var(--t2); width:100%;">
          <div style="flex:1; text-align:center;">一單： <span style="font-family:var(--mono); color: #00BFFF; font-size:18px; font-weight:800;">$${fmt(avgOrd)}</span></div>
          <div class="h-div" style="height:20px;"></div>
          <div style="flex:1; text-align:center;">1 h： <span style="font-family:var(--mono); color: #ff0000; font-size:18px; font-weight:800;">${ordHr} <small style="color: rgb(185, 56, 255);font-size:11px">單</small></span></div>
          <div class="h-div" style="height:20px;"></div>
          <div style="flex:1; text-align:center;">時薪： <span style="font-family:var(--mono); color: #1E90FF; font-size:18px; font-weight:800;">$${fmt(avgHr)}</span></div>
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
  let platOpts = `<option value="all">全部平台</option>` + S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}" ${S.histFilter===p.id?'selected':''}>${p.name}</option>`).join('');
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
  const rows = [ ['🏪 平台', `<span style="color:${plat.color};font-weight:600">${plat.name}</span>`], ['📆 日期', r.date], ['⏱ 打卡', r.punchIn&&r.punchOut?`${r.punchIn} → ${r.punchOut}`:(r.punchIn?r.punchIn:'—')], ['🕐 工時', r.hours>0?fmtHours(r.hours):'—'], ['📦 接單數', r.orders>0?`${r.orders} 單`:'—'], ['🛣️ 行駛里程', r.mileage>0?`${r.mileage} km`:'—'], ['💰 行程收入',`NT$ ${fmt(r.income)}`], ['🎁 固定獎勵',r.bonus>0?`NT$ ${fmt(r.bonus)}`:'—'], ['⚡ 臨時獎勵',r.tempBonus>0?`NT$ ${fmt(r.tempBonus)}`:'—'], ['🤑 小費', r.tips>0?`NT$ ${fmt(r.tips)}`:'—'], ['📝 備註', r.note||'—'] ];
  document.getElementById('detail-body').innerHTML = `<div style="text-align:center;padding:10px 0 16px;border-bottom:1px solid var(--border)"><div style="font-size:13px;color:var(--t3);margin-bottom:4px">本筆總收入</div><div style="font-family:var(--mono);font-size:38px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div></div><div style="margin-top:12px">${rows.map(([l,v])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--t3)">${l}</span><span style="font-size:13px;font-weight:500">${v}</span></div>`).join('')}</div><div style="display:flex;gap:8px;margin-top:16px"><button onclick="closeDetailOverlay();openAddPage(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--acc-d);color:var(--acc);border:1px solid rgba(255,107,53,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">✎ 編輯</button><button onclick="deleteRecord('${r.id}')" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--red-d);color:var(--red);border:1px solid rgba(239,68,68,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">🗑 刪除</button></div>`;
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
  
  if(tab === 'cashtip') {
    document.getElementById('f-ct-date').value = document.getElementById('f-ct-date').value || todayStr();
    document.getElementById('f-ct-time').value = document.getElementById('f-ct-time').value || nowTime();
  }
}

function calcCashTip() {
  const given = pf(document.getElementById('f-ct-given').value);
  const cost = pf(document.getElementById('f-ct-cost').value);
  if (given > 0 && cost > 0 && given >= cost) {
    document.getElementById('f-ct-amount').value = given - cost;
  }
}

function renderPlatformChips() { const container = document.getElementById('platform-chips'); const active = S.platforms.filter(p=>p.active); if (!S.selPlatformId && active.length) S.selPlatformId = active[0].id; container.innerHTML = active.map(p => `<div class="platform-chip${S.selPlatformId===p.id?' on':''}" style="${S.selPlatformId===p.id?`background:${p.color};border-color:${p.color}`:''}" onclick="selectPlatform('${p.id}')"><span>${p.name}</span></div>`).join(''); }
function selectPlatform(id) { S.selPlatformId = id; renderPlatformChips(); }
function calcAddTotal() { const income = pf(document.getElementById('f-income').value); const bonus = pf(document.getElementById('f-bonus').value); const tempBonus = pf(document.getElementById('f-temp-bonus').value); const tips = pf(document.getElementById('f-tips').value); const total = income + bonus + tempBonus + tips; document.getElementById('add-total-val').textContent = fmt(total); }
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
    rec = { ...rec, isCashTip: false, date: document.getElementById('f-date').value || todayStr(), time: nowTime(), punchIn: '', punchOut: '', hours: totalHours, orders: pf(document.getElementById('f-orders').value), income, bonus, tempBonus: temp, tips, note: document.getElementById('f-note').value.trim() };
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
    S.editingId = null; 
    checkBtn.disabled = false; 
    goPage('home'); 
  });
}

function cancelAddRecord() {
  if (S.editingId) { S.editingId = null; goPage('history'); } else { goPage('home'); }
}
/* ══ 4. 新增記錄 結束 ════════════════════════════════════ */

/* ══ 5. 收入分析 開始 ════════════════════════════════════ */
function renderReport() {
  if (!S.trendDate) S.trendDate = new Date();
  if (S.rptView === 'overview') renderRptOverview(); 
  if (S.rptView === 'trend') renderRptTrend();
  if (S.rptView === 'compare') renderRptCompare(); 
  if (S.rptView === 'top3') renderRptTop3();
}

window.navRptMonth = function(dir) {
  S.rptM += dir;
  if(S.rptM < 1) { S.rptM = 12; S.rptY--; }
  if(S.rptM > 12) { S.rptM = 1; S.rptY++; }
  renderReport();
}

window.navTrend = function(dir) {
  let d = new Date(S.trendDate || new Date());
  if (S.trendMode === 'week') d.setDate(d.getDate() + dir * 7);
  else if (S.trendMode === 'month') d.setMonth(d.getMonth() + dir);
  else if (S.trendMode === 'year') d.setFullYear(d.getFullYear() + dir);
  S.trendDate = d;
  renderRptTrend();
}
document.getElementById('rpt-prev').addEventListener('click', ()=>{ S.rptM--; if(S.rptM<1){S.rptM=12;S.rptY--;} renderReport(); });
document.getElementById('rpt-next').addEventListener('click', ()=>{ S.rptM++; if(S.rptM>12){S.rptM=1;S.rptY++;} renderReport(); });

/* ══ 替換：收入總覽頁面 ══ */
function renderRptOverview() {
  if (!S.rptOverviewFilter) S.rptOverviewFilter = 'all';
  const allMonthRecs = getMonthRecs(S.rptY, S.rptM);
  
  // 依照選擇的標籤過濾資料
  const isAll = S.rptOverviewFilter === 'all';
  const recs = isAll ? allMonthRecs : allMonthRecs.filter(r => r.platformId === S.rptOverviewFilter);
  
  const total = recs.reduce((s,r) => s+recTotal(r), 0); 
  const income = recs.reduce((s,r) => s+pf(r.income), 0);
  const bonus = recs.reduce((s,r) => s+pf(r.bonus)+pf(r.tempBonus), 0); 
  const tips = recs.reduce((s,r) => s+pf(r.tips), 0);
  const orders = recs.reduce((s,r) => s+pf(r.orders), 0); 
  const hours = recs.reduce((s,r) => s+pf(r.hours), 0);
  const cashTipTotal = recs.filter(r=>r.isCashTip).reduce((s,r)=>s+pf(r.cashTipAmt), 0);

  const activePlats = S.platforms.filter(p=>p.active);
  let filterName = isAll ? '全部平台' : (activePlats.find(p=>p.id===S.rptOverviewFilter)?.name || '');

  // 頂部導航
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
      <button class="mbtn" onclick="navRptMonth(-1)">◀</button>
      <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${S.rptY} 年 ${S.rptM} 月</span>
      <button class="mbtn" onclick="navRptMonth(1)">▶</button>
    </div>`;

  // 精簡高對比總收入框
  html += `
    <div style="background: #ffffff; border:1px solid var(--border); border-radius:12px; position:relative; box-shadow:0 4px 12px rgba(0,0,0,0.03); margin-bottom:16px; overflow:hidden;">
      <div id="rpt-overview-col-btn" onclick="toggleSummaryCard('rpt-overview-col')" style="position:absolute; top:12px; right:12px; width:36px; height:36px; background: #ffffff; border-radius:12px; color:var(--acc); display:flex; align-items:center; justify-content:center; font-size:13px; cursor:pointer; transition:transform 0.3s; font-weight:900; z-index:2;box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.1);">▼</div>
      
      <div onclick="toggleSummaryCard('rpt-overview-col')" style="padding:16px; cursor:pointer; text-align:center;">
        <div style="font-size:12px; font-weight:800; color: #000000; margin-bottom:6px;">${filterName} 本月總收入</div>
        <div style="font-family:var(--mono); font-size:36px; font-weight:900; color: #00BFFF; line-height:1;">$${fmt(total)}</div>
        <div style="display:flex; justify-content:center; gap:8px; margin-top:14px; flex-wrap:wrap;">
          <div style="background: #dcfce7; color: #16a34a; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:800;">行程 $${fmt(income)}</div>
          <div style="background: hsl(32, 100%, 90%); color: #ff8800; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:800;">獎勵 $${fmt(bonus)}</div>
          <div style="background: #e0f2fe; color: #2563eb; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:800;">小費 $${fmt(tips)}</div>
        </div>
      </div>

      <div id="rpt-overview-col" style="max-height:0px; overflow:hidden; transition: max-height 0.35s ease; background: hsl(340, 100%, 98%);">
        <!-- 虛線往上調整 (margin 修改) -->
        <div style="border-top:2.5px dashed #1a5dc3; margin-bottom:12px;"></div>
        
        <div style="padding:8px 16px 12px; display:flex; justify-content:space-between; align-items:center;">
          <!-- 左半邊：接單、時薪 -->
          <div style="flex:1; display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding-right:12px;">
              <span style="background: #ff7700; color:#fff; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700;">完成訂單</span>
              <span style="font-family:var(--mono); font-size:15px; font-weight:800; color: #ff7700;">${fmt(orders)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-right:12px;">
              <span style="background:var(--blue); color:#fff; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700;">時薪</span>
              <span style="font-family:var(--mono); font-size:15px; font-weight:800; color:var(--blue);">${hours>0?`$${fmt(Math.round(total/hours))}`:'—'}</span>
            </div>
          </div>

          <!-- 加大垂直分隔線 -->
          <div style="width:2px; height:48px; background:#cbd5e1; border-radius:1px;"></div>

          <!-- 右半邊：工時、均單 -->
          <div style="flex:1; display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding-left:12px;">
              <span style="background:var(--t3); color:#fff; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700;">工時</span>
              <span style="font-family:var(--mono); font-size:15px; font-weight:800; color:var(--t1);">${fmtHours(hours)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-left:12px;">
              <span style="background: #ff0000; color:#fff; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700;">一單</span>
              <span style="font-family:var(--mono); font-size:15px; font-weight:800; color: #ff0000;">${orders>0?`$${fmt(Math.round(total/orders))}`:'—'}</span>
            </div>
          </div>
        </div>
        
        ${cashTipTotal > 0 ? `
        <div style="border-top:1px dashed rgba(0,0,0,0.05); margin:6px 16px;"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 16px 12px;">
          <span style="background:#16a34a; color:#fff; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700;">現金小費 (不計總收)</span>
          <span style="font-family:var(--mono); font-size:15px; font-weight:800; color:#16a34a;">$${fmt(cashTipTotal)}</span>
          <!-- 加大垂直分隔線 -->
          <div style="width:2px; height:24px; background:#cbd5e1; border-radius:1px;"></div>
        </div>` : ''}
      </div>
    </div>`;

  // 結構佔比分析卡片 (包含平台切換與圓餅圖)
  html += `<div class="card" style="border:1px solid var(--border);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <div style="font-size:13px; font-weight:800; color:var(--t2);">📊 結構佔比分析</div>
    </div>`;

  // 將平台切換按鈕放在卡片內部
  html += `<div style="display:flex; gap:8px; margin-bottom:16px; overflow-x:auto; padding-bottom:4px;">
    <button onclick="S.rptOverviewFilter='all'; renderReport()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isAll ? 'background:var(--acc); color:#fff; box-shadow:0 2px 6px rgba(255,107,53,0.3);' : 'background:var(--sf2); color:var(--t2);'}">全部</button>`;
  activePlats.forEach(p => {
    let isActive = S.rptOverviewFilter === p.id;
    html += `<button onclick="S.rptOverviewFilter='${p.id}'; renderReport()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isActive ? `background:${p.color}; color:#fff; box-shadow:0 2px 6px ${p.color}50;` : `background:${p.color}15; color:${p.color};`}">${p.name}</button>`;
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
        <span style="flex:1; font-size:13px; font-weight:700; color:var(--t1);">${p.name}</span>
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
        <span style="flex:1; font-size:13px; font-weight:700; color:var(--t1);">${d.name}</span>
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
    },
  ];
  
  const curT = S.trendMode||'month'; const trend = trends.find(t=>t.key===curT)||trends[1];
  const days = trend.getDays(); 

  let html = `<div style="display:flex;gap:6px;margin-bottom:10px">
    ${trends.map(t=>`<button onclick="S.trendMode='${t.key}';renderRptTrend()" style="flex:1;padding:6px;border-radius:var(--rs);border:1px solid ${curT===t.key?'var(--acc)':'var(--border)'};background:${curT===t.key?'var(--acc-d)':'var(--sf2)'};color:${curT===t.key?'var(--acc)':'var(--t2)'};font-size:12px;cursor:pointer;font-family:var(--sans);font-weight:${curT===t.key?'700':'500'}">${t.label}</button>`).join('')}
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
    <button class="mbtn" onclick="navTrend(-1)">◀</button>
    <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${navLabel}</span>
    <button class="mbtn" onclick="navTrend(1)">▶</button>
  </div>`;

  const plats = S.platforms.filter(p=>p.active);
  
  if (curT === 'year') {
    const labels = Array.from({length:12},(_,i)=>`${i+1}月`);
    const datasets = [];
    plats.forEach(p => {
      const data = Array.from({length:12}, (_,i)=> getMonthRecs(td.getFullYear(), i+1).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    const allTotal = S.records.filter(r=>r.date.startsWith(`${td.getFullYear()}-`)).reduce((s,r)=>s+recTotal(r),0);
    
    html += `<div class="card"><div style="height:260px; position:relative;"><canvas id="trend-chart"></canvas></div><div class="rpt-divider" style="margin-top:16px; margin-bottom:8px"></div><div class="rpt-total-row"><span class="rt-lbl gray">全年總收入</span><span class="rt-val" style="color:var(--green)">NT$ ${fmt(allTotal)}</span></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets);
  } 
  else if (curT === 'month') {
    const days1 = days.slice(0, 15); const days2 = days.slice(15);
    const labels1 = days1.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const labels2 = days2.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const datasets1 = []; const datasets2 = [];
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
    const datasets = [];
    plats.forEach(p => {
      const data = days.map(d=> getDayRecs(d).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    html += `<div class="card"><div style="height:260px; position:relative;"><canvas id="trend-chart"></canvas></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets);
  }
}

function drawTrendBar(canvasId, labels, datasets, showLegend = true, maxScale = null) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  
  const topTotalPlugin = {
    id: 'topTotalPlugin',
    afterDatasetsDraw: (chart) => {
      const ctx = chart.ctx;
      chart.data.labels.forEach((_, i) => {
        let total = 0; let meta;
        chart.data.datasets.forEach((dataset, j) => {
          meta = chart.getDatasetMeta(j);
          if (!meta.hidden) total += dataset.data[i];
        });
        if (total > 0 && meta) {
          const finalModel = meta.data[i];
          ctx.save();
          ctx.fillStyle = '#1C1917'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(fmt(total), finalModel.x, finalModel.y - 4);
          ctx.restore();
        }
      });
    }
  };

  const yOpts = { 
    stacked: true, 
    beginAtZero: true, 
    suggestedMax: maxScale || 500, 
    ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : v, font: { size: 10 } }, 
    grid: { color: 'rgba(0,0,0,.05)', drawBorder: false } 
  };
  
  if (maxScale) yOpts.max = maxScale;

  S.charts[canvasId] = new Chart(ctx, { 
    type: 'bar', 
    data: { labels, datasets }, 
    plugins: [topTotalPlugin],
    options: { 
      responsive: true, maintainAspectRatio: false, 
      layout: { padding: { top: 15 } },
      plugins: { 
        legend: { display: showLegend, position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } }, 
        tooltip: { mode: 'index', intersect: false, callbacks: { label: c => `${c.dataset.label}: NT$ ${fmt(c.parsed.y)}` } } 
      }, 
      scales: { x: { stacked: true, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: false }, grid: { display: false } }, y: yOpts }, 
      animation: { duration: 400 } 
    } 
  });
}

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

function renderRptTop3() {
  const el = document.getElementById('rv-top3'); const monthRecs = getMonthRecs(S.rptY, S.rptM); const dayMap = {};
  monthRecs.forEach(r => { dayMap[r.date] = (dayMap[r.date]||0) + recTotal(r); });
  const sorted = Object.entries(dayMap).sort((a,b)=>b[1]-a[1]); const medals = ['🥇','🥈','🥉'];

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
      <button class="mbtn" onclick="navRptMonth(-1)">◀</button>
      <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${S.rptY} 年 ${S.rptM} 月</span>
      <button class="mbtn" onclick="navRptMonth(1)">▶</button>
    </div>`;

  html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:12px">🏆 本月收入 TOP 3 日</div>`;
  if (!sorted.length) { html += `<div class="empty-tip">本月暫無記錄</div>`; } else {
    sorted.slice(0,3).forEach(([date,total],i) => {
      const d = new Date(date+'T00:00:00'); const recs = getDayRecs(date); const orders = recs.reduce((s,r)=>s+pf(r.orders),0); const hours = recs.reduce((s,r)=>s+pf(r.hours),0);
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><span style="font-size:28px">${medals[i]||'▶'}</span><div style="flex:1"><div style="font-size:14px;font-weight:600">${date} （${['日','一','二','三','四','五','六'][d.getDay()]}）</div><div style="font-size:11px;color:var(--t3);margin-top:2px">${orders>0?`${orders}單 `:''}${hours>0?`${fmtHours(hours)} `:''}</div></div><div style="font-family:var(--mono);font-size:18px;font-weight:800;color:var(--green)">$${fmt(total)}</div></div>`;
    });
  }
  html += `</div>`;
  const weekTotals = [];
  for (let w=3; w>=0; w--) {
    const startD = new Date(); startD.setDate(startD.getDate()-w*7); const endD = new Date(startD); endD.setDate(endD.getDate()+6); let sum = 0;
    S.records.forEach(r=>{ if(r.date>=`${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}`&&r.date<=`${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}`) sum += recTotal(r); });
    weekTotals.push({ label:`第${w+1}週前`, val:sum });
  }
  weekTotals.reverse();
  html += `<div class="card" style="margin-top:8px"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">📅 近4週收入</div><div style="position:relative;height:160px"><canvas id="week-bar"></canvas></div></div>`;
  el.innerHTML = html; drawBar('week-bar', weekTotals.map(w=>w.label.replace('第','W')), weekTotals.map(w=>w.val), '#FF6B35');
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
function changeVehMonth(offset) { S.vehM += offset; if (S.vehM < 1) { S.vehM = 12; S.vehY--; } if (S.vehM > 12) { S.vehM = 1; S.vehY++; } renderVehicles(); }
function selectVehicle(id) { S.selVehicleId = id; _syncVehSelectorActive(id); renderVehicleContent(); }

function renderVehicles() {
  const container = document.getElementById('vehicle-content'); 
  const selectorContainer = document.getElementById('veh-selector-container');
  
  container.style.minHeight = '0';
  container.style.WebkitOverflowScrolling = 'touch';

  document.getElementById('veh-month-label').textContent = `${S.vehY} 年 ${S.vehM} 月`;
  if (S.vehicles.length === 0) { selectorContainer.innerHTML = ''; container.innerHTML = `<div class="empty-tip">請點擊右上角新增車輛</div>`; return; }
  if (!S.selVehicleId || !S.vehicles.find(v => v.id === S.selVehicleId)) { S.selVehicleId = S.vehicles[0].id; }

  let selectorHtml = `<div style="font-size:12px; font-weight:700; color:var(--t3); margin-bottom:8px;">選擇車輛</div>`;
  selectorHtml += `<div style="display:flex; gap:12px; margin-bottom:12px; overflow-x:auto; padding:4px 4px 8px;">`;
  
  S.vehicles.forEach(v => {
    const isActive = v.id === S.selVehicleId;
    selectorHtml += `<div data-vid="${v.id}" style="position:relative; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:56px; cursor:pointer;" onclick="selectVehicle('${v.id}')"><div onclick="event.stopPropagation(); deleteVehicle('${v.id}')" style="position:absolute; top:-6px; right:-6px; background:var(--red); color:#fff; border-radius:50%; width:18px; height:18px; font-size:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; box-shadow:0 2px 4px rgba(239,68,68,0.3);">✕</div><div class="veh-sel-icon" style="width:50px; height:50px; border-radius:14px; background:#fff; border:2px solid ${isActive ? 'var(--acc)' : 'transparent'}; display:flex; align-items:center; justify-content:center; transition:border-color 0.2s, box-shadow 0.2s; box-shadow:${isActive ? '0 4px 10px rgba(255,107,53,0.2)' : '0 2px 6px rgba(0,0,0,0.06)'};"><div class="scooter-mask" style="background-color:${v.color}; -webkit-mask-image:url('images/scooter${v.icon}.png');"></div></div><span class="veh-sel-name" style="font-size:11px; font-weight:${isActive?'700':'600'}; color:${isActive?'var(--acc)':'var(--t2)'};">${v.name}</span></div>`;
  }); 
  selectorHtml += `</div>`; 
  selectorContainer.innerHTML = selectorHtml;
  
  renderVehicleContent();
}

function _syncVehSelectorActive(id) {
  document.querySelectorAll('#veh-selector-container [data-vid]').forEach(el => {
    const isActive = el.dataset.vid === id; const iconBox  = el.querySelector('.veh-sel-icon'); const nameSpan = el.querySelector('.veh-sel-name');
    if (iconBox) { iconBox.style.borderColor = isActive ? 'var(--acc)' : 'transparent'; iconBox.style.boxShadow = isActive ? '0 4px 10px rgba(255,107,53,0.2)' : '0 2px 6px rgba(0,0,0,0.06)'; }
    if (nameSpan) { nameSpan.style.color = isActive ? 'var(--acc)' : 'var(--t2)'; nameSpan.style.fontWeight = isActive ? '700' : '600'; }
  });
}

function renderVehicleContent() {
  const container = document.getElementById('vehicle-content'); if (!S.selVehicleId) { container.innerHTML = `<div class="empty-tip">請選擇車輛</div>`; return; }
  const prefix = `${S.vehY}-${pad(S.vehM)}`; const monthRecs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.date.startsWith(prefix));
  const fuelRecs = monthRecs.filter(r => r.type === 'fuel'); const maintRecs = monthRecs.filter(r => r.type === 'maintenance');

  let totalDistance = 0, totalLiters = 0, totalFuelPaid = 0, totalMaintPaid = 0;
  fuelRecs.forEach(r => { const diff = pf(r.km) - pf(r.prevKm); if (diff > 0) totalDistance += diff; totalLiters += pf(r.liters); totalFuelPaid += pf(r.amount); });
  maintRecs.forEach(r => totalMaintPaid += pf(r.amount)); const avgKmL = totalLiters > 0 ? (totalDistance / totalLiters).toFixed(1) : 0;

  let html = '';
  if (S.vehicleTab === 'fuel') {
    html += `<div class="veh-summary-fuel"><div style="font-size:13px; font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between;"><span>⛽ 本月燃料總計</span><span class="veh-sum-val">$${fmt(totalFuelPaid)}</span></div><div style="display:flex; justify-content:space-between; font-size:11px;"><div><span class="veh-sum-lbl">總油量</span><br><span style="font-weight:700;">${totalLiters.toFixed(1)} L</span></div><div><span class="veh-sum-lbl">總里程</span><br><span style="font-weight:700;">${fmt(totalDistance)} km</span></div><div><span class="veh-sum-lbl">平均油耗</span><br><span style="font-weight:700;">${avgKmL} km/L</span></div></div></div>`;
  } else {
    html += `<div class="veh-summary-maint"><div style="font-size:13px; font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between;"><span>🔧 本月保養總計</span><span class="veh-sum-val">$${fmt(totalMaintPaid)}</span></div><div style="display:flex; justify-content:space-between; font-size:11px;"><div><span class="veh-sum-lbl">本月保養次數</span><br><span style="font-weight:700;">${maintRecs.length} 筆</span></div></div></div>`;
  }

  const typeRecs = monthRecs.filter(r => r.type === S.vehicleTab);
  if (typeRecs.length === 0) { html += `<div class="empty-tip">本月尚未新增資料</div>`; } else {
    typeRecs.sort((a, b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||'')).forEach(r => {
      const isFuel = r.type === 'fuel'; 
      const isEV = r.fuelType === 'electric'; 
      const icon = isFuel ? (isEV ? '⚡' : '⛽') : '🔧'; 
      const mainText = isFuel ? (isEV ? '電池交換' : `${r.fuelType||'95 無鉛'} ($${r.price||0}/L)`) : r.items.join(', '); 
      const kmText = isFuel ? `${r.prevKm} → ${r.km} km` : `${r.km} km`;
      
      let rightText = `-$${fmt(r.amount)}`;
      let rightColor = 'var(--t1)';
      if (isFuel && isEV) {
          const diff = pf(r.km) - pf(r.prevKm);
          rightText = `${diff > 0 ? diff : 0} km`;
          rightColor = 'var(--acc)';
      }

      html += `
        <div onclick="openAddVehRec('${r.id}')" style="background:#fff; border-bottom:1px solid #f3f4f6; padding:10px 4px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; border-radius:10px; background:${isFuel?'#eff6ff':'#ecfdf5'}; color:${isFuel?'#3b82f6':'#10b981'}; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">${icon}</div>
            <div>
              <div style="font-size:13px; font-weight:700; color:var(--t1); margin-bottom:2px;">${mainText}</div>
              <div style="font-size:11px; font-family:var(--mono); color:var(--t3);">${kmText} • ${r.date.slice(5)} ${r.time||''}</div>
            </div>
          </div>
          <div style="font-family:var(--mono); font-size:15px; font-weight:800; color:${rightColor};">${rightText}</div>
        </div>`;
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

function openAddVehRec(recordId = null) {
  editingVehRecId = recordId; const isEdit = !!recordId; if (!isEdit && S.vehicles.length === 0) { toast('請先新增車輛'); return; }
  document.getElementById('veh-rec-title').textContent = isEdit ? '編輯車輛記錄' : '新增車輛記錄'; document.getElementById('veh-rec-del-btn').style.display = isEdit ? 'block' : 'none';
  
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  if (v) {
    document.getElementById('veh-rec-veh-icons').innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; gap:4px; margin:0 auto;"><div style="width:50px; height:50px; border-radius:12px; background:#fff; border:2px solid var(--acc); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(255,107,53,0.2);"><div class="scooter-mask" style="background-color:${v.color}; -webkit-mask-image:url('images/scooter${v.icon}.png'); width:30px; height:30px;"></div></div><span style="font-size:11px; font-weight:700; color:var(--acc);">${v.name}</span></div>`;
  }

  let r = null; if (isEdit) { r = S.vehicleRecs.find(x => x.id === recordId); S.addVehRecType = r.type; } else { S.addVehRecType = S.vehicleTab; }
  document.getElementById('vr-date').value = r ? r.date : todayStr(); document.getElementById('vr-time').value = r ? (r.time || nowTime()) : nowTime();
  currentSelItems = (r && r.type === 'maintenance') ? [...r.items] :[];
  
  /* 替換 openAddVehRec 函式的下半部 */
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

  // 若為新增燃料記錄且未手動填寫油價，開啟時自動抓取最新油價
  if (!isEdit && S.addVehRecType === 'fuel' && !document.getElementById('vr-price').value) {
    fetchAutoGasPrice();
  }
}


function switchVehFormTab(type, index) {
  S.addVehRecType = type; document.getElementById('veh-form-tab-bg').style.transform = `translateX(${index * 100}%)`; 
  document.getElementById('btn-form-fuel').classList.toggle('active', type === 'fuel'); document.getElementById('btn-form-maint').classList.toggle('active', type === 'maintenance'); 
  document.getElementById('form-area-fuel').style.display = type === 'fuel' ? 'block' : 'none'; document.getElementById('form-area-maint').style.display = type === 'maintenance' ? 'block' : 'none';
  
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = v && v.defaultFuel === 'electric';

  if (type === 'fuel') {
    document.getElementById('vr-fuel-type').parentElement.style.display = isEV ? 'none' : 'flex';
    document.getElementById('vr-discount').parentElement.style.display = isEV ? 'none' : 'flex';
    document.getElementById('vr-liters').parentElement.style.display = isEV ? 'none' : 'flex';
    document.getElementById('vr-price').parentElement.style.display = isEV ? 'none' : 'flex';
    
    document.getElementById('vr-prev-km').parentElement.querySelector('label').textContent = isEV ? '上次總量紀錄' : '上次里程 (km)';
    document.getElementById('vr-curr-km').parentElement.querySelector('label').textContent = isEV ? '現在總量紀錄' : '加油里程 (km)';
    
    const totalPanel = document.getElementById('vr-fuel-total-panel');
    if (totalPanel) {
      if (isEV) {
        totalPanel.innerHTML = `<div style="font-size:14px; font-weight:bold; color:var(--t1); margin-top:4px;">使用量： <span style="font-size:24px; color:var(--acc);" id="vr-ev-calc">0</span> <span style="font-size:14px; color:var(--t1);">(km)</span></div>`;
      } else {
        totalPanel.innerHTML = `<div style="font-size:12px; color:var(--t3);">折扣前總額：NT$ <span id="vr-before-total">0</span></div><div style="font-size:14px; font-weight:bold; color:var(--t1); margin-top:4px;">付款金額：<span style="font-size:24px; color:var(--acc);" id="vr-final-total">0</span></div>`;
      }
    }
  }

  if (type === 'maintenance') { 
    const items = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;
    document.getElementById('vm-items-container').innerHTML = items.map(item => `<div class="item-chip ${currentSelItems.includes(item) ? 'on' : ''}" onclick="toggleMaintItem(this, '${item}')">${item}</div>`).join(''); 
    renderShopHistory(); 
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

function confirmAddVehRec() {
  const checkImg = document.getElementById('veh-save-img'); const checkBtn = document.getElementById('veh-save-btn'); if (checkBtn.disabled) return; if (!S.selVehicleId) { toast('請先選擇車輛'); return; }
  let amount = 0; 
  if (S.addVehRecType === 'fuel') { 
    const finalTotalEl = document.getElementById('vr-final-total');
    if (finalTotalEl) {
      amount = pf(finalTotalEl.textContent.replace(/,/g,'')); 
      if (amount <= 0) { toast('金額不能為 0'); return; }
    } else {
      amount = 0; 
    }
  } else { 
    amount = pf(document.getElementById('vm-amount').value); 
    if (amount <= 0 || currentSelItems.length === 0) { toast('請選擇保養項目並輸入金額'); return; } 
  }

  checkBtn.disabled = true; 
  // 啟動 2 秒進度條動畫
  runSaveProgress(() => {
    const commonData = { id: editingVehRecId || newId(), vehicleId: S.selVehicleId, type: S.addVehRecType, date: document.getElementById('vr-date').value, time: document.getElementById('vr-time').value, amount: amount }; 
    let specificData = {};
    if (S.addVehRecType === 'fuel') { specificData = { fuelType: document.getElementById('vr-fuel-type') ? document.getElementById('vr-fuel-type').value : 'electric', discount: pf(document.getElementById('vr-discount')?document.getElementById('vr-discount').value:0), prevKm: pf(document.getElementById('vr-prev-km').value), km: pf(document.getElementById('vr-curr-km').value), liters: pf(document.getElementById('vr-liters')?document.getElementById('vr-liters').value:0), price: pf(document.getElementById('vr-price')?document.getElementById('vr-price').value:0) }; } 
    else { const shop = document.getElementById('vm-shop').value.trim(); if (shop && !S.settings.shopHistory.includes(shop)) { S.settings.shopHistory.push(shop); saveSettings(); } specificData = { km: pf(document.getElementById('vm-km').value), items: currentSelItems, shop: shop, payMethod: document.getElementById('vm-pay-method').value, note: document.getElementById('vm-note').value }; }
    
    const finalRec = { ...commonData, ...specificData }; 
    if (editingVehRecId) { const idx = S.vehicleRecs.findIndex(r => r.id === editingVehRecId); if (idx >= 0) S.vehicleRecs[idx] = finalRec; toast('✅ 記錄已更新'); } 
    else { S.vehicleRecs.push(finalRec); toast('✅ 記錄已新增'); }
    
    editingVehRecId = null; 
    saveVehicleRecs(); 
    checkBtn.disabled = false; 
    closeOverlay('veh-rec-add-page'); 
    renderVehicles();
  });
}

async function deleteVehRecFromEdit() { const ok = await customConfirm('確定刪除此記錄嗎？<br><strong>此動作無法復原。</strong>'); if(!ok) return; S.vehicleRecs = S.vehicleRecs.filter(r => r.id !== editingVehRecId); saveVehicleRecs(); closeOverlay('veh-rec-add-page'); toast('✅ 記錄已刪除'); renderVehicles(); }

function openAddVehicle() {
  S.newVehIcon = 4; S.newVehColor = '#555555'; const container = document.getElementById('vehicle-add-body');
  let iconsHtml = '<div class="veh-icon-grid">'; for (let i = 4; i <= 14; i++) { iconsHtml += `<div id="veh-icon-box-${i}" onclick="selectNewVehIcon(${i})" class="veh-icon-box"><div id="veh-icon-mask-${i}" class="scooter-mask" style="background-color:#ccc; -webkit-mask-image: url('images/scooter${i}.png');"></div></div>`; } iconsHtml += '</div>';
  container.innerHTML = `<div class="fg" style="margin-bottom:14px"><label>車輛名稱</label><input type="text" class="finp" id="v-name" placeholder="例如：我的愛車 Gogoro"></div><div class="fg" style="margin-bottom:14px"><label>自訂圖示顏色</label><div style="display:flex;gap:8px"><input type="color" id="v-color" value="${S.newVehColor}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px"><input type="text" class="finp" value="${S.newVehColor}" readonly style="flex:1"></div></div><div class="fg" style="margin-bottom:14px"><label>選擇機車圖示</label>${iconsHtml}</div><div class="fg" style="margin-bottom:20px"><label>預設燃料</label><select class="fsel" id="v-fuel"><option value="92" selected>92 無鉛汽油</option><option value="95">95 無鉛汽油</option><option value="98">98 無鉛汽油</option><option value="electric">電力 (電動車)</option></select></div><div style="display:flex;gap:10px;"><button onclick="closeOverlay('vehicle-add-page')" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-weight:600;cursor:pointer;">取消</button><button onclick="saveNewVehicle()" class="btn-acc" style="flex:2;padding:12px;font-weight:700;border-radius:var(--rs)">確認新增</button></div>`;
  document.getElementById('v-color').addEventListener('input', (e) => { S.newVehColor = e.target.value; updateVehIconUI(); }); updateVehIconUI(); openOverlay('vehicle-add-page');
}

function selectNewVehIcon(id) { S.newVehIcon = id; updateVehIconUI(); }
function updateVehIconUI() { for (let i = 4; i <= 14; i++) { const box = document.getElementById(`veh-icon-box-${i}`); const mask = document.getElementById(`veh-icon-mask-${i}`); if (!box || !mask) continue; if (i === S.newVehIcon) { box.style.borderColor = 'var(--acc)'; mask.style.backgroundColor = S.newVehColor; } else { box.style.borderColor = 'transparent'; mask.style.backgroundColor = '#ccc'; } } }
function saveNewVehicle() { const name = document.getElementById('v-name').value.trim(); if (!name) { toast('請輸入車輛名稱'); return; } const fuel = document.getElementById('v-fuel').value; S.vehicles.push({ id: newId(), name: name, icon: S.newVehIcon, color: S.newVehColor, defaultFuel: fuel }); saveVehicles(); closeOverlay('vehicle-add-page'); toast('✅ 成功新增車輛！'); renderVehicles(); }

let currentSelItems = []; function toggleMaintItem(el, item) { el.classList.toggle('on'); if (currentSelItems.includes(item)) { currentSelItems = currentSelItems.filter(i => i !== item); } else { currentSelItems.push(item); } }
function renderShopHistory() { if (!S.settings.shopHistory) S.settings.shopHistory = []; document.getElementById('shop-history-container').innerHTML = S.settings.shopHistory.map((shop, i) => `<div class="shop-chip"><span onclick="document.getElementById('vm-shop').value='${shop}'">${shop}</span><span class="shop-chip-del" onclick="deleteShopHistory(${i})">✕</span></div>`).join(''); }
function deleteShopHistory(index) { S.settings.shopHistory.splice(index, 1); saveSettings(); renderShopHistory(); }
/* ══ 6. 車輛管理 結束 ══════════════════════════════════════════ */

/* ══ 7. 設定管理與啟動 ═══════════════════════════════════ */
function renderSettings() {
  const html  = `
  <div class="set-sec"><h3>功能設定</h3><div class="set-list">
    <div class="set-row" onclick="openPlatformList()"><span class="sn">🏪 平台列表與設定</span><span class="arr">›</span></div>
    <div class="set-row" onclick="openGoalSettings()"><span class="sn">🎯 收入目標設定</span><span class="arr">›</span></div>
    <div class="set-row" onclick="openRewardSettings()"><span class="sn">🎁 獎勵項目設定</span><span class="arr">›</span></div>
    <div class="set-row" onclick="openBackgroundSettings()"><span class="sn">🎨 更換背景主題</span><span class="arr">›</span></div>
  </div></div>

  <div class="set-sec"><h3>資料管理</h3><div class="set-list">
      <div class="set-row" onclick="doBackup()"><span class="sn">📥 備份資料（JSON）</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doRestore()"><span class="sn">📤 還原備份</span><span class="arr">↑</span></div>
      <div class="set-row" onclick="doExportCSV()"><span class="sn">📊 匯出試算表（CSV）</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doClearData()"><span class="sn" style="color:var(--red)">🗑 清除所有資料</span><span class="arr" style="color:var(--red)">!</span></div>
      <div class="set-row" onclick="doReset()"><span class="sn" style="color:var(--red); font-weight:700;">⚠️ 重置設定和資料</span><span class="arr" style="color:var(--red)">!</span></div>
  </div></div>
  <div style="margin-top:24px; padding-bottom:16px; text-align:center;">
      <span onclick="openOverlay('about-page')" style="font-size:13px; color:var(--blue); font-weight:600; cursor:pointer; padding:8px 16px; display:inline-block;">關於我們</span>
  </div>`;
  document.getElementById('settings-content').innerHTML = html;
}

/* ══ 獎勵項目設定彈窗 ══ */
function openRewardSettings() {
  document.getElementById('sub-title').textContent = '獎勵項目設定';
  let html = `<div class="set-list" style="margin-bottom:16px;">`;
  if (!S.settings.rewards || S.settings.rewards.length === 0) {
    html += `<div style="padding:16px; text-align:center; color:var(--t3); font-size:13px;">目前無設定任何獎勵</div>`;
  } else {
    S.settings.rewards.forEach((r,i) => {
      html += `<div class="set-row"><span class="sn"><div>${r.name}</div><div class="sn-sub">${getPlatform(r.platformId).name}　≥${r.minOrders}單　NT$ ${fmt(r.amount)}</div></span><button onclick="event.stopPropagation();deleteReward(${i});openRewardSettings()" class="del-btn">✕</button></div>`;
    });
  }
  html += `</div>`;
  html += `<button onclick="openAddReward()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:700;border-radius:var(--rs);box-shadow:0 4px 12px rgba(255,107,53,0.3);">➕ 新增獎勵項目</button>`;
  
  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');
}

/* ══ 更換背景設定彈窗 ══ */
function openBackgroundSettings() {
  document.getElementById('sub-title').textContent = '更換背景主題';
  const bgs =[
    { id: '', name: '預設 (隨分頁切換)', type: 'color', val: '' },
    { id: '#fafafa', name: '淺色主題', type: 'color', val: '#f9f9f9' },
    { id: '#999999', name: '深色主題', type: 'color', val: '#25252a' },
    { id: 'background/bg1.jpg', name: '背景圖片 1', type: 'image', val: 'background/bg1.jpg' },
    { id: 'background/bg2.jpg', name: '背景圖片 2', type: 'image', val: 'background/bg2.jpg' },
    { id: 'background/bg3.jpg', name: '背景圖片 3', type: 'image', val: 'background/bg3.jpg' }
  ];
  
  let html = `<div style="display:flex; flex-direction:column; gap:12px;">`;
  bgs.forEach(b => {
    const isSelected = (S.settings.bg || '') === b.id;
    let preview = '';
    if (b.type === 'color') {
      preview = `<div style="width:36px;height:36px;border-radius:8px;background:${b.val || '#eee'};border:1px solid var(--border);"></div>`;
    } else {
      preview = `<div style="width:36px;height:36px;border-radius:8px;background:url('${b.val}') center/cover;border:1px solid var(--border);"></div>`;
    }
    
    html += `<div onclick="setBackground('${b.id}')" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;border:2px solid ${isSelected?'var(--acc)':'var(--border)'};background:var(--sf);cursor:pointer;box-shadow:${isSelected?'0 4px 12px rgba(255,107,53,0.2)':'none'};">
      ${preview}
      <span style="flex:1;font-size:14px;font-weight:600;color:${isSelected?'var(--acc)':'var(--t1)'}">${b.name}</span>
      ${isSelected ? `<span style="color:var(--acc);font-size:18px;font-weight:900;">✓</span>` : ''}
    </div>`;
  });
  html += `</div>`;
  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');
}

function setBackground(id) {
  S.settings.bg = id;
  saveSettings();
  applyBackground();
  openBackgroundSettings(); // 刷新打勾狀態
}

/* 替換 openPlatformList 函式，並加上 togglePlatform 函式 */
function openPlatformList() {
  document.getElementById('sub-title').textContent = '平台列表';
  document.getElementById('sub-body').innerHTML = `
    <div class="set-list">
      ${S.platforms.map(p => `
        <div class="set-row" onclick="openPlatformEdit('${p.id}')">
          <div class="plat-color-dot" style="background:${p.color}"></div>
          <div class="sn">
            <div style="font-weight:600">${p.name}</div>
            <div class="sn-sub">${p.active ? '✅ 已啟用' : '❌ 已停用'}</div>
          </div>
          <!-- 撥動開關 (stopPropagation 阻止點擊開關時進入編輯頁) -->
          <label class="switch" onclick="event.stopPropagation()">
            <input type="checkbox" ${p.active ? 'checked' : ''} onchange="togglePlatform('${p.id}', this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      `).join('')}
    </div>
    <div style="margin-top:12px; font-size:11px; color:var(--t3); text-align:center;">
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
  document.getElementById('sub-body').innerHTML = `<div style="margin-bottom:16px; padding:12px; background:var(--sf2); border-radius:var(--rs); font-size:12px; color:var(--t2); line-height:1.6;"><strong>📝 結算與發薪規則：</strong><br>${p.ruleDesc ? p.ruleDesc.replace(/｜/g, '<br>') : ''}</div><div class="fg" style="margin-bottom:16px"><label>自訂平台顏色</label><div style="display:flex;gap:8px"><input type="color" id="sp-color-pick" value="${p.color}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px"><input type="text" class="finp" id="sp-color" value="${p.color}" style="flex:1"></div></div><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding:12px;background:var(--sf2);border-radius:var(--rs)"><label style="font-size:14px;font-weight:600;flex:1;cursor:pointer" for="sp-active">啟用此平台</label><input type="checkbox" id="sp-active" ${p.active?'checked':''} style="width:20px;height:20px;cursor:pointer"></div><div style="display:flex;gap:8px"><button onclick="openPlatformList()" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-size:14px;font-weight:600;cursor:pointer;">返回列表</button><button onclick="savePlatformEdit('${id}')" class="btn-acc" style="flex:2;padding:12px;font-size:14px;font-weight:700;border-radius:var(--rs)">儲存設定</button></div>`;
  document.getElementById('sp-color-pick').addEventListener('input', e => { document.getElementById('sp-color').value = e.target.value; });
}

function savePlatformEdit(id) { const p = S.platforms.find(x=>x.id===id); if (!p) return; p.color = document.getElementById('sp-color').value.trim() || p.color; p.active = document.getElementById('sp-active').checked; savePlatforms(); toast('✅ 平台已更新'); if (S.tab === 'home') renderHome(); renderSettings(); openPlatformList(); }
function openGoalSettings() { 
  document.getElementById('sub-title').textContent = '目標設定'; 
  document.getElementById('sub-add-btn')?.style.setProperty('display', 'none'); 
  const g = S.settings.goals || {}; 
  
  // 檢查是否為 0，若是則輸出空字串，透過 placeholder 提示，移除預設 0 的困擾
  const wVal = g.weekly > 0 ? g.weekly : '';
  const mVal = g.monthly > 0 ? g.monthly : '';
  const yVal = g.yearly > 0 ? g.yearly : '';

  // 美化版面配置
  document.getElementById('sub-body').innerHTML = `
    <div style="background:var(--sf2); padding:16px; border-radius:12px; margin-bottom:20px;">
      <div style="font-size:12px; color:var(--t2); line-height:1.6; font-weight:600;">
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
function openAddReward() { document.getElementById('sub-title').textContent = '新增獎勵項目'; document.getElementById('sub-add-btn')?.style.setProperty('display', 'none'); const platOpts = S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}">${p.name}</option>`).join(''); document.getElementById('sub-body').innerHTML = `<div class="fg" style="margin-bottom:10px"><label>獎勵名稱</label><input type="text" class="finp" id="rw-name" placeholder="例：週末衝單獎勵"></div><div class="fg" style="margin-bottom:10px"><label>適用平台</label><select class="fsel" id="rw-plat">${platOpts}</select></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px"><div class="fg"><label>最低單數</label><input type="number" class="finp" id="rw-min" value="0" inputmode="numeric"></div><div class="fg"><label>上限單數（0=無限）</label><input type="number" class="finp" id="rw-max" value="0" inputmode="numeric"></div></div><div class="fg" style="margin-bottom:14px"><label>獎勵金額（NT$）</label><input type="number" class="finp" id="rw-amt" value="0" inputmode="decimal"></div><button onclick="saveNewReward()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">新增獎勵</button>`; openOverlay('sub-page'); }
function saveNewReward() { const name = document.getElementById('rw-name').value.trim(); if (!name) { toast('請輸入獎勵名稱'); return; } if (!S.settings.rewards) S.settings.rewards=[]; S.settings.rewards.push({ id: newId(), name, platformId: document.getElementById('rw-plat').value, minOrders: pf(document.getElementById('rw-min').value), maxOrders: pf(document.getElementById('rw-max').value), amount: pf(document.getElementById('rw-amt').value) }); saveSettings(); closeOverlay('sub-page'); renderSettings(); toast('✅ 獎勵已新增'); }
async function deleteReward(i) { const ok = await customConfirm(`確定刪除「${S.settings.rewards[i]?.name}」？`); if (!ok) return; S.settings.rewards.splice(i,1); saveSettings(); renderSettings(); toast('已刪除'); }

function doBackup() { const data = { exportedAt:new Date().toISOString(), records:S.records, platforms:S.platforms, settings:S.settings, vehicles:S.vehicles, vehicleRecs:S.vehicleRecs }; const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `外送記帳_${todayStr()}.json`; a.click(); URL.revokeObjectURL(url); toast('✅ 備份完成'); }
function doRestore() { const fi = document.getElementById('restore-file'); fi.onchange = async () => { const file = fi.files[0]; if(!file) return; try { const text = await file.text(); const data = JSON.parse(text); const ok = await customConfirm('確定用此備份<strong>覆蓋</strong>現有資料？'); if (!ok) return; if (data.records) { S.records=data.records; saveRecords(); } if (data.platforms) { S.platforms=data.platforms; savePlatforms(); } if (data.settings) { S.settings=data.settings; saveSettings(); } if (data.vehicles) { S.vehicles=data.vehicles; saveVehicles(); } if (data.vehicleRecs) { S.vehicleRecs=data.vehicleRecs; saveVehicleRecs(); } toast('✅ 還原成功'); renderSettings(); renderHome(); } catch { toast('❌ 檔案格式錯誤'); } fi.value=''; }; fi.click(); }
function doExportCSV() { const headers =['日期','平台','接單數','里程','行程收入','固定獎勵','臨時獎勵','小費','總收入','工時','上線','下線','備註']; const rows = S.records.map(r=>{ const p = getPlatform(r.platformId); return[r.date, p.name, r.orders||0, r.mileage||0, r.income||0, r.bonus||0, r.tempBonus||0, r.tips||0, recTotal(r), r.hours||0, r.punchIn||'', r.punchOut||'', r.note||''].join(','); }); const csv =[headers.join(','), ...rows].join('\n'); const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`外送記帳_${todayStr()}.csv`; a.click(); URL.revokeObjectURL(url); toast('✅ CSV 匯出完成'); }

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

/* ══ 關於我們：彈窗內容渲染函式 ══ */
function openSpecialThanks() {
  document.getElementById('sub-title').textContent = '特別致謝';
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px 8px; font-size:14px; color:var(--t1); line-height:1.6;">
      <p style="margin-bottom:16px; font-weight:500;">💡 特別感謝 XXX 提供的功能想法與建議，讓這個 APP 變得更好用！</p>
      <a href="https://www.facebook.com/share/1LjsAm2Afv/" target="_blank" style="display:flex; align-items:center; justify-content:center; gap:8px; padding:12px 16px; background:var(--blue-d); color:var(--blue); text-decoration:none; border-radius:12px; font-weight:700;">
        前往 Facebook 貼文連結
      </a>
    </div>
  `;
  // 動態提高 sub-page 的 z-index，使其能完美覆蓋在 about-page 之上
  document.getElementById('sub-page').style.zIndex = '1100';
  openOverlay('sub-page');
}

function openPrivacyPolicy() {
  document.getElementById('sub-title').textContent = '隱私權政策';
  document.getElementById('sub-body').innerHTML = `
    <div style="font-size:13px; color:var(--t1); line-height:1.8; padding:8px 4px;">
      <strong style="color:var(--acc); font-size:15px;">1. 我們收集的資訊</strong><br>
      • 基本帳號資料（如電子郵件、使用者名稱）<br>
      • 使用過程產生的操作紀錄與偏好設定<br>
      • 必要的裝置資訊（如系統版本、錯誤紀錄），用於改善服務<br><br>

      <strong style="color:var(--acc); font-size:15px;">2. 我們如何使用資訊</strong><br>
      • 提供並維護 APP 功能<br>
      • 改善使用體驗與修正錯誤<br>
      • 推送通知或必要的服務訊息<br><br>

      <strong style="color:var(--acc); font-size:15px;">3. 資訊分享</strong><br>
      • 我們不會出售您的個人資料<br>
      • 僅在法律要求或必要合作（如雲端服務供應商）時才會分享<br><br>

      <strong style="color:var(--acc); font-size:15px;">4. 資料安全</strong><br>
      • 使用加密技術保護您的資訊<br>
      • 僅授權人員可存取相關資料<br><br>

      <strong style="color:var(--acc); font-size:15px;">5. 您的權利</strong><br>
      • 您可隨時查詢、更正或刪除個人資料<br>
      • 您可聯繫我們停止使用或刪除帳號<br><br>

      <strong style="color:var(--acc); font-size:15px;">6. 聯絡方式</strong><br>
      如有任何隱私問題，請透過 APP 內「聯絡我們」功能與我們聯繫。
      <div style="height:32px;"></div>
    </div>
  `;
  // 動態提高 sub-page 的 z-index，使其能完美覆蓋在 about-page 之上
  document.getElementById('sub-page').style.zIndex = '1100';
  openOverlay('sub-page');
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

/* ══ 自動抓取中油歷史油價網頁資料 (支援快取記憶防阻擋) ══ */
let cachedGasPrices = null; // 用來記憶本次開啟 APP 時抓到的油價

async function fetchAutoGasPrice() {
  const fuelType = document.getElementById('vr-fuel-type');
  if (!fuelType || fuelType.value === 'electric') return;
  
  if (cachedGasPrices) {
    applyGasPrice(fuelType.value);
    return;
  }

  // 替換原本的 toast 為全新進度條動畫
  showProgress('油價載入中...');

  try {
    const cpcUrl = encodeURIComponent('https://www.cpc.com.tw/historyprice.aspx?n=2890');
    let htmlText = '';
    
    try {
      const res1 = await fetch(`https://api.allorigins.win/raw?url=${cpcUrl}`);
      if (!res1.ok) throw new Error('Proxy 1 failed');
      htmlText = await res1.text();
    } catch (e1) {
      const res2 = await fetch(`https://api.codetabs.com/v1/proxy?quest=${cpcUrl}`);
      if (!res2.ok) throw new Error('Proxy 2 failed');
      htmlText = await res2.text();
    }
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const tables = doc.querySelectorAll('table');
    let dataRow = null;
    
    for (let t of tables) {
      const rows = t.querySelectorAll('tr');
      for (let r of rows) {
        const tds = r.querySelectorAll('td');
        if (tds.length >= 5) {
          const firstTd = tds[0].textContent.trim();
          if (firstTd.includes('/')) { dataRow = r; break; }
        }
      }
      if (dataRow) break;
    }
    
    if (!dataRow) throw new Error('找不到中油油價資料表');
    
    const tds = dataRow.querySelectorAll('td');
    cachedGasPrices = {
      '92': parseFloat(tds[1].textContent.trim()),
      '95': parseFloat(tds[2].textContent.trim()),
      '98': parseFloat(tds[3].textContent.trim()),
      '柴油': parseFloat(tds[4].textContent.trim())
    };
    
    // 取代原本的 applyGasPrice()，包在進度完成事件中
    finishProgress(() => { applyGasPrice(fuelType.value); });

  } catch(e) {
    console.error('取得油價失敗:', e);
    // 失敗時也要確實關閉進度條
    finishProgress(() => { toast('⚠️ 抓取油價失敗，請手動輸入'); });
  }
}

// 獨立拉出的填入油價函式
function applyGasPrice(typeStr) {
  if (!cachedGasPrices) return;
  const price = cachedGasPrices[typeStr];
  if (price > 0 && !isNaN(price)) {
    document.getElementById('vr-price').value = price;
    calcVehFuel(); // 觸發總額重算
    toast(`✅ 已載入最新牌價：$${price}`);
  } else {
    toast('⚠️ 抓取油價失敗，請手動輸入');
  }
}

/* ══ 全部功能都開發完畢，準備正式上線時，再把這段程式碼改回原本的「註冊」代碼，並把 sw.js 的版本號加 1 ═══════════════════════════════════ */
/* if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').then(r=>console.log('SW 已註冊')).catch(e=>console.log('SW 註冊失敗')); }); } */
/* 開發測試用：強制註銷所有 Service Worker，避免快取舊檔案 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
    }
  });
  console.log('SW 已強制註銷，目前不會快取檔案。');
}

/* ══ 背景主題套用函式 ══ */
function applyBackground() {
  const bg = S.settings.bg;
  const root = document.documentElement;
  if (bg) {
    if (bg.startsWith('#')) {
      document.body.style.background = bg;
      root.style.setProperty('--bg-header', bg + 'EE'); // 加入微透明度供毛玻璃使用
    } else {
      document.body.style.background = `url('${bg}') center/cover fixed no-repeat`;
      root.style.setProperty('--bg-header', 'rgba(255, 255, 255, 0.7)'); // 圖片底圖時用白色透光
    }
  } else {
    document.body.style.background = ''; // 恢復 CSS 預設
    root.style.setProperty('--bg-header', 'var(--bg)');
  }
}

function init() {
  loadAll();
  applyBackground(); // <-- 在初始化時套用背景
  if (!S.platforms || !S.platforms.length) {
    S.platforms = DEFAULT_PLATFORMS.map(p=>({...p}));
    savePlatforms();
  }
  S.tab = 'home';
  document.body.setAttribute('data-tab', 'home');
  document.querySelectorAll('.ni[data-pg]').forEach(n => {
    const isActive = n.dataset.pg === 'home';
    n.classList.toggle('active', isActive);
    const img = n.querySelector('.ni-img');
    if (img) img.src = isActive ? n.dataset.img2 : n.dataset.img1;
  });
  renderHome();
}
init();
/* ══ 7. 設定管理與啟動 結束 ═══════════════════════════════════ */
