/* ══════════════════════════════════════════════════════
   外送記帳 App — script.js
   設計：由上到下分區註解，結構清晰，不閃爍，功能完整
   ══════════════════════════════════════════════════════ */

/* ══ 1. 共用工具函式與狀態 開始 ══════════════════════════════ */
const KEYS = { records: 'delivery_records', platforms: 'delivery_platforms', settings: 'delivery_settings', punch: 'delivery_punch_live', vehicles: 'delivery_vehicles', vehicleRecs: 'delivery_vehicle_recs' };
const DEFAULT_PLATFORMS = [
  { id:'uber', name:'Uber Eats', color:'#008000', active:false, ruleDesc:'每週一、四結算｜每週四發薪' },
  { id:'foodpanda', name:'foodpanda', color:'#D70F64', active:false, ruleDesc:'雙週日結算｜雙週三明細｜雙週三發薪' },
  { id:'foodomo', name:'foodomo', color:'#ff0000', active:false, ruleDesc:'每月15及月底結算｜每月5及20發薪' },
];
const DEFAULT_SETTINGS = { goals: { weekly: 0, monthly: 0 }, rewards: [], shopHistory: [] };

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
const recTotal = r => pf(r.income)+pf(r.bonus)+pf(r.tempBonus)+pf(r.tips);

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

// 替換：改回動態計算高度 scrollHeight，這樣不管是首頁單行，還是分析頁的大卡片，都能完美展開不會被切斷
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

function buildSummaryCard(title, total, orders, hours, bonus, tempBonus, tips, cardId) {
  if (total <= 0) return '';
  const totalBonus = bonus + tempBonus; 
  let tags = '';
  if (totalBonus > 0) tags += `<span class="lbl-bonus" style="margin-right:4px;">獎勵 $${fmt(totalBonus)}</span>`;
  if (tips > 0) tags += `<span class="lbl-tips">小費 $${fmt(tips)}</span>`;

  const avgPerOrder = orders > 0 ? Math.round(total / orders) : 0;
  const avgPerHour = hours > 0 ? Math.round(total / hours) : 0;
  const ordersPerHour = hours > 0 ? (orders / hours).toFixed(1) : 0;

  return `
    <div class="summary-card" style="margin:2px; padding:4px 2px;">
      <div class="sum-top" onclick="toggleSummaryCard('${cardId}')" style="position:relative; display:flex; align-items:center; padding:2px;">
        <div style="flex:1.2; display:flex; flex-direction:column; justify-content:center;">
          <div style="display:flex; align-items:baseline; gap:6px;">
            <span style="font-size:14px; font-weight:700; color:var(--t1);">${title}</span>
            <span style="font-family:var(--mono); font-size:24px; font-weight:800; color:var(--green);">$${fmt(total)}</span>
          </div>
        </div>
        <div class="sum-v-divider"></div>
        <div style="flex:0.6; text-align:center; font-size:13px; font-weight:700; color:var(--t2);">${orders > 0 ? fmt(orders) : '0'} 單</div>
        <div class="sum-v-divider"></div>
        <div style="flex:1.2; padding-left:10px; display:flex; flex-direction:column; justify-content:center; position:relative;">
          <div style="font-size:13px; font-weight:700; color:var(--t2); margin-bottom:${tags ? '4px' : '0'};">${hours > 0 ? fmtHours(hours) : '0m'}</div>
          ${tags ? `<div style="display:flex; align-items:center; flex-wrap:wrap;">${tags}</div>` : ''}
          <div id="${cardId}-btn" class="sum-toggle-btn" style="position:absolute; right:8px; top:50%; transform:translateY(-50%) rotate(0deg);">▼</div>
        </div>
      </div>
      <div id="${cardId}" class="summary-collapse" style="max-height:0px; overflow:hidden; transition: max-height 0.3s ease;">
        <div style="border-top:1px dashed rgba(0,0,0,0.1); margin:6px 0;"></div>
        <div style="text-align:center; font-size:12px; font-weight:500; color:var(--red); padding:4px 0;">
          平均：<span style="font-family:var(--mono); color:var(--blue); font-size:13px; font-weight:800;">$${fmt(avgPerOrder)}</span> /單
          <span style="color:rgba(0,0,0,0.1); margin:0 6px;">│</span>
          效率：<span style="font-family:var(--mono); color:var(--blue); font-size:13px; font-weight:800;">${ordersPerHour}</span> 單/時
          <span style="color:rgba(0,0,0,0.1); margin:0 6px;">│</span>
          時薪：<span style="font-family:var(--mono); color:var(--blue); font-size:13px; font-weight:800;">$${fmt(avgPerHour)}</span> /時
        </div>
      </div>
    </div>`;
}

function loadAll() {
  try { S.records = JSON.parse(localStorage.getItem(KEYS.records)||'[]'); } catch { S.records=[]; }
  try { const saved = JSON.parse(localStorage.getItem(KEYS.platforms)||'[]'); S.platforms = DEFAULT_PLATFORMS.map(dp => { const sp = saved.find(x => x.id === dp.id); return sp ? { ...dp, color: sp.color, active: sp.active } : { ...dp }; }); } catch { S.platforms = DEFAULT_PLATFORMS.map(p=>({...p})); }
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
    const today = todayStr(); const dayRecs = getDayRecs(today) || [];
    const total = dayRecs.reduce((s,r)=>s+recTotal(r), 0); const orders = dayRecs.reduce((s,r)=>s+pf(r.orders), 0);
    const hours = dayRecs.filter(r => !r.isPunchOnly).reduce((s,r)=>s+pf(r.hours), 0);     
    const dateObj = new Date(today+'T00:00:00'); const dow = ['日','一','二','三','四','五','六'][dateObj.getDay() || 0];
    const activePlatforms = (S.platforms || []).filter(p=>p.active);
    const platStats = activePlatforms.map(p => {
      const recs = dayRecs.filter(r => r.platformId === p.id);
      return { ...p, sum: recs.reduce((s, r) => s + recTotal(r), 0), orders: recs.reduce((s, r) => s + pf(r.orders), 0), hours: recs.reduce((s, r) => s + pf(r.hours), 0) };
    }).filter(p => p.sum > 0 || p.orders > 0 || p.hours > 0);

    // 加上內聯樣式 padding:16px 16px 0 保證即使 CSS 遺漏也不會被頂部切掉
    let topHtml = `<div style="padding:16px 16px 0; flex-shrink:0;"><div class="home-header" style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px;"><div class="home-pg-title" style="font-family:var(--title); font-size:24px; font-weight:800; color:var(--t1); line-height:1.2;">今日概況</div><div class="home-pg-date" style="font-size:13px; color:var(--t2); font-weight:500; background:var(--sf); padding:6px 12px; border-radius:20px; border:1px solid var(--border); box-shadow:0 2px 6px rgba(0,0,0,0.03);"><b>${dateObj.getFullYear()}</b> 年 <b>${dateObj.getMonth()+1}</b> 月 <b>${dateObj.getDate()}</b> 日 星期 <b>${dow}</b></div></div><div class="today-hero">`;
    
    if (platStats.length > 0) { topHtml += `<div class="hero-plat-list" style="display:flex; flex-direction:column; gap:4px;">`; platStats.forEach(p => { topHtml += `<div class="hero-plat-row" style="display:flex; align-items:center; padding:8px 14px; border-radius:12px; font-size:13px; font-weight:600; background:${p.color}15; border: 1px solid ${p.color}60; color: ${p.color};"><span class="hp-name" style="width:35%; white-space:nowrap;">${p.name}收入：</span><span class="hp-sum" style="font-family:var(--mono); font-weight:800; width:25%; text-align:right;">$ ${fmt(p.sum)}</span><span class="hp-ord" style="font-weight:600; width:20%; text-align:right;">${p.orders} 單</span><span class="hp-hrs" style="font-weight:600; width:20%; text-align:right; opacity:0.8;">${p.hours > 0 ? fmtHours(p.hours) : 0}</span></div>`; }); topHtml += `</div>`; } 
    else { topHtml += `<div style="text-align:center; font-size:13px; color:var(--t3); margin:12px 0;">今日尚未有收入資料</div>`; }

    const dayBonus = dayRecs.reduce((s,r)=>s+pf(r.bonus), 0); const dayTemp = dayRecs.reduce((s,r)=>s+pf(r.tempBonus), 0); const dayTips = dayRecs.reduce((s,r)=>s+pf(r.tips), 0);
    topHtml += buildSummaryCard('總計', total, orders, hours, dayBonus, dayTemp, dayTips, 'home-summary-card'); topHtml += `</div>`;

    const isPunched = S.punch && S.punch.date === today; let punchStatusStr = '離線';
    if (isPunched && S.punch && typeof S.punch.startTime === 'string') { 
      const startParts = S.punch.startTime.split(':');
      if(startParts.length >= 2) {
        const startMs = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), parseInt(startParts[0]||0), parseInt(startParts[1]||0)).getTime(); 
        const diffMin = Math.floor((Date.now() - startMs) / 60000); 
        punchStatusStr = `上線中 (${Math.floor(diffMin/60)}h${diffMin%60}m)`; 
      }
    }
    topHtml += `<div class="punch-card-new" style="background:linear-gradient(145deg, #ffffff, #f9fafb); border:1px solid #f3f4f6; border-radius:20px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; margin:8px 0; box-shadow:0 8px 20px rgba(0,0,0,0.03);"><div class="punch-status-left" style="display:flex; align-items:center; gap:10px; font-size:15px; font-weight:700;"><div class="punch-dot-new ${isPunched ? 'online' : ''}"></div><span style="color:${isPunched ? 'var(--green)' : 'var(--t2)'}">${punchStatusStr}</span></div><button class="punch-btn-right ${isPunched ? 'btn-go-offline' : 'btn-go-online'}" onclick="${isPunched ? 'punchOut()' : 'punchIn()'}">${isPunched ? '⏹ 下線打卡' : '▶ 上線打卡'}</button></div></div>`;

    if (!S.homeSubTab) S.homeSubTab = 'schedule'; let bottomHtml = ``;
    if (S.homeSubTab === 'schedule') {
      const todayObj = new Date(); todayObj.setHours(0,0,0,0);
      const calcNextDates = (id) => {
        const y = todayObj.getFullYear(), m = todayObj.getMonth(), d = todayObj.getDate(); const events = [];
        const addEvent = (name, dObj) => { const diff = Math.round((dObj - todayObj) / 86400000); events.push({ name: name, dateStr: `${dObj.getMonth()+1}/${pad(dObj.getDate())}`, diff: diff, diffStr: diff === 0 ? '今天' : `${diff} 天後`}); };
        const getNextDow = (targets) => { let cur = todayObj.getDay(); let add = 7; targets.forEach(t => { let diff = (t - cur + 7) % 7; if (diff < add) add = diff; }); let res = new Date(todayObj); res.setDate(d + add); return res; };
        if (id === 'uber') { addEvent('趟獎結算', getNextDow([1, 4])); addEvent('發薪日', getNextDow([4])); } 
        else if (id === 'foodpanda') { const getPandaNext = (aY, aM, aD) => { const anchor = new Date(aY, aM, aD); const diffDays = Math.floor((todayObj - anchor) / 86400000); const daysToAdd = (14 - (diffDays % 14)) % 14; let res = new Date(todayObj); res.setDate(d + daysToAdd); return res; }; addEvent('85% 取單率', getPandaNext(2020, 0, 12)); addEvent('明細寄發', getPandaNext(2020, 0, 15)); addEvent('發薪日', getPandaNext(2020, 0, 22)); } 
        else if (id === 'foodomo') { let nSettle = new Date(todayObj), nPay = new Date(todayObj); if (d <= 15) nSettle.setDate(15); else nSettle = new Date(y, m + 1, 0); if (d <= 5) nPay.setDate(5); else if (d <= 20) nPay.setDate(20); else nPay = new Date(y, m + 1, 5); addEvent('結算日', nSettle); addEvent('發薪日', nPay); } else return null;
        return events;
      };
      if (activePlatforms.length) {
        activePlatforms.forEach(p => {
          const events = calcNextDates(p.id); if (!events) return;
          bottomHtml += `<div style="border: 2px solid ${p.color}; background: ${p.color}15; border-radius: 22px; padding: 8px 10px; margin-bottom: 5px;"><div style="display:flex; align-items:center; gap:5px; margin-bottom: 5px;"><div style="width:10px; height:10px; border-radius:50%; background:${p.color}; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.95);"></div><span style="font-size:14px; font-weight:800; color:${p.color}; letter-spacing:0.5px;">${p.name}</span></div><div style="display:flex; gap:6px;">${events.map(ev => {
                  const isToday = ev.diff === 0; const dateColor = isToday ? 'var(--green)' : 'var(--t1)'; let diffColor = isToday ? 'var(--green)' : 'var(--t2)'; let nameColor = 'var(--t3)'; 
                  if (ev.name.includes('結算') || ev.name.includes('取單')) nameColor = 'var(--red)'; else if (ev.name.includes('明細')) nameColor = 'var(--acc)'; else if (ev.name.includes('發薪')) nameColor = 'var(--blue)';
                  if (!isToday && (ev.name.includes('結算') || ev.name.includes('發薪') || ev.name.includes('明細') || ev.name.includes('取單'))) { diffColor = '#22C55E'; }
                  return `<div style="flex:1; background: var(--sf); border: 1px solid var(--blue); border-radius: 16px; padding: 4px 4px; text-align: center; display:flex; flex-direction:column; justify-content:center;"><span style="font-size:11px; color:${nameColor}; font-weight:800; margin-bottom:2px; letter-spacing:0.5px;">${ev.name}</span><span style="font-family:var(--mono); font-size:13px; font-weight:800; color:${dateColor};">${ev.dateStr} <span style="font-size:13px; font-weight:600; color:${diffColor};">(${ev.diffStr})</span></span></div>`;
                }).join('')}</div></div>`;
        });
      } else { bottomHtml += `<div class="empty-tip">請先至「設定」頁，啟用平台</div>`; }
    } else if (S.homeSubTab === 'goal') {
      const goals = S.settings.goals || {}; // 安全防護，避免 goals 為 undefined 導致報錯中斷
      const weekly = pf(goals.weekly); const monthly = pf(goals.monthly);
      if (weekly > 0 || monthly > 0) {
        bottomHtml += `<div class="card" style="border: 2px solid var(--border);">`;
        if (weekly > 0) {
          const wDate = new Date(dateObj); const wDay = wDate.getDay() || 7; wDate.setDate(wDate.getDate() - wDay + 1); let weekTotal = 0;
          for(let i=0; i<7; i++) { const dStr = `${wDate.getFullYear()}-${pad(wDate.getMonth()+1)}-${pad(wDate.getDate())}`; weekTotal += getDayRecs(dStr).reduce((s,r)=>s+recTotal(r),0); wDate.setDate(wDate.getDate() + 1); }
          const wPct = Math.min(100, Math.round(weekTotal/weekly*100)); const wRemain = Math.max(0, weekly-weekTotal); const wColor = wPct >= 100 ? 'var(--green)' : wPct >= 70 ? 'var(--blue)' : 'var(--red)';
          bottomHtml += `<div style="margin-bottom: ${monthly>0 ? '16px' : '0'};"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">📊 本週目標進度</span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${wColor}">${wPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${wPct}%;background:${wColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(weekTotal)}</span><span>${wRemain>0?`還差 $ ${fmt(wRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        if (monthly > 0) {
          const monthRecs  = getMonthRecs(dateObj.getFullYear(), dateObj.getMonth()+1); const monthTotal = monthRecs.reduce((s,r)=>s+recTotal(r), 0);
          const mPct = Math.min(100, Math.round(monthTotal/monthly*100)); const mRemain = Math.max(0, monthly-monthTotal); const mColor = mPct >= 100 ? 'var(--green)' : mPct >= 70 ? 'var(--blue)' : 'var(--red)';
          bottomHtml += `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:var(--t2)">📈 本月目標進度</span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${mColor}">${mPct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${mPct}%;background:${mColor}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;"><span>已達 $ ${fmt(monthTotal)}</span><span>${mRemain>0?`還差 $ ${fmt(mRemain)}`:'🎉 已達標！'}</span></div></div>`;
        }
        bottomHtml += `</div>`;
      } else { bottomHtml += `<div class="empty-tip">請先至「設定」頁，設定目標</div>`; }
    }
    const topEl = document.getElementById('home-top-content'); const botEl = document.getElementById('home-bottom-content');
    if (topEl) topEl.innerHTML = topHtml; if (botEl) botEl.innerHTML = bottomHtml;
  } catch (error) {
    console.error("首頁渲染安全攔截：", error);
  }
}

function punchIn() { const today = todayStr(); S.punch = { date: today, startTime: nowTime() }; savePunch(); toast(`✅ 上線打卡：${S.punch.startTime}`); renderHome(); }
async function punchOut() {
  if (!S.punch) return; const ok = await customConfirm('<strong>【確認離線】</strong><br>確定要結束工作並下線嗎？'); if (!ok) return;
  const endTime = nowTime(); const startMs = new Date(`${S.punch.date}T${S.punch.startTime}`).getTime(); const endMs = new Date(`${S.punch.date}T${endTime}`).getTime(); const diffHours = Math.max(0, (endMs - startMs) / 3600000);
  const punchRecord = { id: newId(), date: S.punch.date, time: endTime, platformId: null, punchIn: S.punch.startTime, punchOut: endTime, hours: diffHours, isPunchOnly: true, note: '系統上下線記錄' };
  S.records.push(punchRecord); saveRecords(); S.punch = null; savePunch(); toast('✅ 已離線！時數已記錄至歷史中'); renderHome();
}
/* ══ 2. 首頁 結束 ══════════════════════════════════════════ */


/* ══ 3. 查看記錄 (包含精簡美化的卡片生成) 開始 ════════════════════ */
// 替換 foldCard 展開高度，一行文字只需約 40px 即可
function foldCard(id, e) {
  e.stopPropagation();
  const el = document.getElementById(id); const btn = document.getElementById(id + '-btn'); if (!el || !btn) return;
  if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { el.style.maxHeight = '45px'; btn.style.transform = 'rotate(180deg)'; } 
  else { el.style.maxHeight = '0px'; btn.style.transform = 'rotate(0deg)'; }
}

// 新增：日曆網格收起/展開功能
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

function buildRecItem(r) {
  const cid = `hrc-${r.id}`;
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
      <div class="hrc-top" onclick="openDetailOverlay('${r.id}')">
        <div class="hrc-toggle" id="${cid}-btn" onclick="foldCard('${cid}', event)">▼</div>
        <div class="hrc-row1">
          <span class="hrc-plat-tag" style="background:${plat.color};">${plat.name}</span>
          <span>${r.time||''}</span>
          ${r.note ? `<span class="h-div"></span><span style="color:var(--t3);"> ${r.note}</span>` : ''}
        </div>
        <div class="hrc-row2">
          <span class="hrc-amt">$${fmt(total)}</span>
          ${tagsHtml}
        </div>
      </div>
      <div id="${cid}" class="hrc-collapse" style="background:#f8fafc; text-align:center; font-size:12px; font-weight:600; color:var(--t2); overflow:hidden; transition:max-height 0.3s ease;">
        <div style="border-top:1px dashed #cbd5e1; margin-bottom:3px;"></div>
        <div style="text-align:center; font-size:12px; font-weight:500; color:var(--red); padding:4px 0;">
          平均：<span style="font-family:var(--mono); color:var(--blue); font-size:13px; font-weight:800;">$${fmt(avgOrd)}</span> /單
          <span style="color:rgba(0,0,0,0.1); margin:0 6px;">│</span>
          效率：<span style="font-family:var(--mono); color:var(--blue); font-size:13px; font-weight:800;">${ordHr}</span> 單/時
          <span style="color:rgba(0,0,0,0.1); margin:0 6px;">│</span>
          時薪：<span style="font-family:var(--mono); color:var(--blue); font-size:13px; font-weight:800;">$${fmt(avgHr)}</span> /時
        </div>
      </div>
    </div>`;
}

if (!S.histTab) S.histTab = 'day';
if (!S.histNavDate) S.histNavDate = new Date();
if (!S.histFilter) S.histFilter = 'all';

function navHistGroup(dir, mode) {
  let d = new Date(S.histNavDate);
  if (mode === 'week') d.setDate(d.getDate() + (dir * 7)); if (mode === 'biweek') d.setDate(d.getDate() + (dir * 14));
  if (mode === 'month') d.setMonth(d.getMonth() + dir); if (mode === 'year') d.setFullYear(d.getFullYear() + dir);
  S.histNavDate = d; renderHistory();
}
function changeHistFilter(val) { S.histFilter = val; renderHistory(); }

// 替換：根據不同的模式，決定捲動行為，確保整個頁面能順暢捲動
function renderHistory() { 
  const content = document.getElementById('hist-content');
  if (S.histTab === 'day') {
    content.style.overflowY = 'auto';
    content.style.overflowX = 'hidden';
    content.style.display = 'block';
    content.style.WebkitOverflowScrolling = 'touch';
    renderHistDayView(); 
  } else {
    content.style.overflowY = 'hidden';
    content.style.display = 'flex';
    renderHistGroupView(S.histTab); 
  }
}

// 替換：移除內部多餘的 overflow 限制，讓整個內容自然撐開往下滾
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

// 替換：同樣加上 min-height:0 確保群組檢視(週/月)也能滑動
function renderHistGroupView(mode) {
  const content = document.getElementById('hist-content'); const nd = new Date(S.histNavDate); let startD, endD, labelStr;
  if (mode === 'week') { const day = nd.getDay() || 7; startD = new Date(nd); startD.setDate(startD.getDate() - day + 1); endD = new Date(startD); endD.setDate(endD.getDate() + 6); labelStr = `${pad(startD.getMonth()+1)}/${pad(startD.getDate())} ~ ${pad(endD.getMonth()+1)}/${pad(endD.getDate())}`; } 
  else if (mode === 'biweek') { const anchor = new Date(2025, 10, 10); const diffTime = (new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), 12)).getTime() - anchor.getTime(); const diffDays = Math.floor(diffTime / 86400000); const cycleOffset = Math.floor(diffDays / 14); startD = new Date(anchor); startD.setDate(startD.getDate() + cycleOffset * 14); endD = new Date(startD); endD.setDate(endD.getDate() + 13); let yearPrefix = (startD.getFullYear() !== endD.getFullYear()) ? `${startD.getFullYear()}/` : ''; labelStr = `${yearPrefix}${pad(startD.getMonth()+1)}/${pad(startD.getDate())} ~ ${pad(endD.getMonth()+1)}/${pad(endD.getDate())}`; } 
  else if (mode === 'month') { startD = new Date(nd.getFullYear(), nd.getMonth(), 1); endD = new Date(nd.getFullYear(), nd.getMonth() + 1, 0); labelStr = `${nd.getFullYear()}年 ${nd.getMonth()+1}月`; } 
  else if (mode === 'year') { startD = new Date(nd.getFullYear(), 0, 1); endD = new Date(nd.getFullYear(), 11, 31); labelStr = `${nd.getFullYear()}年`; }

  const sStr = `${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}`; const eStr = `${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}`;
  let recs = S.records.filter(r => !r.isPunchOnly && r.date >= sStr && r.date <= eStr); if (S.histFilter !== 'all') recs = recs.filter(r => r.platformId === S.histFilter);
  let platOpts = `<option value="all">全部平台</option>` + S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}" ${S.histFilter===p.id?'selected':''}>${p.name}</option>`).join('');
  let html = `<div style="padding: 0 16px; flex-shrink:0;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);"><div style="display:flex; align-items:center; gap:8px;"><button class="mbtn" onclick="navHistGroup(-1, '${mode}')">◀</button><span style="font-family:var(--mono); font-size:14px; font-weight:700; width:125px; text-align:center; color:var(--acc); letter-spacing:0.5px;">${labelStr}</span><button class="mbtn" onclick="navHistGroup(1, '${mode}')">▶</button></div><select class="fsel" style="width:auto; padding:6px 10px; font-size:13px; font-weight:600;" onchange="changeHistFilter(this.value)">${platOpts}</select></div></div><div style="padding: 0 16px 24px; flex:1; overflow-y:auto; min-height:0; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:0;">`;
  
  if (recs.length === 0) { html += `<div class="empty-tip">沒有資料</div>`; } else {
    const tInc = recs.reduce((s,r) => s + recTotal(r), 0); const tOrd = recs.reduce((s,r) => s + pf(r.orders), 0); const tHrs = recs.reduce((s,r) => s + pf(r.hours), 0); const tBonus = recs.reduce((s,r) => s + pf(r.bonus), 0); const tTemp = recs.reduce((s,r) => s + pf(r.tempBonus), 0); const tTips = recs.reduce((s,r) => s + pf(r.tips), 0);
    html += buildSummaryCard('區間總計', tInc, tOrd, tHrs, tBonus, tTemp, tTips, 'hist-group-card');
    html += recs.sort((a,b)=>b.date.localeCompare(a.date) || (a.time||'').localeCompare(b.time||'')).map(r => buildRecItem(r)).join('');
  } html += `</div>`; content.innerHTML = html;
}

function openFullCalendar() { document.getElementById('full-calendar-overlay').classList.add('show'); renderFullCalendar(); }
function closeFullCalendar() { document.getElementById('full-calendar-overlay').classList.remove('show'); }
function changeFullCalMonth(offset) { S.calM += offset; if(S.calM < 1) { S.calM = 12; S.calY--; } if(S.calM > 12) { S.calM = 1; S.calY++; } renderFullCalendar(); S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); }
// 重構：全螢幕日曆的精美 UI 生成
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
    // 若有收入，加上專屬樣式類別，並顯示在右下角
    if(sum > 0) {
      cls += ' has-income';
      contentHtml += `<div class="fc-amt">${fmt(sum)}</div>`;
    }
    // 移除了 onclick 點選功能，只供觀看
    html += `<div class="${cls}">${contentHtml}</div>`;
  }
  const totalCells = first + days; const remain = totalCells % 7 === 0 ? 0 : (Math.ceil(totalCells/7)*7) - totalCells;
  for (let i=1; i<=remain; i++) { html += `<div class="fc-cell empty"><div class="fc-date">${pad(i)}</div></div>`; }
  grid.innerHTML = html;
}

function renderHistRecords(ds) {
  const d = new Date(ds+'T00:00:00'); const dow = ['日','一','二','三','四','五','六'][d.getDay()];
  document.getElementById('hist-day-label').textContent = `${d.getMonth()+1} 月 ${d.getDate()} 日（星期${dow}）記錄`;
  const recs = getDayRecs(ds); const total = recs.reduce((s,r)=>s+recTotal(r), 0); const sumEl = document.getElementById('hist-day-summary');
  if (total > 0) {
    const orders = recs.reduce((s,r)=>s+pf(r.orders), 0); const hours = recs.reduce((s,r)=>s+pf(r.hours), 0); const dayBonus = recs.reduce((s,r)=>s+pf(r.bonus), 0); const dayTemp = recs.reduce((s,r)=>s+pf(r.tempBonus), 0); const dayTips = recs.reduce((s,r)=>s+pf(r.tips), 0);
    sumEl.innerHTML = buildSummaryCard('當日', total, orders, hours, dayBonus, dayTemp, dayTips, 'hist-day-card');
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

function openSearch() { 
  openOverlay('search-page'); 
  setTimeout(() => { document.getElementById('search-kw').focus(); }, 350); 
}
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
  document.getElementById('f-date').value = record?.date || prefill.date || S.selDate || todayStr();
  let totalHours = pf(record?.hours || prefill.hours || 0); let h = Math.floor(totalHours); let m = Math.round((totalHours - h) * 60);
  document.getElementById('f-hrs-val').value = h > 0 ? h : ''; document.getElementById('f-min-val').value = m > 0 ? m : '';
  document.getElementById('f-orders').value = record?.orders || ''; 
  document.getElementById('f-mileage').value = record?.mileage || ''; // 新增里程
  document.getElementById('f-income').value = record?.income || '';
  document.getElementById('f-bonus').value = record?.bonus || ''; document.getElementById('f-temp-bonus').value = record?.tempBonus || '';
  document.getElementById('f-tips').value = record?.tips || ''; document.getElementById('f-note').value = record?.note || '';
  renderPlatformChips(); calcAddTotal(); goPage('add');
}
function renderPlatformChips() { const container = document.getElementById('platform-chips'); const active = S.platforms.filter(p=>p.active); if (!S.selPlatformId && active.length) S.selPlatformId = active[0].id; container.innerHTML = active.map(p => `<div class="platform-chip${S.selPlatformId===p.id?' on':''}" style="${S.selPlatformId===p.id?`background:${p.color};border-color:${p.color}`:''}" onclick="selectPlatform('${p.id}')"><span>${p.name}</span></div>`).join(''); }
function selectPlatform(id) { S.selPlatformId = id; renderPlatformChips(); }
function calcAddTotal() { const income = pf(document.getElementById('f-income').value); const bonus = pf(document.getElementById('f-bonus').value); const tempBonus = pf(document.getElementById('f-temp-bonus').value); const tips = pf(document.getElementById('f-tips').value); const total = income + bonus + tempBonus + tips; document.getElementById('add-total-val').textContent = fmt(total); }
function addWeatherTag(tag) { const noteEl = document.getElementById('f-note'); if (!noteEl.value.includes(tag)) { noteEl.value = (noteEl.value + ' ' + tag).trim(); } }

async function confirmAddRecord() {
  const checkImg = document.getElementById('add-save-img'); const checkBtn = document.getElementById('add-save-btn');
  if (checkBtn.disabled) return; if (!S.selPlatformId) { toast('請先選擇平台'); return; }
  const income = pf(document.getElementById('f-income').value); const bonus = pf(document.getElementById('f-bonus').value); const temp = pf(document.getElementById('f-temp-bonus').value); const tips = pf(document.getElementById('f-tips').value);
  if (income + bonus + temp + tips <= 0) { toast('請輸入至少一項收入金額'); return; }
  
  if (S.editingId) {
    const ok = await customConfirm('是否確認要儲存修改後的記錄？');
    if (!ok) return;
  }

  checkBtn.disabled = true; checkImg.src = 'images/Check2.png'; checkImg.style.transform = 'scale(1.3)'; toast('⏳ 記錄儲存中...', 3000); 
  setTimeout(() => {
    checkImg.style.transform = 'scale(1)'; const h = pf(document.getElementById('f-hrs-val').value); const m = pf(document.getElementById('f-min-val').value); const totalHours = h + (m / 60);
    // 寫入 mileage
    const rec = { id: S.editingId || newId(), date: document.getElementById('f-date').value || todayStr(), time: nowTime(), platformId: S.selPlatformId, punchIn: '', punchOut: '', hours: totalHours, orders: pf(document.getElementById('f-orders').value), mileage: pf(document.getElementById('f-mileage').value), income, bonus, tempBonus: temp, tips, note: document.getElementById('f-note').value.trim() };
    if (S.editingId) { const idx = S.records.findIndex(r => r.id === S.editingId); if (idx >= 0) S.records[idx] = rec; toast('✅ 記錄已更新'); } else { S.records.push(rec); toast('✅ 記錄成功！'); }
    saveRecords(); S.editingId = null; checkImg.src = 'images/Check1.png'; checkBtn.disabled = false; goPage('home'); 
  }, 3000); 
}

function cancelAddRecord() {
  if (S.editingId) {
    S.editingId = null;
    goPage('history');
  } else {
    goPage('home');
  }
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

// 總覽與 TOP3 專用的月份切換
window.navRptMonth = function(dir) {
  S.rptM += dir;
  if(S.rptM < 1) { S.rptM = 12; S.rptY--; }
  if(S.rptM > 12) { S.rptM = 1; S.rptY++; }
  renderReport();
}

// 趨勢專用的日期切換 (週/月/年)
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

function renderRptOverview() {
  const recs = getMonthRecs(S.rptY, S.rptM);
  const total = recs.reduce((s,r)=>s+recTotal(r), 0); const income = recs.reduce((s,r)=>s+pf(r.income), 0);
  const bonus = recs.reduce((s,r)=>s+pf(r.bonus)+pf(r.tempBonus), 0); const tips = recs.reduce((s,r)=>s+pf(r.tips), 0);
  const orders = recs.reduce((s,r)=>s+pf(r.orders), 0); const hours = recs.reduce((s,r)=>s+pf(r.hours), 0);

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
      <button class="mbtn" onclick="navRptMonth(-1)">◀</button>
      <span style="font-family:var(--mono); font-size:14px; font-weight:700; color:var(--acc);">${S.rptY} 年 ${S.rptM} 月</span>
      <button class="mbtn" onclick="navRptMonth(1)">▶</button>
    </div>`;

  // 移除 summary-card class，徹底擺脫全域 nowrap 設定的干擾
  html += `
    <div style="margin-bottom:20px; background:#FFFFE0; border:1px solid #f0e6cc; border-radius:16px; position:relative; box-shadow:0 2px 6px rgba(0,0,0,0.03);">
      <div onclick="toggleSummaryCard('rpt-overview-col')" style="padding:16px; position:relative; cursor:pointer;">
        <div style="text-align:center; margin-bottom:16px;">
          <div style="font-size:12px; color:var(--t3); font-weight:700; margin-bottom:6px; letter-spacing:1px;">本月總收入</div>
          <div style="font-family:var(--mono); font-size:32px; font-weight:800; color:var(--t1); line-height:1;">$ ${fmt(total)}</div>
        </div>
        <div style="display:flex; justify-content:center; align-items:center; gap:10px; white-space:normal;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span style="background:#dcfce7; color:#16a34a; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700;">行程</span>
            <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:#16a34a;">$${fmt(income)}</span>
          </div>
          <div style="width:1px; height:24px; background:rgba(0,0,0,0.1);"></div>
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span style="background:#fef3c7; color:#d97706; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700;">獎勵</span>
            <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:#d97706;">$${fmt(bonus)}</span>
          </div>
          <div style="width:1px; height:24px; background:rgba(0,0,0,0.1);"></div>
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span style="background:#e0f2fe; color:#2563eb; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700;">小費</span>
            <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:#2563eb;">$${fmt(tips)}</span>
          </div>
        </div>
        <div id="rpt-overview-col-btn" style="position:absolute; bottom:-14px; left:50%; transform:translateX(-50%) rotate(0deg); width:28px; height:28px; background:#fff; border:1px solid #e5e7eb; border-radius:50%; box-shadow:0 4px 6px rgba(0,0,0,0.1); color:#f97316; font-size:10px; z-index:10; display:flex; align-items:center; justify-content:center; transition:transform 0.35s ease;">▼</div>
      </div>
      <div id="rpt-overview-col" style="max-height:0px; overflow:hidden; transition: max-height 0.35s ease;">
        <div style="border-top:1px dashed #d1d5db; margin:8px 16px;"></div>
        <div style="padding:8px 16px 16px; white-space:normal;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed rgba(0,0,0,0.05);">
            <div style="flex:1; display:flex; align-items:center; gap:8px;"><span style="background:#9ca3af; color:#fff; font-size:11px; padding:4px 8px; border-radius:4px; font-weight:700;">接單數</span><span style="font-family:var(--mono); font-size:15px; font-weight:800; color:var(--t1);">${fmt(orders)} <span style="font-size:11px; font-weight:600;">單</span></span></div>
            <div style="color:rgba(0,0,0,0.05); margin:0 12px;">│</div>
            <div style="flex:1; display:flex; align-items:center; gap:8px; justify-content:flex-end;"><span style="background:#8b5cf6; color:#fff; font-size:11px; padding:4px 8px; border-radius:4px; font-weight:700;">總工時</span><span style="font-family:var(--mono); font-size:15px; font-weight:800; color:#8b5cf6;">${fmtHours(hours)}</span></div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0;">
            <div style="flex:1; display:flex; align-items:center; gap:8px;"><span style="background:#3b82f6; color:#fff; font-size:11px; padding:4px 8px; border-radius:4px; font-weight:700;">時薪</span><span style="font-family:var(--mono); font-size:15px; font-weight:800; color:#3b82f6;">${hours>0?`$${fmt(Math.round(total/hours))}`:'—'} <span style="font-size:11px; font-weight:600;">/h</span></span></div>
            <div style="color:rgba(0,0,0,0.05); margin:0 12px;">│</div>
            <div style="flex:1; display:flex; align-items:center; gap:8px; justify-content:flex-end;"><span style="background:#ea580c; color:#fff; font-size:11px; padding:4px 8px; border-radius:4px; font-weight:700;">均單</span><span style="font-family:var(--mono); font-size:15px; font-weight:800; color:#ea580c;">${orders>0?`$${fmt(Math.round(total/orders))}`:'—'} <span style="font-size:11px; font-weight:600;">/單</span></span></div>
          </div>
        </div>
      </div>
    </div>`;

  const activePlats = S.platforms.filter(p=>p.active);
  const platData = activePlats.map(p=>({ name: p.name, color: p.color, val: recs.filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0) })).filter(p=>p.val>0);
  
  if (platData.length > 1) {
    html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">各平台佔比</div><div style="position:relative;height:220px;margin-bottom:10px"><canvas id="plat-pie"></canvas></div><div style="display:flex;flex-direction:column;gap:6px">${platData.map(p=>{ const pct = total>0?Math.round(p.val/total*100):0; return `<div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0"></div><span style="flex:1;font-size:13px">${p.name}</span><span style="font-family:var(--mono);font-size:13px;color:var(--t2)">${pct}%</span><span style="font-family:var(--mono);font-size:13px;font-weight:600">NT$ ${fmt(p.val)}</span></div>`; }).join('')}</div></div>`;
  }
  document.getElementById('rv-overview').innerHTML = html;
  if (platData.length>1) drawPie('plat-pie', platData.map(p=>p.name), platData.map(p=>p.val), platData.map(p=>p.color));
}

/* ══ 5. 收入分析 開始 ════════════════════════════════════ */

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
  const days = trend.getDays(); // 觸發計算日期陣列與 navLabel

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
      // 年趨勢要依賴獨立的 td
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

// 替換：移除強制的 max 屬性設定
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
    // 若沒有強制傳入 maxScale，就預設給一個 suggestedMax 讓圖表不會太扁
    suggestedMax: maxScale || 500, 
    ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : v, font: { size: 10 } }, 
    grid: { color: 'rgba(0,0,0,.05)', drawBorder: false } 
  };
  
  // 只有當傳入 maxScale 時，才鎖死最大值
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
      scales: { 
        x: { stacked: true, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: false }, grid: { display: false } }, 
        y: yOpts
      }, 
      animation: { duration: 400 } 
    } 
  });
}

// 重構：靈活設定 3 個不同的月份或年份進行比較
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

  // 新增獨立月份切換器
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

function drawLine(canvasId, labels, datasets) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, { type: 'line', data: { labels, datasets: datasets.map(d=>({ label:d.label, data:d.data, borderColor:d.color, backgroundColor:d.color+'22', borderWidth:2, pointRadius:3, hitRadius:20, tension:.3, fill:true }))}, options: { responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false }, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} }, scales:{ x:{ticks:{font:{size:9},maxRotation:45,autoSkip:true}}, y:{beginAtZero:true, suggestedMax:500, ticks:{callback:v=>v>=1000?(v/1000).toFixed(1).replace('.0','')+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} }, animation:{ duration:400 } } });
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

// 替換：針對容器加上強制允許滑動的屬性
function renderVehicles() {
  const container = document.getElementById('vehicle-content'); 
  const selectorContainer = document.getElementById('veh-selector-container');
  
  // 確保容器具備滑動能力
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
      const isEV = r.fuelType === 'electric'; // 判斷是否為電動車燃料
      const icon = isFuel ? (isEV ? '⚡' : '⛽') : '🔧'; 
      const mainText = isFuel ? (isEV ? '電池交換' : `${r.fuelType||'95 無鉛'} ($${r.price||0}/L)`) : r.items.join(', '); 
      const kmText = isFuel ? `${r.prevKm} → ${r.km} km` : `${r.km} km`;
      
      // 電動車燃料顯示使用里程，一般油車或維修顯示金額
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

function selectVehInForm(id) {
  S.selVehicleId = id;
  document.querySelectorAll('#veh-rec-veh-icons [data-vid]').forEach(el => {
    const isActive = el.dataset.vid === id; const iconBox = el.querySelector('.veh-form-icon'); const nameSpan = el.querySelector('.veh-form-name');
    if (iconBox) { iconBox.style.borderColor = isActive ? 'var(--acc)' : 'transparent'; iconBox.style.boxShadow = isActive ? '0 4px 10px rgba(255,107,53,0.2)' : '0 2px 4px rgba(0,0,0,0.1)'; }
    if (nameSpan) { nameSpan.style.color = isActive ? 'var(--acc)' : 'var(--t2)'; nameSpan.style.fontWeight = isActive ? '700' : '500'; }
  });
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
  
  // 上方只顯示目前「選擇中」的單一車輛圖示
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  if (v) {
    document.getElementById('veh-rec-veh-icons').innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; gap:4px; margin:0 auto;"><div style="width:50px; height:50px; border-radius:12px; background:#fff; border:2px solid var(--acc); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(255,107,53,0.2);"><div class="scooter-mask" style="background-color:${v.color}; -webkit-mask-image:url('images/scooter${v.icon}.png'); width:30px; height:30px;"></div></div><span style="font-size:11px; font-weight:700; color:var(--acc);">${v.name}</span></div>`;
  }

  let r = null; if (isEdit) { r = S.vehicleRecs.find(x => x.id === recordId); S.addVehRecType = r.type; } else { S.addVehRecType = S.vehicleTab; }
  document.getElementById('vr-date').value = r ? r.date : todayStr(); document.getElementById('vr-time').value = r ? (r.time || nowTime()) : nowTime();
  currentSelItems = (r && r.type === 'maintenance') ? [...r.items] :[];
  
  if (S.addVehRecType === 'fuel') { 
    document.getElementById('vr-fuel-type').value = r?.fuelType || (v ? v.defaultFuel : '95'); 
    document.getElementById('vr-discount').value = r?.discount || '0'; document.getElementById('vr-prev-km').value = r?.prevKm || ''; document.getElementById('vr-curr-km').value = r?.km || ''; document.getElementById('vr-liters').value = r?.liters || ''; document.getElementById('vr-price').value = r?.price || ''; 
    calcVehFuel(); 
  } else { 
    document.getElementById('vm-km').value = r?.km || ''; document.getElementById('vm-shop').value = r?.shop || ''; document.getElementById('vm-pay-method').value = r?.payMethod || '現金'; document.getElementById('vm-amount').value = r?.amount || ''; document.getElementById('vm-note').value = r?.note || ''; renderShopHistory(); 
  }
  switchVehFormTab(S.addVehRecType, S.addVehRecType === 'fuel' ? 0 : 1); openOverlay('veh-rec-add-page');
}

// 替換：控制底部面板動態轉換為電動車使用量顯示模式
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
    
    // 動態切換底部的總計顯示面板
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

// 監聽里程輸入，即時計算電動車使用量
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
      amount = 0; // 電動車沒有付款金額
    }
  } else { 
    amount = pf(document.getElementById('vm-amount').value); 
    if (amount <= 0 || currentSelItems.length === 0) { toast('請選擇保養項目並輸入金額'); return; } 
  }
  checkBtn.disabled = true; checkImg.src = 'images/Check2.png'; checkImg.style.transform = 'scale(1.3)'; toast('⏳ 記錄儲存中...', 3000);
  setTimeout(() => {
    checkImg.style.transform = 'scale(1)'; const commonData = { id: editingVehRecId || newId(), vehicleId: S.selVehicleId, type: S.addVehRecType, date: document.getElementById('vr-date').value, time: document.getElementById('vr-time').value, amount: amount }; let specificData = {};
    if (S.addVehRecType === 'fuel') { specificData = { fuelType: document.getElementById('vr-fuel-type') ? document.getElementById('vr-fuel-type').value : 'electric', discount: pf(document.getElementById('vr-discount')?document.getElementById('vr-discount').value:0), prevKm: pf(document.getElementById('vr-prev-km').value), km: pf(document.getElementById('vr-curr-km').value), liters: pf(document.getElementById('vr-liters')?document.getElementById('vr-liters').value:0), price: pf(document.getElementById('vr-price')?document.getElementById('vr-price').value:0) }; } 
    else { const shop = document.getElementById('vm-shop').value.trim(); if (shop && !S.settings.shopHistory.includes(shop)) { S.settings.shopHistory.push(shop); saveSettings(); } specificData = { km: pf(document.getElementById('vm-km').value), items: currentSelItems, shop: shop, payMethod: document.getElementById('vm-pay-method').value, note: document.getElementById('vm-note').value }; }
    const finalRec = { ...commonData, ...specificData }; if (editingVehRecId) { const idx = S.vehicleRecs.findIndex(r => r.id === editingVehRecId); if (idx >= 0) S.vehicleRecs[idx] = finalRec; toast('✅ 記錄已更新'); } else { S.vehicleRecs.push(finalRec); toast('✅ 記錄已新增'); }
    editingVehRecId = null; saveVehicleRecs(); checkImg.src = 'images/Check1.png'; checkBtn.disabled = false; closeOverlay('veh-rec-add-page'); renderVehicles();
  }, 3000);
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

const MAINT_ITEMS = ['機油', '齒輪油', '空濾', '前輪', '後輪', '煞車油', '前煞車皮', '後煞車皮', '皮帶', '傳動保養', '大保養'];
let currentSelItems = []; function toggleMaintItem(el, item) { el.classList.toggle('on'); if (currentSelItems.includes(item)) { currentSelItems = currentSelItems.filter(i => i !== item); } else { currentSelItems.push(item); } }
function renderShopHistory() { if (!S.settings.shopHistory) S.settings.shopHistory = []; document.getElementById('shop-history-container').innerHTML = S.settings.shopHistory.map((shop, i) => `<div class="shop-chip"><span onclick="document.getElementById('vm-shop').value='${shop}'">${shop}</span><span class="shop-chip-del" onclick="deleteShopHistory(${i})">✕</span></div>`).join(''); }
function deleteShopHistory(index) { S.settings.shopHistory.splice(index, 1); saveSettings(); renderShopHistory(); }
/* ══ 6. 車輛管理 結束 ══════════════════════════════════════════ */


/* ══ 7. 設定管理與啟動 開始 ═══════════════════════════════════ */
function renderSettings() {
  const goals = S.settings.goals||{};
  const html  = `
  <div class="set-sec"><h3>平台管理</h3><div class="set-list"><div class="set-row" onclick="openPlatformList()"><span class="sn"><div style="font-weight:500">🏪 平台列表與設定</div><div class="sn-sub">目前啟用 ${S.platforms.filter(p=>p.active).length} 個平台</div></span><span class="arr">›</span></div></div></div>
  <div class="set-sec"><h3>目標設定</h3><div class="set-list"><div class="set-row" onclick="openGoalSettings()"><span class="sn"><div>週/月收入目標</div><div class="sn-sub">週目標：NT$ ${fmt(goals.weekly||0)}　月目標：NT$ ${fmt(goals.monthly||0)}</div></span><span class="arr">›</span></div></div></div>
  <div class="set-sec"><h3>獎勵清單</h3><div class="set-list">
      ${(S.settings.rewards||[]).map((r,i)=>`<div class="set-row"><span class="sn"><div>${r.name}</div><div class="sn-sub">${getPlatform(r.platformId).name}　≥${r.minOrders}單　NT$ ${fmt(r.amount)}</div></span><button onclick="event.stopPropagation();deleteReward(${i})" class="del-btn">✕</button></div>`).join('')}
      <div class="set-row" onclick="openAddReward()"><span style="font-size:20px">➕</span><span class="sn">新增獎勵項目</span></div>
  </div></div>
  <div class="set-sec"><h3>資料管理</h3><div class="set-list">
      <div class="set-row" onclick="doBackup()"><span class="sn">📥 備份資料（JSON）</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doRestore()"><span class="sn">📤 還原備份</span><span class="arr">↑</span></div>
      <div class="set-row" onclick="doExportCSV()"><span class="sn">📊 匯出試算表（CSV）</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doClearData()"><span class="sn" style="color:var(--red)">🗑 清除所有資料 (保留設定)</span><span class="arr" style="color:var(--red)">!</span></div>
      <div class="set-row" onclick="doReset()"><span class="sn" style="color:var(--red); font-weight:700;">⚠️ 重置所有設定和資料</span><span class="arr" style="color:var(--red)">!</span></div>
  </div></div>
  <div style="margin-top:24px; padding-bottom:16px; text-align:center;">
      <span onclick="openOverlay('about-page')" style="font-size:13px; color:var(--t3); font-weight:600; cursor:pointer; padding:8px 16px; display:inline-block;">關於我們</span>
  </div>`;
  document.getElementById('settings-content').innerHTML = html;
}

function openPlatformList() {
  document.getElementById('sub-title').textContent = '平台列表';
  document.getElementById('sub-body').innerHTML = `<div class="set-list">${S.platforms.map(p=>`<div class="set-row" onclick="openPlatformEdit('${p.id}')"><div class="plat-color-dot" style="background:${p.color}"></div><div class="sn"><div style="font-weight:600">${p.name}</div><div class="sn-sub">${p.active?'✅ 已啟用':'⭕ 已停用'}</div></div><span class="arr">›</span></div>`).join('')}</div><div style="margin-top:12px; font-size:11px; color:var(--t3); text-align:center;">💡 點擊平台可自訂顏色與啟用狀態</div>`;
  openOverlay('sub-page');
}
function openPlatformEdit(id) {
  const p = S.platforms.find(x=>x.id===id); if (!p) return;
  document.getElementById('sub-title').textContent = p.name; 
  document.getElementById('sub-body').innerHTML = `<div style="margin-bottom:16px; padding:12px; background:var(--sf2); border-radius:var(--rs); font-size:12px; color:var(--t2); line-height:1.6;"><strong>📝 結算與發薪規則：</strong><br>${p.ruleDesc ? p.ruleDesc.replace(/｜/g, '<br>') : ''}</div><div class="fg" style="margin-bottom:16px"><label>自訂平台顏色</label><div style="display:flex;gap:8px"><input type="color" id="sp-color-pick" value="${p.color}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px"><input type="text" class="finp" id="sp-color" value="${p.color}" style="flex:1"></div></div><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding:12px;background:var(--sf2);border-radius:var(--rs)"><label style="font-size:14px;font-weight:600;flex:1;cursor:pointer" for="sp-active">啟用此平台</label><input type="checkbox" id="sp-active" ${p.active?'checked':''} style="width:20px;height:20px;cursor:pointer"></div><div style="display:flex;gap:8px"><button onclick="openPlatformList()" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-size:14px;font-weight:600;cursor:pointer;">返回列表</button><button onclick="savePlatformEdit('${id}')" class="btn-acc" style="flex:2;padding:12px;font-size:14px;font-weight:700;border-radius:var(--rs)">儲存設定</button></div>`;
  document.getElementById('sp-color-pick').addEventListener('input', e => { document.getElementById('sp-color').value = e.target.value; });
}
function savePlatformEdit(id) { const p = S.platforms.find(x=>x.id===id); if (!p) return; p.color = document.getElementById('sp-color').value.trim() || p.color; p.active = document.getElementById('sp-active').checked; savePlatforms(); toast('✅ 平台已更新'); if (S.tab === 'home') renderHome(); renderSettings(); openPlatformList(); }
function openGoalSettings() { document.getElementById('sub-title').textContent = '目標設定'; document.getElementById('sub-add-btn')?.style.setProperty('display', 'none'); const g = S.settings.goals||{}; document.getElementById('sub-body').innerHTML = `<div class="fg" style="margin-bottom:10px"><label>📅 週目標（NT$）</label><input type="number" class="finp" id="g-weekly" value="${g.weekly||0}" inputmode="decimal"></div><div class="fg" style="margin-bottom:14px"><label>📆 月目標（NT$）</label><input type="number" class="finp" id="g-monthly" value="${g.monthly||0}" inputmode="decimal"></div><button onclick="saveGoals()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">儲存目標</button>`; openOverlay('sub-page'); }
function saveGoals() { S.settings.goals = { weekly: pf(document.getElementById('g-weekly').value), monthly: pf(document.getElementById('g-monthly').value) }; saveSettings(); closeOverlay('sub-page'); renderSettings(); toast('✅ 目標已儲存'); }
function openAddReward() { document.getElementById('sub-title').textContent = '新增獎勵項目'; document.getElementById('sub-add-btn')?.style.setProperty('display', 'none'); const platOpts = S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}">${p.name}</option>`).join(''); document.getElementById('sub-body').innerHTML = `<div class="fg" style="margin-bottom:10px"><label>獎勵名稱</label><input type="text" class="finp" id="rw-name" placeholder="例：週末衝單獎勵"></div><div class="fg" style="margin-bottom:10px"><label>適用平台</label><select class="fsel" id="rw-plat">${platOpts}</select></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px"><div class="fg"><label>最低單數</label><input type="number" class="finp" id="rw-min" value="0" inputmode="numeric"></div><div class="fg"><label>上限單數（0=無限）</label><input type="number" class="finp" id="rw-max" value="0" inputmode="numeric"></div></div><div class="fg" style="margin-bottom:14px"><label>獎勵金額（NT$）</label><input type="number" class="finp" id="rw-amt" value="0" inputmode="decimal"></div><button onclick="saveNewReward()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">新增獎勵</button>`; openOverlay('sub-page'); }
function saveNewReward() { const name = document.getElementById('rw-name').value.trim(); if (!name) { toast('請輸入獎勵名稱'); return; } if (!S.settings.rewards) S.settings.rewards=[]; S.settings.rewards.push({ id: newId(), name, platformId: document.getElementById('rw-plat').value, minOrders: pf(document.getElementById('rw-min').value), maxOrders: pf(document.getElementById('rw-max').value), amount: pf(document.getElementById('rw-amt').value) }); saveSettings(); closeOverlay('sub-page'); renderSettings(); toast('✅ 獎勵已新增'); }
async function deleteReward(i) { const ok = await customConfirm(`確定刪除「${S.settings.rewards[i]?.name}」？`); if (!ok) return; S.settings.rewards.splice(i,1); saveSettings(); renderSettings(); toast('已刪除'); }

// 備份與匯出
function doBackup() { const data = { exportedAt:new Date().toISOString(), records:S.records, platforms:S.platforms, settings:S.settings, vehicles:S.vehicles, vehicleRecs:S.vehicleRecs }; const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `外送記帳_${todayStr()}.json`; a.click(); URL.revokeObjectURL(url); toast('✅ 備份完成'); }
function doRestore() { const fi = document.getElementById('restore-file'); fi.onchange = async () => { const file = fi.files[0]; if(!file) return; try { const text = await file.text(); const data = JSON.parse(text); const ok = await customConfirm('確定用此備份<strong>覆蓋</strong>現有資料？'); if (!ok) return; if (data.records) { S.records=data.records; saveRecords(); } if (data.platforms) { S.platforms=data.platforms; savePlatforms(); } if (data.settings) { S.settings=data.settings; saveSettings(); } if (data.vehicles) { S.vehicles=data.vehicles; saveVehicles(); } if (data.vehicleRecs) { S.vehicleRecs=data.vehicleRecs; saveVehicleRecs(); } toast('✅ 還原成功'); renderSettings(); renderHome(); } catch { toast('❌ 檔案格式錯誤'); } fi.value=''; }; fi.click(); }
function doExportCSV() { const headers =['日期','平台','接單數','里程','行程收入','固定獎勵','臨時獎勵','小費','總收入','工時','上線','下線','備註']; const rows = S.records.map(r=>{ const p = getPlatform(r.platformId); return[r.date, p.name, r.orders||0, r.mileage||0, r.income||0, r.bonus||0, r.tempBonus||0, r.tips||0, recTotal(r), r.hours||0, r.punchIn||'', r.punchOut||'', r.note||''].join(','); }); const csv =[headers.join(','), ...rows].join('\n'); const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`外送記帳_${todayStr()}.csv`; a.click(); URL.revokeObjectURL(url); toast('✅ CSV 匯出完成'); }

// 清除資料：只清空收入記錄與車輛維修記錄（保留平台、目標等設定）
async function doClearData() { 
  const ok = await customConfirm('⚠️ 確定要<strong>清除所有記錄與車輛資料</strong>嗎？<br>（這將保留您的平台設定與目標）此動作無法復原！'); 
  if (!ok) return; 
  S.records=[]; S.vehicles=[]; S.vehicleRecs=[]; 
  saveRecords(); saveVehicles(); saveVehicleRecs(); 
  toast('已清除記錄與車輛資料'); 
  renderHome(); renderSettings(); 
}

// 重置所有：回歸預設值（連同平台顏色、設定目標全部歸零）
async function doReset() { 
  const ok = await customConfirm('⚠️ 確定要<strong>重置所有設定和資料</strong>嗎？<br>App將完全恢復到剛安裝的初始狀態！此動作無法復原！'); 
  if (!ok) return; 
  
  S.records = []; 
  S.settings = { ...DEFAULT_SETTINGS, shopHistory:[] }; 
  S.platforms = DEFAULT_PLATFORMS.map(p => ({...p})); // 恢復預設的三大平台與顏色
  S.vehicles = []; 
  S.vehicleRecs = []; 
  saveRecords(); saveSettings(); savePlatforms(); saveVehicles(); saveVehicleRecs(); 
  toast('已重置所有設定和資料'); 
  renderHome(); renderSettings(); 
}

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').then(r=>console.log('SW 已註冊')).catch(e=>console.log('SW 註冊失敗')); }); }

// 修正：init 直接設定初始狀態，不透過 goPage，
// 避免移除/重加 active class 觸發 CSS transition，導致首頁版面在初次繪製時空白
function init() {
  loadAll();
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
  // page-home 已在 HTML 中預設為 active，直接渲染內容即可
  renderHome();
}
init();
/* ══ 7. 設定管理與啟動 結束 ═══════════════════════════════════ */
