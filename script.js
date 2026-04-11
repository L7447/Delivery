/* ══════════════════════════════════════════════════════
   外送記帳 App — script.js (終極重構版)
   設計：由上到下分區註解，結構清晰，不閃爍，功能完整
   ══════════════════════════════════════════════════════ */

/* ── localStorage 資料鍵值 ──────────────────────── */
const KEYS = {
  records:     'delivery_records',      
  platforms:   'delivery_platforms',    
  settings:    'delivery_settings',     
  punch:       'delivery_punch_live',   
  vehicles:    'delivery_vehicles',     
  vehicleRecs: 'delivery_vehicle_recs', 
};

/* ── 預設平台（預設改為全關閉，由設定頁啟用）─────────────────── */
const DEFAULT_PLATFORMS = [
  { id:'uber',      name:'Uber Eats', color:'#008000', active:false, ruleDesc:'每週一、四結算｜每週四發薪' },
  { id:'foodpanda', name:'foodpanda', color:'#D70F64', active:false, ruleDesc:'雙週日結算｜雙週三明細｜雙週三發薪' },
  { id:'foodomo',   name:'foodomo',   color:'#ff0000', active:false, ruleDesc:'每月15及月底結算｜每月5及20發薪' },
];

/* ── 預設 App 設定 ───────────────────────────────── */
const DEFAULT_SETTINGS = {
  goals:       { weekly: 0, monthly: 0 }, 
  rewards:     [],                        
  shopHistory: [], 
};

/* ══ 全域狀態物件 ════════════════════════════════ */
const S = {
  tab:           'home',                  
  rptY:          new Date().getFullYear(),
  rptM:          new Date().getMonth()+1, 
  rptView:       'overview',              
  calY:          new Date().getFullYear(),
  calM:          new Date().getMonth()+1, 
  selDate:       todayStr(),              
  records:       [],                      
  platforms:     [],                      
  settings:      { ...DEFAULT_SETTINGS }, 
  punch:         null,                    
  vehicles:      [],                      
  vehicleRecs:   [],                      
  editingId:     null,                    
  selPlatformId: null,                    
  charts:        {},                                           
  homeSubTab:    'schedule',              
  vehicleTab:    'fuel',                  
  newVehIcon:    4,                       
  newVehColor:   '#555555',               
  selVehicleId:  null,                    
  vehY:          new Date().getFullYear(), 
  vehM:          new Date().getMonth()+1,  
  addVehRecType: 'fuel',                   
};

/* ══ 共用工具函式 ════════════════════════════════════ */
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
    document.getElementById('confirm-msg').innerHTML = msg;
    ov.classList.add('show');
    const ok     = document.getElementById('confirm-ok-btn');
    const cancel = document.getElementById('confirm-cancel-btn');
    function done(v) { ov.classList.remove('show'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); resolve(v); }
    function onOk() { done(true); } function onCancel() { done(false); }
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel);
    ov.addEventListener('click', e=>{ if(e.target===ov) done(false); }, {once:true});
  });
}
function openOverlay(id)  { document.getElementById(id)?.classList.add('show'); }
function closeOverlay(id) { document.getElementById(id)?.classList.remove('show'); }
function closeDetailOverlay() { document.getElementById('detail-overlay').classList.remove('show'); }

function toggleSummaryCard(id) {
  const el = document.getElementById(id); const btn = document.getElementById(id + '-btn'); if (!el || !btn) return;
  if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { el.style.maxHeight = '100px'; btn.style.transform = 'translateY(-50%) rotate(180deg)'; } 
  else { el.style.maxHeight = '0px'; btn.style.transform = 'translateY(-50%) rotate(0deg)'; }
}

function buildSummaryCard(title, total, orders, hours, bonus, tempBonus, tips, cardId) {
  if (total <= 0) return '';
  const totalBonus = bonus + tempBonus; let extraStr = '';
  if (totalBonus > 0 || tips > 0) {
    const parts = [];
    if (totalBonus > 0) parts.push(`含獎勵${fmt(totalBonus)}元`);
    if (tips > 0) parts.push(`線上小費${fmt(tips)}元`);
    extraStr = `<div style="font-size:11px; color:var(--gold); margin-top:2px;">〔${parts.join('、')}〕</div>`;
  }
  const avgPerOrder = orders > 0 ? Math.round(total / orders) : 0;
  const avgPerHour = hours > 0 ? Math.round(total / hours) : 0;
  const ordersPerHour = hours > 0 ? (orders / hours).toFixed(1) : 0;

  return `
    <div class="summary-card" style="margin:2px; padding:2px;">
      <div class="sum-top" onclick="toggleSummaryCard('${cardId}')" style="position:relative; display:flex; align-items:center; padding:2px;">
        <div style="flex:1.2; display:flex; flex-direction:column; justify-content:center;">
          <div style="display:flex; align-items:baseline; gap:6px;"><span style="font-size:14px; font-weight:700; color:var(--t1);">${title}</span><span style="font-family:var(--mono); font-size:24px; font-weight:800; color:var(--green);">$${fmt(total)}</span></div>
          ${extraStr}
        </div>
        <div class="sum-v-divider"></div>
        <div style="flex:0.8; text-align:center; font-size:13px; font-weight:700; color:var(--t2);">${orders > 0 ? fmt(orders) : '0'} 單</div>
        <div class="sum-v-divider"></div>
        <div style="flex:1; text-align:center; font-size:13px; font-weight:700; color:var(--t2); padding-right:24px;">${hours > 0 ? fmtHours(hours) : '0m'}</div>
        <div id="${cardId}-btn" class="sum-toggle-btn">▼</div>
      </div>
      <div id="${cardId}" class="summary-collapse" style="max-height:0px; overflow:hidden;">
        <div style="border-top:1px dashed rgba(0,0,0,0.1); margin:2px 0;"></div>
        <div style="display:flex; align-items:center; text-align:center; padding:2px;">
          <div style="flex:1; font-size:12px; font-weight:700; color:var(--t2);">平均 <span style="font-family:var(--mono); font-size:15px; color:var(--blue);">$${fmt(avgPerOrder)}</span> <span style="font-size:10px; font-weight:500;">/單</span></div>
          <div class="sum-v-divider"></div>
          <div style="flex:1; font-size:12px; font-weight:700; color:var(--t2);"><span style="font-family:var(--mono); font-size:15px; color:var(--blue);">${ordersPerHour}</span> <span style="font-size:10px; font-weight:500;">單/時</span></div>
          <div class="sum-v-divider"></div>
          <div style="flex:1; font-size:12px; font-weight:700; color:var(--t2);"><span style="font-family:var(--mono); font-size:15px; color:var(--blue);">$${fmt(avgPerHour)}</span> <span style="font-size:10px; font-weight:500;">/時</span></div>
        </div>
      </div>
    </div>`;
}

/* ══ 資料讀寫 ════════════════════════════════════ */
function loadAll() {
  try { S.records = JSON.parse(localStorage.getItem(KEYS.records)||'[]'); } catch { S.records=[]; }
  try { 
    const saved = JSON.parse(localStorage.getItem(KEYS.platforms)||'[]'); 
    S.platforms = DEFAULT_PLATFORMS.map(dp => { const sp = saved.find(x => x.id === dp.id); return sp ? { ...dp, color: sp.color, active: sp.active } : { ...dp }; });
  } catch { S.platforms = DEFAULT_PLATFORMS.map(p=>({...p})); }
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

/* ══ 頁面與 Tab 導覽控制 ════════════════════════════ */
function goPage(name) {
  S.tab = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni[data-pg]').forEach(n => {
    const isActive = n.dataset.pg === name;
    n.classList.toggle('active', isActive);
    const img = n.querySelector('.ni-img');
    if (img) img.src = isActive ? n.dataset.img2 : n.dataset.img1;
  });
  document.getElementById(`page-${name}`)?.classList.add('active');
  document.body.setAttribute('data-tab', name);

  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'report')   renderReport();
  if (name === 'vehicles') renderVehicles(); 
  if (name === 'settings') renderSettings();
}
document.querySelectorAll('.ni[data-pg]').forEach(el =>
  el.addEventListener('click', () => {
    const pg = el.dataset.pg;
    if (pg === 'add' && S.tab !== 'add') openAddPage(); else goPage(pg);
  })
);

function switchHomeTab(tab, index) {
  S.homeSubTab = tab;
  document.getElementById('home-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.getElementById('btn-home-schedule').classList.toggle('active', tab==='schedule');
  document.getElementById('btn-home-goal').classList.toggle('active', tab==='goal');
  renderHome(); 
}

function switchHistTab(tab, index) {
  S.histTab = tab; S.histNavDate = new Date();
  document.getElementById('hist-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.querySelectorAll('#page-history .slide-btn').forEach((btn, i) => btn.classList.toggle('active', i === index));
  renderHistory(); 
}

function switchRptTab(tab, index, btnEl) {
  S.rptView = tab;
  document.getElementById('rpt-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.querySelectorAll('#rpt-tabs .slide-btn').forEach(btn => btn.classList.remove('active'));
  btnEl.classList.add('active');
  ['overview','trend','compare','top3'].forEach(v => { document.getElementById(`rv-${v}`).style.display = v===S.rptView ? '' : 'none'; });
  renderReport();
}

function switchVehicleTab(tab, index) {
  S.vehicleTab = tab;
  document.getElementById('veh-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.getElementById('btn-veh-fuel').classList.toggle('active', tab === 'fuel');
  document.getElementById('btn-veh-maint').classList.toggle('active', tab === 'maintenance');
  renderVehicles(); 
}


/* ══════════════════════════════════════════════════════
   首頁
   ══════════════════════════════════════════════════════ */
function renderHome() {
  const today = todayStr(); const dayRecs = getDayRecs(today);
  const total = dayRecs.reduce((s,r)=>s+recTotal(r), 0); const orders = dayRecs.reduce((s,r)=>s+pf(r.orders), 0);
  const hours = dayRecs.filter(r => !r.isPunchOnly).reduce((s,r)=>s+pf(r.hours), 0);     
  const dateObj = new Date(today+'T00:00:00'); const dow = ['日','一','二','三','四','五','六'][dateObj.getDay()];

  const activePlatforms = S.platforms.filter(p=>p.active);
  const platStats = activePlatforms.map(p => {
    const recs = dayRecs.filter(r => r.platformId === p.id);
    return { ...p, sum: recs.reduce((s, r) => s + recTotal(r), 0), orders: recs.reduce((s, r) => s + pf(r.orders), 0), hours: recs.reduce((s, r) => s + pf(r.hours), 0) };
  }).filter(p => p.sum > 0 || p.orders > 0 || p.hours > 0);

  let topHtml = `
  <div class="home-top-fixed">
    <div class="home-header">
      <div class="home-pg-title">今日概況</div>
      <div class="home-pg-date"><b>${dateObj.getFullYear()}</b> 年 <b>${dateObj.getMonth()+1}</b> 月 <b>${dateObj.getDate()}</b> 日 星期 <b>${dow}</b></div>
    </div>
    <div class="today-hero">`;

  if (platStats.length > 0) {
    topHtml += `<div class="hero-plat-list">`;
    platStats.forEach(p => {
      topHtml += `<div class="hero-plat-row" style="background:${p.color}15; border: 1px solid ${p.color}60; color: ${p.color};">
          <span class="hp-name">${p.name}收入：</span><span class="hp-sum">$ ${fmt(p.sum)}</span>
          <span class="hp-ord">${p.orders} 單</span><span class="hp-hrs">${p.hours > 0 ? fmtHours(p.hours) : 0}</span>
        </div>`;
    });
    topHtml += `</div>`;
  } else { topHtml += `<div style="text-align:center; font-size:13px; color:var(--t3); margin:12px 0;">今日尚未有收入資料</div>`; }

  const dayBonus = dayRecs.reduce((s,r)=>s+pf(r.bonus), 0);
  const dayTemp = dayRecs.reduce((s,r)=>s+pf(r.tempBonus), 0);
  const dayTips = dayRecs.reduce((s,r)=>s+pf(r.tips), 0);
  topHtml += buildSummaryCard('總計', total, orders, hours, dayBonus, dayTemp, dayTips, 'home-summary-card');
  topHtml += `</div>`;

  const isPunched = S.punch && S.punch.date === today;
  let punchStatusStr = '離線';
  if (isPunched) {
    const startMs = new Date(`${today}T${S.punch.startTime}`).getTime();
    const diffMin = Math.floor((Date.now() - startMs) / 60000);
    punchStatusStr = `上線中 (${Math.floor(diffMin/60)}h${diffMin%60}m)`;
  }

  topHtml += `
    <div class="punch-card-new">
      <div class="punch-status-left">
        <div class="punch-dot-new ${isPunched ? 'online' : ''}"></div>
        <span style="color:${isPunched ? 'var(--green)' : 'var(--t3)'}">${punchStatusStr}</span>
      </div>
      <button class="punch-btn-right ${isPunched ? 'btn-go-offline' : 'btn-go-online'}" onclick="${isPunched ? 'punchOut()' : 'punchIn()'}">
        ${isPunched ? '⏹ 下線打卡' : '▶ 上線打卡'}
      </button>
    </div>
  </div>`; 

  if (!S.homeSubTab) S.homeSubTab = 'schedule';
  let bottomHtml = ``;

  if (S.homeSubTab === 'schedule') {
    const todayObj = new Date(); todayObj.setHours(0,0,0,0);
    const calcNextDates = (id) => {
      const y = todayObj.getFullYear(), m = todayObj.getMonth(), d = todayObj.getDate();
      const events = [];
      const addEvent = (name, dObj) => { const diff = Math.round((dObj - todayObj) / 86400000); events.push({ name: name, dateStr: `${dObj.getMonth()+1}/${pad(dObj.getDate())}`, diff: diff, diffStr: diff === 0 ? '今天' : `${diff} 天後`}); };
      const getNextDow = (targets) => { let cur = todayObj.getDay(); let add = 7; targets.forEach(t => { let diff = (t - cur + 7) % 7; if (diff < add) add = diff; }); let res = new Date(todayObj); res.setDate(d + add); return res; };
      if (id === 'uber') { addEvent('趟獎結算', getNextDow([1, 4])); addEvent('發薪日', getNextDow([4])); } 
      else if (id === 'foodpanda') {
        const getPandaNext = (aY, aM, aD) => { const anchor = new Date(aY, aM, aD); const diffDays = Math.floor((todayObj - anchor) / 86400000); const daysToAdd = (14 - (diffDays % 14)) % 14; let res = new Date(todayObj); res.setDate(d + daysToAdd); return res; };
        addEvent('85% 取單率', getPandaNext(2020, 0, 12)); addEvent('明細寄發', getPandaNext(2020, 0, 15)); addEvent('發薪日', getPandaNext(2020, 0, 22));
      } else if (id === 'foodomo') {
        let nSettle = new Date(todayObj), nPay = new Date(todayObj);
        if (d <= 15) nSettle.setDate(15); else nSettle = new Date(y, m + 1, 0); 
        if (d <= 5) nPay.setDate(5); else if (d <= 20) nPay.setDate(20); else nPay = new Date(y, m + 1, 5);
        addEvent('結算日', nSettle); addEvent('發薪日', nPay);
      } else return null;
      return events;
    };

    if (activePlatforms.length) {
      activePlatforms.forEach(p => {
        const events = calcNextDates(p.id); if (!events) return;
        bottomHtml += `<div style="border: 2px solid ${p.color}; background: ${p.color}15; border-radius: 22px; padding: 8px 10px; margin-bottom: 5px;">
            <div style="display:flex; align-items:center; gap:5px; margin-bottom: 5px;">
              <div style="width:10px; height:10px; border-radius:50%; background:${p.color}; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.95);"></div>
              <span style="font-size:14px; font-weight:800; color:${p.color}; letter-spacing:0.5px;">${p.name}</span>
            </div>
            <div style="display:flex; gap:6px;">
              ${events.map(ev => {
                const isToday = ev.diff === 0; const dateColor = isToday ? 'var(--green)' : 'var(--t1)'; let diffColor = isToday ? 'var(--green)' : 'var(--t2)';
                let nameColor = 'var(--t3)'; 
                if (ev.name.includes('結算') || ev.name.includes('取單')) nameColor = 'var(--red)';
                else if (ev.name.includes('明細')) nameColor = 'var(--acc)';
                else if (ev.name.includes('發薪')) nameColor = 'var(--blue)';

                if (!isToday && (ev.name.includes('結算') || ev.name.includes('發薪') || ev.name.includes('明細') || ev.name.includes('取單'))) {
                  diffColor = '#22C55E';
                }

                return `<div style="flex:1; background: var(--sf); border: 1px solid var(--blue); border-radius: 16px; padding: 4px 4px; text-align: center; display:flex; flex-direction:column; justify-content:center;">
                  <span style="font-size:11px; color:${nameColor}; font-weight:800; margin-bottom:2px; letter-spacing:0.5px;">${ev.name}</span>
                  <span style="font-family:var(--mono); font-size:13px; font-weight:800; color:${dateColor};">
                    ${ev.dateStr} <span style="font-size:13px; font-weight:600; color:${diffColor};">(${ev.diffStr})</span>
                  </span>
                </div>`;
              }).join('')}
            </div></div>`;
      });
    } else { bottomHtml += `<div class="empty-tip">請先至「設定」頁，啟用平台</div>`; }
  } else if (S.homeSubTab === 'goal') {
    const weekly = pf(S.settings.goals?.weekly); const monthly = pf(S.settings.goals?.monthly);
    if (weekly > 0 || monthly > 0) {
      bottomHtml += `<div class="card" style="border: 2px solid var(--border);">`;
      if (weekly > 0) {
        const wDate = new Date(dateObj); const wDay = wDate.getDay() || 7; wDate.setDate(wDate.getDate() - wDay + 1); let weekTotal = 0;
        for(let i=0; i<7; i++) { const dStr = `${wDate.getFullYear()}-${pad(wDate.getMonth()+1)}-${pad(wDate.getDate())}`; weekTotal += getDayRecs(dStr).reduce((s,r)=>s+recTotal(r),0); wDate.setDate(wDate.getDate() + 1); }
        const wPct = Math.min(100, Math.round(weekTotal/weekly*100)); const wRemain = Math.max(0, weekly-weekTotal); const wColor = wPct >= 100 ? 'var(--green)' : wPct >= 70 ? 'var(--blue)' : 'var(--red)';
        bottomHtml += `<div style="margin-bottom: ${monthly>0 ? '16px' : '0'};">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <span style="font-size:13px;font-weight:700;color:var(--t2)">📊 本週目標進度</span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${wColor}">${wPct}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${wPct}%;background:${wColor}"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;">
            <span>已達 $ ${fmt(weekTotal)}</span><span>${wRemain>0?`還差 $ ${fmt(wRemain)}`:'🎉 已達標！'}</span>
          </div></div>`;
      }
      if (monthly > 0) {
        const monthRecs  = getMonthRecs(dateObj.getFullYear(), dateObj.getMonth()+1); const monthTotal = monthRecs.reduce((s,r)=>s+recTotal(r), 0);
        const mPct = Math.min(100, Math.round(monthTotal/monthly*100)); const mRemain = Math.max(0, monthly-monthTotal); const mColor = mPct >= 100 ? 'var(--green)' : mPct >= 70 ? 'var(--blue)' : 'var(--red)';
        bottomHtml += `<div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <span style="font-size:13px;font-weight:700;color:var(--t2)">📈 本月目標進度</span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${mColor}">${mPct}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${mPct}%;background:${mColor}"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-top:6px;font-weight:500;">
            <span>已達 $ ${fmt(monthTotal)}</span><span>${mRemain>0?`還差 $ ${fmt(mRemain)}`:'🎉 已達標！'}</span>
          </div></div>`;
      }
      bottomHtml += `</div>`;
    } else { bottomHtml += `<div class="empty-tip">請先至「設定」頁，設定目標</div>`; }
  }

  const topEl = document.getElementById('home-top-content'); const botEl = document.getElementById('home-bottom-content');
  if (topEl) topEl.innerHTML = topHtml; if (botEl) botEl.innerHTML = bottomHtml;
}

function punchIn() {
  const today = todayStr(); S.punch = { date: today, startTime: nowTime() };
  savePunch(); toast(`✅ 上線打卡：${S.punch.startTime}`); renderHome();
}
async function punchOut() {
  if (!S.punch) return;
  const ok = await customConfirm('<strong>【確認離線】</strong><br>確定要結束工作並下線嗎？');
  if (!ok) return;
  const endTime = nowTime(); const startMs = new Date(`${S.punch.date}T${S.punch.startTime}`).getTime(); const endMs = new Date(`${S.punch.date}T${endTime}`).getTime();
  const diffHours = Math.max(0, (endMs - startMs) / 3600000);
  const punchRecord = { id: newId(), date: S.punch.date, time: endTime, platformId: null, punchIn: S.punch.startTime, punchOut: endTime, hours: diffHours, isPunchOnly: true, note: '系統上下線記錄' };
  S.records.push(punchRecord); saveRecords(); S.punch = null; savePunch();
  toast('✅ 已離線！時數已記錄至歷史中'); renderHome();
}


/* ══════════════════════════════════════════════════════
   查看記錄 (含全螢幕大日曆)
   ══════════════════════════════════════════════════════ */
function buildRecItem(r) {
  if (r.isPunchOnly) {
    return `<div class="rec-item" data-id="${r.id}" style="background:var(--sf2); border: 1px dashed var(--t3);">
      <div class="rec-plat-dot" style="background:var(--t3)"></div>
      <div class="rec-info">
        <div class="rec-main" style="color:var(--t2);">🕒 上下線時間：${r.punchIn} → ${r.punchOut}</div>
        <div class="rec-sub">${r.note}</div>
      </div>
      <div class="rec-amt" style="color:var(--t2); font-size:14px;">⏱ ${fmtHours(r.hours)}</div>
    </div>`;
  }
  const plat = getPlatform(r.platformId); const total = recTotal(r); const chips = [];
  if (r.orders > 0) chips.push(`📦${r.orders}單`); if (r.hours > 0) chips.push(`⏱${fmtHours(r.hours)}`);
  const bonusBits = [];
  if (r.bonus > 0) bonusBits.push(`🎁${fmt(r.bonus)}`); if (r.tempBonus> 0) bonusBits.push(`⚡${fmt(r.tempBonus)}`); if (r.tips > 0) bonusBits.push(`🤑${fmt(r.tips)}`);
  return `<div class="rec-item" data-id="${r.id}">
    <div class="rec-plat-dot" style="background:${plat.color}"></div>
    <div class="rec-info">
      <div class="rec-plat-name">${plat.name}${r.time?` · ${r.time}`:''}</div>
      <div class="rec-main">${chips.map(c=>`<span class="rec-chip">${c}</span>`).join('')}${bonusBits.length?`<span class="rec-chip" style="color:var(--gold)">${bonusBits.join(' ')}</span>`:''}</div>
      ${r.note?`<div class="rec-sub">${r.note}</div>`:''}
    </div>
    <div class="rec-amt">+${fmt(total)}</div>
  </div>`;
}

if (!S.histTab) S.histTab = 'day';
if (!S.histNavDate) S.histNavDate = new Date();
if (!S.histFilter) S.histFilter = 'all';

function navHistGroup(dir, mode) {
  let d = new Date(S.histNavDate);
  if (mode === 'week')   d.setDate(d.getDate() + (dir * 7));
  if (mode === 'biweek') d.setDate(d.getDate() + (dir * 14));
  if (mode === 'month')  d.setMonth(d.getMonth() + dir);
  if (mode === 'year')   d.setFullYear(d.getFullYear() + dir);
  S.histNavDate = d; renderHistory();
}
function changeHistFilter(val) { S.histFilter = val; renderHistory(); }

function renderHistory() {
  if (S.histTab === 'day') renderHistDayView(); else renderHistGroupView(S.histTab);
}

function renderHistDayView() {
  const content = document.getElementById('hist-content');
  const { calY:y, calM:m } = S;
  content.innerHTML = `
    <div id="hist-header" style="flex-shrink:0;padding:0 16px 6px;background:transparent;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="mbtn" id="hist-prev">◀</button>
          <h2 id="hist-label" style="font-size:15px;font-weight:600;min-width:80px;text-align:center">${y} 年 ${m} 月</h2>
          <button class="mbtn" id="hist-next">▶</button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="icon-btn" onclick="openSearch()" title="搜尋記錄"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
          <button class="icon-btn" onclick="openFullCalendar()" title="大日曆"><img src="images/calendar.png" alt="日曆" style="width:16px;height:16px;opacity:0.7;"></button>
        </div>
      </div>
      <div class="month-grid" id="hist-calendar"></div>
      <div class="hist-divider"></div>
      <div id="hist-day-summary" style="margin:6px 0 4px;min-height:0"></div>
      <div class="sec-title" id="hist-day-label" style="margin-bottom:4px">指定日記錄</div>
    </div>
    <div id="hist-rec-list" style="flex:1;overflow-y:auto;padding:0 16px 24px;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:6px;"></div>
  `;
  document.getElementById('hist-prev').addEventListener('click', () => { S.calM--; if(S.calM<1){S.calM=12;S.calY--;} S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); });
  document.getElementById('hist-next').addEventListener('click', () => { S.calM++; if(S.calM>12){S.calM=1;S.calY++;} S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); });
  renderHistCalendarGrid();
  renderHistRecords(S.selDate);
}

function renderHistCalendarGrid() {
  const { calY:y, calM:m } = S;
  const grid = document.getElementById('hist-calendar');
  const first = new Date(y, m-1, 1).getDay(); const days  = new Date(y, m, 0).getDate(); const DOW = ['日','一','二','三','四','五','六'];
  let html = `<div class="month-row">`;
  DOW.forEach(d => { html += `<div class="month-cell month-dow">${d}</div>`; }); html += `</div><div class="month-row">`;
  let col = 0;
  for (let i=0; i<first; i++) { html += `<div class="month-cell"></div>`; col++; }
  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`; const sum = getDayRecs(ds).reduce((s,r)=>s+recTotal(r), 0);
    const cls = ['month-cell', ds===todayStr()?'today':'', ds===S.selDate?'sel':''].filter(Boolean).join(' ');
    const dotHtml = sum > 0 ? `<div class="has-rec-dot"></div>` : '';
    html += `<div class="${cls}" data-ds="${ds}">${dotHtml}<div class="day-num">${day}</div></div>`;
    col++; if (col % 7 === 0 && day < days) { html += `</div><div class="month-row">`; }
  }
  html += `</div>`; grid.innerHTML = html;
  grid.querySelectorAll('.month-cell[data-ds]').forEach(cell => {
    cell.addEventListener('click', () => { S.selDate = cell.dataset.ds; grid.querySelectorAll('.month-cell').forEach(c => c.classList.toggle('sel', c.dataset.ds === S.selDate)); renderHistRecords(S.selDate); });
  });
}

function renderHistGroupView(mode) {
  const content = document.getElementById('hist-content');
  const nd = new Date(S.histNavDate); let startD, endD, labelStr;
  
  if (mode === 'week') {
    const day = nd.getDay() || 7; startD = new Date(nd); startD.setDate(startD.getDate() - day + 1); endD = new Date(startD); endD.setDate(endD.getDate() + 6);
    labelStr = `${pad(startD.getMonth()+1)}/${pad(startD.getDate())} ~ ${pad(endD.getMonth()+1)}/${pad(endD.getDate())}`;
  } else if (mode === 'biweek') {
    const anchor = new Date(2025, 10, 10); const diffTime = (new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), 12)).getTime() - anchor.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); const cycleOffset = Math.floor(diffDays / 14); 
    startD = new Date(anchor); startD.setDate(startD.getDate() + cycleOffset * 14); endD = new Date(startD); endD.setDate(endD.getDate() + 13);
    let yearPrefix = (startD.getFullYear() !== endD.getFullYear()) ? `${startD.getFullYear()}/` : '';
    labelStr = `${yearPrefix}${pad(startD.getMonth()+1)}/${pad(startD.getDate())} ~ ${pad(endD.getMonth()+1)}/${pad(endD.getDate())}`;
  } else if (mode === 'month') {
    startD = new Date(nd.getFullYear(), nd.getMonth(), 1); endD = new Date(nd.getFullYear(), nd.getMonth() + 1, 0); labelStr = `${nd.getFullYear()}年 ${nd.getMonth()+1}月`;
  } else if (mode === 'year') {
    startD = new Date(nd.getFullYear(), 0, 1); endD = new Date(nd.getFullYear(), 11, 31); labelStr = `${nd.getFullYear()}年`;
  }

  const sStr = `${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}`;
  const eStr = `${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}`;
  let recs = S.records.filter(r => !r.isPunchOnly && r.date >= sStr && r.date <= eStr);
  if (S.histFilter !== 'all') recs = recs.filter(r => r.platformId === S.histFilter);
  let platOpts = `<option value="all">全部平台</option>` + S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}" ${S.histFilter===p.id?'selected':''}>${p.name}</option>`).join('');
  
  let html = `<div style="padding: 0 16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; background:var(--sf); padding:8px; border-radius:12px; border:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="mbtn" onclick="navHistGroup(-1, '${mode}')">◀</button>
          <span style="font-family:var(--mono); font-size:14px; font-weight:700; width:125px; text-align:center; color:var(--acc); letter-spacing:0.5px;">${labelStr}</span>
          <button class="mbtn" onclick="navHistGroup(1, '${mode}')">▶</button>
        </div>
        <select class="fsel" style="width:auto; padding:6px 10px; font-size:13px; font-weight:600;" onchange="changeHistFilter(this.value)">${platOpts}</select>
      </div></div>`;
  html += `<div style="padding: 0 16px 24px; flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">`;
  
  if (recs.length === 0) { html += `<div class="empty-tip">沒有資料</div>`; } else {
    const tInc = recs.reduce((s,r) => s + recTotal(r), 0); const tOrd = recs.reduce((s,r) => s + pf(r.orders), 0); const tHrs = recs.reduce((s,r) => s + pf(r.hours), 0);
    const tBonus = recs.reduce((s,r) => s + pf(r.bonus), 0); const tTemp = recs.reduce((s,r) => s + pf(r.tempBonus), 0); const tTips = recs.reduce((s,r) => s + pf(r.tips), 0);
    html += buildSummaryCard('區間總計', tInc, tOrd, tHrs, tBonus, tTemp, tTips, 'hist-group-card');
    html += recs.sort((a,b)=>b.date.localeCompare(a.date) || (a.time||'').localeCompare(b.time||'')).map(r => buildRecItem(r)).join('');
  }
  html += `</div>`; content.innerHTML = html;
}

function openFullCalendar() { document.getElementById('full-calendar-overlay').classList.add('show'); renderFullCalendar(); }
function closeFullCalendar() { document.getElementById('full-calendar-overlay').classList.remove('show'); }
function changeFullCalMonth(offset) { S.calM += offset; if(S.calM < 1) { S.calM = 12; S.calY--; } if(S.calM > 12) { S.calM = 1; S.calY++; } renderFullCalendar(); S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); }

function renderFullCalendar() {
  const { calY:y, calM:m } = S; document.getElementById('fc-title').textContent = `${y}年 ${m}月`;
  const DOW = ['週日','週一','週二','週三','週四','週五','週六']; document.getElementById('fc-dow').innerHTML = DOW.map(d => `<div class="fc-dow-cell">${d}</div>`).join('');
  const grid = document.getElementById('fc-grid'); const first = new Date(y, m-1, 1).getDay(); const days = new Date(y, m, 0).getDate(); const today = todayStr();
  let html = ``; const prevDays = new Date(y, m-1, 0).getDate();
  for (let i=first-1; i>=0; i--) { html += `<div class="fc-cell empty"><div class="fc-date" style="color:var(--t3);">${prevDays - i}</div></div>`; }
  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`; const sum = getDayRecs(ds).reduce((s,r)=>s+recTotal(r), 0); const isToday = ds === today; const amtHtml = sum > 0 ? `<div class="fc-amt">$${fmt(sum)}</div>` : '';
    html += `<div class="fc-cell ${isToday ? 'today' : ''}" onclick="S.selDate='${ds}'; closeFullCalendar(); renderHistory();"><div class="fc-date">${pad(day)}</div>${amtHtml}</div>`;
  }
  const totalCells = first + days; const remain = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i=1; i<=remain; i++) { html += `<div class="fc-cell empty"><div class="fc-date" style="color:var(--t3);">${pad(i)}</div></div>`; }
  grid.innerHTML = html;
}

function renderHistRecords(ds) {
  const d = new Date(ds+'T00:00:00'); const dow = ['日','一','二','三','四','五','六'][d.getDay()];
  document.getElementById('hist-day-label').textContent = `${d.getMonth()+1} 月 ${d.getDate()} 日（星期${dow}）記錄`;
  const recs = getDayRecs(ds); const total = recs.reduce((s,r)=>s+recTotal(r), 0); const sumEl = document.getElementById('hist-day-summary');
  if (total > 0) {
    const orders = recs.reduce((s,r)=>s+pf(r.orders), 0); const hours = recs.reduce((s,r)=>s+pf(r.hours), 0);
    const dayBonus = recs.reduce((s,r)=>s+pf(r.bonus), 0); const dayTemp = recs.reduce((s,r)=>s+pf(r.tempBonus), 0); const dayTips = recs.reduce((s,r)=>s+pf(r.tips), 0);
    sumEl.innerHTML = buildSummaryCard('當日', total, orders, hours, dayBonus, dayTemp, dayTips, 'hist-day-card');
  } else { sumEl.innerHTML = ''; }
  const listEl = document.getElementById('hist-rec-list');
  if (!recs.length) { listEl.innerHTML = `<div class="empty-tip">✨ 這天沒有記錄</div>`; return; }
  listEl.innerHTML = recs.slice().sort((a,b)=>(a.time||'').localeCompare(b.time||'')).map(r => buildRecItem(r)).join('');
  listEl.querySelectorAll('.rec-item[data-id]').forEach(el => { el.addEventListener('click', () => openDetailOverlay(el.dataset.id)); });
}

function openDetailOverlay(id) {
  const r = S.records.find(r=>r.id===id); if (!r) return;
  const plat = getPlatform(r.platformId); const total = recTotal(r);
  const rows = [
    ['🏪 平台', `<span style="color:${plat.color};font-weight:600">${plat.name}</span>`], ['📆 日期', r.date],
    ['⏱ 打卡', r.punchIn&&r.punchOut?`${r.punchIn} → ${r.punchOut}`:(r.punchIn?r.punchIn:'—')],
    ['🕐 工時', r.hours>0?fmtHours(r.hours):'—'], ['📦 接單數', r.orders>0?`${r.orders} 單`:'—'],
    ['💰 行程收入',`NT$ ${fmt(r.income)}`], ['🎁 固定獎勵',r.bonus>0?`NT$ ${fmt(r.bonus)}`:'—'],
    ['⚡ 臨時獎勵',r.tempBonus>0?`NT$ ${fmt(r.tempBonus)}`:'—'], ['🤑 小費', r.tips>0?`NT$ ${fmt(r.tips)}`:'—'], ['📝 備註', r.note||'—'],
  ];
  document.getElementById('detail-body').innerHTML = `
    <div style="text-align:center;padding:10px 0 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:13px;color:var(--t3);margin-bottom:4px">本筆總收入</div>
      <div style="font-family:var(--mono);font-size:38px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div>
    </div>
    <div style="margin-top:12px">${rows.map(([l,v])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--t3)">${l}</span><span style="font-size:13px;font-weight:500">${v}</span></div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button onclick="closeDetailOverlay();openAddPage(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--acc-d);color:var(--acc);border:1px solid rgba(255,107,53,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">✎ 編輯</button>
      <button onclick="deleteRecord('${r.id}')" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--red-d);color:var(--red);border:1px solid rgba(239,68,68,.3);font-size:14px;font-family:var(--sans);cursor:pointer;font-weight:600">🗑 刪除</button>
    </div>`;
  document.getElementById('detail-overlay').classList.add('show');
}
async function deleteRecord(id) {
  closeDetailOverlay(); const ok = await customConfirm('確定要刪除這筆記錄嗎？<br><strong>此動作無法復原。</strong>'); if (!ok) return;
  S.records = S.records.filter(r=>r.id!==id); saveRecords(); toast('已刪除');
  if (S.tab==='home') renderHome(); if (S.tab==='history') renderHistory();
}

function openSearch() { openOverlay('search-page'); document.getElementById('search-kw').focus(); }
function doSearch() {
  const kw = document.getElementById('search-kw').value.trim().toLowerCase();
  const from = document.getElementById('search-from').value; const to = document.getElementById('search-to').value;
  const el = document.getElementById('search-results');
  let recs = S.records.filter(r => {
    if (from && r.date < from) return false; if (to && r.date > to) return false; if (!kw) return true;
    const plat = getPlatform(r.platformId).name.toLowerCase();
    return plat.includes(kw) || (r.note||'').toLowerCase().includes(kw) || String(recTotal(r)).includes(kw) || String(r.orders||'').includes(kw);
  }).sort((a,b)=>b.date.localeCompare(a.date));
  if (!recs.length) { el.innerHTML = `<div class="empty-tip">找不到符合記錄</div>`; return; }
  el.innerHTML = recs.map(r=>buildRecItem(r)).join('');
  el.querySelectorAll('.rec-item[data-id]').forEach(item => { item.addEventListener('click', () => { closeOverlay('search-page'); openDetailOverlay(item.dataset.id); }); });
}
document.getElementById('search-kw').addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });


/* ══════════════════════════════════════════════════════
   新增／編輯記錄 (外送)
   ══════════════════════════════════════════════════════ */
function openAddPage(record=null, prefill={}) {
  S.editingId = record ? record.id : null; 
  S.selPlatformId = record ? record.platformId : (S.platforms.find(p=>p.active)?.id||null);
  document.getElementById('add-page-title').textContent = record ? '編輯記錄' : '新增記錄';
  document.getElementById('f-date').value = record?.date || prefill.date || S.selDate || todayStr();
  
  let totalHours = pf(record?.hours || prefill.hours || 0);
  let h = Math.floor(totalHours); let m = Math.round((totalHours - h) * 60);
  document.getElementById('f-hrs-val').value = h > 0 ? h : ''; document.getElementById('f-min-val').value = m > 0 ? m : '';
  document.getElementById('f-orders').value = record?.orders || ''; document.getElementById('f-income').value = record?.income || '';
  document.getElementById('f-bonus').value = record?.bonus || ''; document.getElementById('f-temp-bonus').value = record?.tempBonus || '';
  document.getElementById('f-tips').value = record?.tips || ''; document.getElementById('f-note').value = record?.note || '';
  
  renderPlatformChips(); calcAddTotal(); goPage('add');
}

function renderPlatformChips() {
  const container = document.getElementById('platform-chips'); const active = S.platforms.filter(p=>p.active);
  if (!S.selPlatformId && active.length) S.selPlatformId = active[0].id;
  container.innerHTML = active.map(p => `<div class="platform-chip${S.selPlatformId===p.id?' on':''}" style="${S.selPlatformId===p.id?`background:${p.color};border-color:${p.color}`:''}" onclick="selectPlatform('${p.id}')"><span>${p.name}</span></div>`).join('');
}
function selectPlatform(id) { S.selPlatformId = id; renderPlatformChips(); }
function calcAddTotal() {
  const income = pf(document.getElementById('f-income').value); const bonus = pf(document.getElementById('f-bonus').value); const tempBonus = pf(document.getElementById('f-temp-bonus').value); const tips = pf(document.getElementById('f-tips').value);
  const total = income + bonus + tempBonus + tips; document.getElementById('add-total-val').textContent = fmt(total);
}
function addWeatherTag(tag) { const noteEl = document.getElementById('f-note'); if (!noteEl.value.includes(tag)) { noteEl.value = (noteEl.value + ' ' + tag).trim(); } }

function confirmAddRecord() {
  const checkImg = document.getElementById('add-save-img'); const checkBtn = document.getElementById('add-save-btn');
  if (checkBtn.disabled) return;
  if (!S.selPlatformId) { toast('請先選擇平台'); return; }
  const income = pf(document.getElementById('f-income').value); const bonus = pf(document.getElementById('f-bonus').value); const temp = pf(document.getElementById('f-temp-bonus').value); const tips = pf(document.getElementById('f-tips').value);
  if (income + bonus + temp + tips <= 0) { toast('請輸入至少一項收入金額'); return; }

  checkBtn.disabled = true; 
  checkImg.src = 'images/Check2.png'; 
  checkImg.style.transform = 'scale(1.3)';
  toast('⏳ 記錄儲存中...', 3000); 

  setTimeout(() => {
    checkImg.style.transform = 'scale(1)';
    const h = pf(document.getElementById('f-hrs-val').value); const m = pf(document.getElementById('f-min-val').value); const totalHours = h + (m / 60);
    const rec = { id: S.editingId || newId(), date: document.getElementById('f-date').value || todayStr(), time: nowTime(), platformId: S.selPlatformId, punchIn: '', punchOut: '', hours: totalHours, orders: pf(document.getElementById('f-orders').value), income, bonus, tempBonus: temp, tips, note: document.getElementById('f-note').value.trim() };
    if (S.editingId) { const idx = S.records.findIndex(r => r.id === S.editingId); if (idx >= 0) S.records[idx] = rec; toast('✅ 記錄已更新'); } 
    else { S.records.push(rec); toast('✅ 記錄成功！'); }
    saveRecords(); S.editingId = null; checkImg.src = 'images/Check1.png'; checkBtn.disabled = false; goPage('home'); 
  }, 3000); 
}


/* ══════════════════════════════════════════════════════
   收入分析 (報表)
   ══════════════════════════════════════════════════════ */
function renderReport() {
  document.getElementById('rpt-label').textContent = `${S.rptY} 年 ${S.rptM} 月`;
  if (S.rptView === 'overview') renderRptOverview(); if (S.rptView === 'trend') renderRptTrend();
  if (S.rptView === 'compare') renderRptCompare(); if (S.rptView === 'top3') renderRptTop3();
}
document.getElementById('rpt-prev').addEventListener('click', ()=>{ S.rptM--; if(S.rptM<1){S.rptM=12;S.rptY--;} renderReport(); });
document.getElementById('rpt-next').addEventListener('click', ()=>{ S.rptM++; if(S.rptM>12){S.rptM=1;S.rptY++;} renderReport(); });

function renderRptOverview() {
  const recs = getMonthRecs(S.rptY, S.rptM);
  const total = recs.reduce((s,r)=>s+recTotal(r), 0); const income = recs.reduce((s,r)=>s+pf(r.income), 0);
  const bonus = recs.reduce((s,r)=>s+pf(r.bonus)+pf(r.tempBonus), 0); const tips = recs.reduce((s,r)=>s+pf(r.tips), 0);
  const orders = recs.reduce((s,r)=>s+pf(r.orders), 0); const hours = recs.reduce((s,r)=>s+pf(r.hours), 0);

  let html = `
  <div class="card">
    <div style="display:flex;gap:8px;margin-bottom:12px"><div style="flex:1;text-align:center"><div style="font-family:var(--mono);font-size:26px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div><div style="font-size:11px;color:var(--t3);margin-top:2px">本月總收入</div></div></div>
    <div class="rpt-divider"></div>
    <div class="rpt-total-row"><span class="rt-lbl">💰 行程收入</span><span class="rt-val" style="color:var(--green)">NT$ ${fmt(income)}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">🎁 獎勵小計</span><span class="rt-val" style="color:var(--gold)">NT$ ${fmt(bonus)}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">🤑 小費小計</span><span class="rt-val" style="color:var(--blue)">NT$ ${fmt(tips)}</span></div>
    <div class="rpt-divider"></div>
    <div class="rpt-total-row"><span class="rt-lbl">📦 接單數</span><span class="rt-val">${fmt(orders)} 單</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">⏱ 累計工時</span><span class="rt-val">${fmtHours(hours)}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">💵 平均時薪</span><span class="rt-val" style="color:var(--acc)">${hours>0?`NT$ ${fmt(Math.round(total/hours))}/h`:'—'}</span></div>
    <div class="rpt-total-row"><span class="rt-lbl">📦 平均每單</span><span class="rt-val" style="color:var(--acc)">${orders>0?`NT$ ${fmt(Math.round(total/orders))}/單`:'—'}</span></div>
  </div>`;

  const platData = S.platforms.filter(p=>p.active).map(p=>({ name: p.name, color: p.color, val: recs.filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0) })).filter(p=>p.val>0);
  if (platData.length > 1) {
    html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">各平台佔比</div><div style="position:relative;height:220px;margin-bottom:10px"><canvas id="plat-pie"></canvas></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${platData.map(p=>{ const pct = total>0?Math.round(p.val/total*100):0; return `<div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0"></div><span style="flex:1;font-size:13px">${p.name}</span><span style="font-family:var(--mono);font-size:13px;color:var(--t2)">${pct}%</span><span style="font-family:var(--mono);font-size:13px;font-weight:600">NT$ ${fmt(p.val)}</span></div>`; }).join('')}
      </div></div>`;
  }
  if (total > 0 && (bonus>0||tips>0)) {
    html += `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:10px">收入結構</div><div style="position:relative;height:200px"><canvas id="income-pie"></canvas></div>
      <div style="display:flex;justify-content:space-around;margin-top:10px;font-size:12px;text-align:center">
        <div><div style="color:var(--green);font-family:var(--mono);font-weight:600">${total>0?Math.round(income/total*100):0}%</div><div style="color:var(--t3)">行程</div></div>
        <div><div style="color:var(--gold);font-family:var(--mono);font-weight:600">${total>0?Math.round(bonus/total*100):0}%</div><div style="color:var(--t3)">獎勵</div></div>
        <div><div style="color:var(--blue);font-family:var(--mono);font-weight:600">${total>0?Math.round(tips/total*100):0}%</div><div style="color:var(--t3)">小費</div></div>
      </div></div>`;
  }
  document.getElementById('rv-overview').innerHTML = html;
  if (platData.length>1) drawPie('plat-pie', platData.map(p=>p.name), platData.map(p=>p.val), platData.map(p=>p.color));
  if (total>0&&(bonus>0||tips>0)) drawPie('income-pie',['行程','獎勵','小費'],[income,bonus,tips],['#22C55E','#F59E0B','#3B82F6']);
}

function renderRptTrend() {
  const el = document.getElementById('rv-trend');
  const trends = [
    { key:'week',  label:'7天趨勢',   getDays: () => Array.from({length:7}, (_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}) },
    { key:'month', label:'本月趨勢',   getDays: () => { const n=new Date(S.rptY,S.rptM,0).getDate(); return Array.from({length:n},(_,i)=>`${S.rptY}-${pad(S.rptM)}-${pad(i+1)}`); } },
    { key:'year',  label:'年趨勢',    getDays: () => Array.from({length:12},(_,i)=>null) },
  ];
  const curT = S.trendMode||'month'; const trend = trends.find(t=>t.key===curT)||trends[1];

  let html = `<div style="display:flex;gap:6px;margin-bottom:10px">
    ${trends.map(t=>`<button onclick="S.trendMode='${t.key}';renderRptTrend()" style="flex:1;padding:6px;border-radius:var(--rs);border:1px solid ${curT===t.key?'var(--acc)':'var(--border)'};background:${curT===t.key?'var(--acc-d)':'var(--sf2)'};color:${curT===t.key?'var(--acc)':'var(--t2)'};font-size:12px;cursor:pointer;font-family:var(--sans)">${t.label}</button>`).join('')}
  </div><div class="card"><div style="position:relative;height:${curT==='year'?180:220}px"><canvas id="trend-chart"></canvas></div></div>`;

  if (curT === 'year') {
    const months = Array.from({length:12},(_,i)=>i+1); const labels = months.map(m=>`${m}月`); const data = months.map(m=>getMonthRecs(S.rptY,m).reduce((s,r)=>s+recTotal(r),0));
    html += `<div class="card"><div class="rpt-divider" style="margin-bottom:8px"></div><div class="rpt-total-row"><span class="rt-lbl">全年總收入</span><span class="rt-val" style="color:var(--green)">NT$ ${fmt(data.reduce((a,b)=>a+b,0))}</span></div><div class="rpt-total-row"><span class="rt-lbl">月均收入</span><span class="rt-val">NT$ ${fmt(Math.round(data.reduce((a,b)=>a+b,0)/12))}</span></div></div>`;
    el.innerHTML = html; drawLine('trend-chart', labels, [{ label:'月收入', data, color:'#FF6B35' }]); return;
  }
  const days = trend.getDays(); const labels = days.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;}); const data = days.map(d=>getDayRecs(d).reduce((s,r)=>s+recTotal(r),0));
  el.innerHTML = html; drawLine('trend-chart', labels, [{ label:'日收入', data, color:'#FF6B35' }]);
}

function renderRptCompare() {
  const el = document.getElementById('rv-compare'); const thisRecs = getMonthRecs(S.rptY, S.rptM); const thisTotal = thisRecs.reduce((s,r)=>s+recTotal(r),0);
  const comparisons = [
    { label:'上個月', y:S.rptM>1?S.rptY:S.rptY-1, m:S.rptM>1?S.rptM-1:12 }, { label:'去年同月', y:S.rptY-1, m:S.rptM }, { label:'前年同月', y:S.rptY-2, m:S.rptM }
  ].map(c=>({ ...c, total: getMonthRecs(c.y,c.m).reduce((s,r)=>s+recTotal(r),0) }));
  const maxV = Math.max(thisTotal, ...comparisons.map(c=>c.total), 1);
  let html = `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:12px">📊 與歷史比較</div><div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="font-weight:600;color:var(--acc)">${S.rptY}年${S.rptM}月（本月）</span><span style="font-family:var(--mono);font-weight:700;color:var(--green)">NT$ ${fmt(thisTotal)}</span></div><div class="progress-track" style="height:10px"><div class="progress-fill" style="width:100%;background:var(--acc)"></div></div></div>
    ${comparisons.map(c=>{
      const pct = maxV>0?Math.round(c.total/maxV*100):0; const diff = thisTotal - c.total; const diffStr = diff===0?'持平':(diff>0?`+NT$ ${fmt(diff)}`:`-NT$ ${fmt(Math.abs(diff))}`); const diffColor = diff>0?'var(--green)':diff<0?'var(--red)':'var(--t3)';
      return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span>${c.label}（${c.y}/${pad(c.m)}）</span><div style="display:flex;gap:8px;align-items:baseline"><span style="font-family:var(--mono);color:var(--t2)">NT$ ${fmt(c.total)}</span><span style="font-size:11px;color:${diffColor};font-weight:600">${diffStr}</span></div></div><div class="progress-track" style="height:6px"><div class="progress-fill" style="width:${pct}%;background:var(--t3)"></div></div></div>`;
    }).join('')}</div>`;
  el.innerHTML = html;
}

function renderRptTop3() {
  const el = document.getElementById('rv-top3'); const monthRecs = getMonthRecs(S.rptY, S.rptM); const dayMap = {};
  monthRecs.forEach(r => { dayMap[r.date] = (dayMap[r.date]||0) + recTotal(r); });
  const sorted = Object.entries(dayMap).sort((a,b)=>b[1]-a[1]); const medals = ['🥇','🥈','🥉'];
  let html = `<div class="card"><div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:12px">🏆 本月收入 TOP 3 日</div>`;
  if (!sorted.length) { html += `<div class="empty-tip">本月暫無記錄</div>`; } else {
    sorted.slice(0,3).forEach(([date,total],i) => {
      const d = new Date(date+'T00:00:00'); const recs = getDayRecs(date); const orders = recs.reduce((s,r)=>s+pf(r.orders),0); const hours = recs.reduce((s,r)=>s+pf(r.hours),0);
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><span style="font-size:28px">${medals[i]||'▶'}</span><div style="flex:1"><div style="font-size:14px;font-weight:600">${date} （${['日','一','二','三','四','五','六'][d.getDay()]}）</div><div style="font-size:11px;color:var(--t3);margin-top:2px">${orders>0?`${orders}單 `:''}${hours>0?`${fmtHours(hours)} `:''}</div></div><div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--green)">NT$ ${fmt(total)}</div></div>`;
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
  S.charts[canvasId] = new Chart(ctx, { type: 'line', data: { labels, datasets: datasets.map(d=>({ label:d.label, data:d.data, borderColor:d.color, backgroundColor:d.color+'22', borderWidth:2, pointRadius:3, tension:.3, fill:true }))}, options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} }, scales:{ x:{ticks:{font:{size:9},maxRotation:45,autoSkip:true}}, y:{ticks:{callback:v=>v>=1000?Math.round(v/1000)+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} }, animation:{ duration:400 } } });
}
function drawBar(canvasId, labels, data, color) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels, datasets:[{ data, backgroundColor:color+'99', borderRadius:6, borderWidth:0 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} }, scales:{ x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{callback:v=>v>=1000?Math.round(v/1000)+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} }, animation:{ duration:400 } } });
}


/* ══════════════════════════════════════════════════════
   車輛管理 (主畫面列表與總結)
   ══════════════════════════════════════════════════════ */
function changeVehMonth(offset) {
  S.vehM += offset;
  if (S.vehM < 1) { S.vehM = 12; S.vehY--; }
  if (S.vehM > 12) { S.vehM = 1; S.vehY++; }
  renderVehicles();
}

function selectVehicle(id) {
  S.selVehicleId = id; renderVehicles();
}

function renderVehicles() {
  const container = document.getElementById('vehicle-content');
  const selectorContainer = document.getElementById('veh-selector-container');
  document.getElementById('veh-month-label').textContent = `${S.vehY} 年 ${S.vehM} 月`;
  
  if (S.vehicles.length === 0) {
    selectorContainer.innerHTML = '';
    container.innerHTML = `<div class="empty-tip">請點擊右上角新增車輛</div>`; return;
  }
  if (!S.selVehicleId || !S.vehicles.find(v => v.id === S.selVehicleId)) S.selVehicleId = S.vehicles[0].id;

  let selectorHtml = `<div style="display:flex; gap:12px; margin-bottom:12px; overflow-x:auto; padding:4px;">`;
  S.vehicles.forEach(v => {
    const isActive = v.id === S.selVehicleId;
    selectorHtml += `
      <div style="position:relative; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:56px; cursor:pointer;" onclick="selectVehicle('${v.id}')">
        <div onclick="event.stopPropagation(); deleteVehicle('${v.id}')" style="position:absolute; top:-6px; right:-6px; background:var(--red); color:#fff; border-radius:50%; width:18px; height:18px; font-size:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; box-shadow:0 2px 4px rgba(239,68,68,0.3);">✕</div>
        <div style="width:50px; height:50px; border-radius:14px; background:#fff; border:2px solid ${isActive ? 'var(--acc)' : 'transparent'}; display:flex; align-items:center; justify-content:center; transition:0.2s; box-shadow:${isActive ? '0 4px 10px rgba(255,107,53,0.2)' : '0 2px 6px rgba(0,0,0,0.06)'};">
          <div class="scooter-mask" style="background-color:${v.color}; -webkit-mask-image:url('images/scooter${v.icon}.png');"></div>
        </div>
        <span style="font-size:11px; font-weight:${isActive?'700':'600'}; color:${isActive?'var(--acc)':'var(--t2)'};">${v.name}</span>
      </div>`;
  });
  selectorHtml += `</div>`;
  selectorContainer.innerHTML = selectorHtml;

  let html = '';
  const prefix = `${S.vehY}-${pad(S.vehM)}`;
  const monthRecs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.date.startsWith(prefix));
  const fuelRecs = monthRecs.filter(r => r.type === 'fuel');
  const maintRecs = monthRecs.filter(r => r.type === 'maintenance');
  
  let totalDistance = 0, totalLiters = 0, totalFuelPaid = 0, totalDiscount = 0, totalMaintPaid = 0;
  fuelRecs.forEach(r => {
    const diff = pf(r.km) - pf(r.prevKm);
    if (diff > 0) totalDistance += diff;
    totalLiters += pf(r.liters); totalFuelPaid += pf(r.amount); totalDiscount += pf(r.discount);
  });
  maintRecs.forEach(r => totalMaintPaid += pf(r.amount));
  const avgPrice = totalLiters > 0 ? (totalFuelPaid / totalLiters).toFixed(1) : 0;
  const avgKmL = totalLiters > 0 ? (totalDistance / totalLiters).toFixed(1) : 0;

  if (S.vehicleTab === 'fuel') {
    html += `
      <div class="veh-summary-fuel">
        <div style="font-size:13px; font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between;">
          <span>⛽ 本月燃料總計</span> <span class="veh-sum-val">$${fmt(totalFuelPaid)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px;">
          <div><span class="veh-sum-lbl">加油</span><br><span style="font-weight:700;">${totalLiters.toFixed(1)} L</span></div>
          <div><span class="veh-sum-lbl">跑了</span><br><span style="font-weight:700;">${fmt(totalDistance)} km</span></div>
          <div><span class="veh-sum-lbl">油耗</span><br><span style="font-weight:700;">${avgKmL} km/L</span></div>
        </div>
      </div>`;
  } else {
    html += `
      <div class="veh-summary-maint">
        <div style="font-size:13px; font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between;">
          <span>🔧 本月保養總計</span> <span class="veh-sum-val">$${fmt(totalMaintPaid)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px;">
          <div><span class="veh-sum-lbl">本月保養次數</span><br><span style="font-weight:700;">${maintRecs.length} 筆</span></div>
        </div>
      </div>`;
  }

  const typeRecs = monthRecs.filter(r => r.type === S.vehicleTab);
  if (typeRecs.length === 0) {
    html += `<div class="empty-tip">本月尚未新增資料</div>`;
  } else {
    typeRecs.sort((a,b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||'')).forEach(r => {
      const isFuel = r.type === 'fuel';
      const icon = isFuel ? '⛽' : '🔧';
      const mainText = isFuel ? `${r.fuelType||'95 無鉛'} ($${r.price||0}/L)` : r.items.join(', ');
      const kmText = isFuel ? `${r.prevKm} → ${r.km} km` : `${r.km} km`;
      
      html += `
        <div onclick="openAddVehRec('${r.id}')" style="background:var(--sf); border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-bottom:8px; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:6px;">
            <div style="font-size:13px; font-weight:700; color:var(--t1);">${icon} ${mainText}</div>
            <div style="font-family:var(--mono); font-size:16px; font-weight:800; color:var(--acc);">-$${fmt(r.amount)}</div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11px; font-family:var(--mono); color:var(--t2);">${kmText}</div>
            <div style="font-size:11px; font-weight:600; color:var(--t3);">${r.date.slice(5)} ${r.time||''}</div>
          </div>
        </div>`;
    });
  }
  container.innerHTML = html;
}

async function deleteVehicle(id) {
  const ok = await customConfirm('確定要刪除這台車輛嗎？<br><span style="color:var(--red); font-size:12px;">⚠️ 該車的所有記錄將一併刪除且無法復原</span>');
  if(!ok) return;
  S.vehicles = S.vehicles.filter(v => v.id !== id); S.vehicleRecs = S.vehicleRecs.filter(r => r.vehicleId !== id); 
  if (S.selVehicleId === id) S.selVehicleId = null; 
  saveVehicles(); saveVehicleRecs(); renderVehicles(); toast('車輛與記錄已刪除');
}


/* ══════════════════════════════════════════════════════
   新增／編輯 車輛與車輛記錄表單 (整合)
   ══════════════════════════════════════════════════════ */
let editingVehRecId = null; 

function openAddVehRec(recordId = null) {
  editingVehRecId = recordId;
  const isEdit = !!recordId;
  if (!isEdit && S.vehicles.length === 0) { toast('請先新增車輛'); return; }
  
  document.getElementById('veh-rec-title').textContent = isEdit ? '編輯車輛記錄' : '新增車輛記錄';
  document.getElementById('veh-rec-del-btn').style.display = isEdit ? 'block' : 'none';

  const vehChips = document.getElementById('veh-rec-veh-icons');
  vehChips.innerHTML = S.vehicles.map(v => {
    const isActive = v.id === S.selVehicleId;
    return `
    <div style="display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer;" onclick="S.selVehicleId='${v.id}'; openAddVehRec('${recordId||''}');">
      <div style="width:40px; height:40px; border-radius:10px; background:#fff; border:2px solid ${isActive ? 'var(--acc)' : 'transparent'}; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <div class="scooter-mask" style="background-color:${v.color}; -webkit-mask-image:url('images/scooter${v.icon}.png'); width:24px; height:24px;"></div>
      </div>
      <span style="font-size:10px; font-weight:${isActive?'700':'500'}; color:${isActive?'var(--acc)':'var(--t2)'};">${v.name}</span>
    </div>`;
  }).join('');

  let r = null;
  if (isEdit) { r = S.vehicleRecs.find(x => x.id === recordId); S.addVehRecType = r.type; } else { S.addVehRecType = S.vehicleTab; }

  document.getElementById('vr-date').value = r ? r.date : todayStr();
  document.getElementById('vr-time').value = r ? (r.time || nowTime()) : nowTime();

  if (S.addVehRecType === 'fuel') {
    document.getElementById('vr-fuel-type').value = r?.fuelType || '95';
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
    currentSelItems = r ? [...r.items] : [];
    document.getElementById('vm-items-container').innerHTML = MAINT_ITEMS.map(item => `<div class="item-chip ${currentSelItems.includes(item) ? 'on' : ''}" onclick="toggleMaintItem(this, '${item}')">${item}</div>`).join('');
    renderShopHistory();
  }

  switchVehFormTab(S.addVehRecType, S.addVehRecType === 'fuel' ? 0 : 1);
  openOverlay('veh-rec-add-page');
}

function switchVehFormTab(type, index) {
  S.addVehRecType = type;
  document.getElementById('veh-form-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.getElementById('btn-form-fuel').classList.toggle('active', type === 'fuel');
  document.getElementById('btn-form-maint').classList.toggle('active', type === 'maintenance');
  document.getElementById('form-area-fuel').style.display = type === 'fuel' ? 'block' : 'none';
  document.getElementById('form-area-maint').style.display = type === 'maintenance' ? 'block' : 'none';
}

function calcVehFuel() {
  const liters = pf(document.getElementById('vr-liters').value);
  const price = pf(document.getElementById('vr-price').value);
  const discount = pf(document.getElementById('vr-discount').value);
  const before = Math.round(liters * price);
  const final = Math.round(Math.max(0, before - discount));
  document.getElementById('vr-before-total').textContent = fmt(before);
  document.getElementById('vr-final-total').textContent = fmt(final);
}

function confirmAddVehRec() {
  const checkImg = document.getElementById('veh-save-img');
  const checkBtn = document.getElementById('veh-save-btn');
  if (checkBtn.disabled) return;

  if (!S.selVehicleId) { toast('請先選擇車輛'); return; }

  let amount = 0;
  if (S.addVehRecType === 'fuel') {
    amount = pf(document.getElementById('vr-final-total').textContent.replace(/,/g,''));
    if (amount <= 0) { toast('金額不能為 0'); return; }
  } else {
    amount = pf(document.getElementById('vm-amount').value);
    if (amount <= 0 || currentSelItems.length === 0) { toast('請選擇保養項目並輸入金額'); return; }
  }

  checkBtn.disabled = true; checkImg.src = 'images/Check2.png'; checkImg.style.transform = 'scale(1.3)'; toast('⏳ 記錄儲存中...', 3000);

  setTimeout(() => {
    checkImg.style.transform = 'scale(1)';
    const commonData = { id: editingVehRecId || newId(), vehicleId: S.selVehicleId, type: S.addVehRecType, date: document.getElementById('vr-date').value, time: document.getElementById('vr-time').value, amount: amount };
    let specificData = {};
    if (S.addVehRecType === 'fuel') {
      specificData = { fuelType: document.getElementById('vr-fuel-type').value, discount: pf(document.getElementById('vr-discount').value), prevKm: pf(document.getElementById('vr-prev-km').value), km: pf(document.getElementById('vr-curr-km').value), liters: pf(document.getElementById('vr-liters').value), price: pf(document.getElementById('vr-price').value) };
    } else {
      const shop = document.getElementById('vm-shop').value.trim();
      if (shop && !S.settings.shopHistory.includes(shop)) { S.settings.shopHistory.push(shop); saveSettings(); }
      specificData = { km: pf(document.getElementById('vm-km').value), items: currentSelItems, shop: shop, payMethod: document.getElementById('vm-pay-method').value, note: document.getElementById('vm-note').value };
    }

    const finalRec = { ...commonData, ...specificData };
    if (editingVehRecId) { const idx = S.vehicleRecs.findIndex(r => r.id === editingVehRecId); if (idx >= 0) S.vehicleRecs[idx] = finalRec; toast('✅ 記錄已更新'); } 
    else { S.vehicleRecs.push(finalRec); toast('✅ 記錄已新增'); }

    editingVehRecId = null; saveVehicleRecs(); checkImg.src = 'images/Check1.png'; checkBtn.disabled = false; closeOverlay('veh-rec-add-page'); renderVehicles();
  }, 3000);
}

async function deleteVehRecFromEdit() {
  const ok = await customConfirm('確定刪除此記錄嗎？<br><strong>此動作無法復原。</strong>');
  if(!ok) return;
  S.vehicleRecs = S.vehicleRecs.filter(r => r.id !== editingVehRecId); saveVehicleRecs(); closeOverlay('veh-rec-add-page'); toast('✅ 記錄已刪除'); renderVehicles();
}

function openAddVehicle() {
  S.newVehIcon = 4; S.newVehColor = '#555555';
  const container = document.getElementById('vehicle-add-body');
  let iconsHtml = '<div class="veh-icon-grid">';
  for (let i = 4; i <= 14; i++) {
    iconsHtml += `<div id="veh-icon-box-${i}" onclick="selectNewVehIcon(${i})" class="veh-icon-box"><div id="veh-icon-mask-${i}" class="scooter-mask" style="background-color:#ccc; -webkit-mask-image: url('images/scooter${i}.png');"></div></div>`;
  }
  iconsHtml += '</div>';

  container.innerHTML = `
    <div class="fg" style="margin-bottom:14px"><label>車輛名稱</label><input type="text" class="finp" id="v-name" placeholder="例如：我的愛車 Gogoro"></div>
    <div class="fg" style="margin-bottom:14px"><label>自訂圖示顏色</label>
      <div style="display:flex;gap:8px"><input type="color" id="v-color" value="${S.newVehColor}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px"><input type="text" class="finp" value="${S.newVehColor}" readonly style="flex:1"></div>
    </div>
    <div class="fg" style="margin-bottom:14px"><label>選擇機車圖示</label>${iconsHtml}</div>
    <div class="fg" style="margin-bottom:20px"><label>預設燃料</label><select class="fsel" id="v-fuel"><option value="92" selected>92 無鉛汽油</option><option value="95">95 無鉛汽油</option><option value="98">98 無鉛汽油</option><option value="electric">電力 (電動車)</option></select></div>
    <div style="display:flex;gap:10px;"><button onclick="closeOverlay('vehicle-add-page')" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-weight:600;cursor:pointer;">取消</button><button onclick="saveNewVehicle()" class="btn-acc" style="flex:2;padding:12px;font-weight:700;border-radius:var(--rs)">確認新增</button></div>
  `;
  document.getElementById('v-color').addEventListener('input', (e) => { S.newVehColor = e.target.value; updateVehIconUI(); });
  updateVehIconUI(); openOverlay('vehicle-add-page');
}

function selectNewVehIcon(id) { S.newVehIcon = id; updateVehIconUI(); }
function updateVehIconUI() {
  for (let i = 4; i <= 14; i++) {
    const box = document.getElementById(`veh-icon-box-${i}`); const mask = document.getElementById(`veh-icon-mask-${i}`);
    if (!box || !mask) continue;
    if (i === S.newVehIcon) { box.style.borderColor = 'var(--acc)'; mask.style.backgroundColor = S.newVehColor; } 
    else { box.style.borderColor = 'transparent'; mask.style.backgroundColor = '#ccc'; }
  }
}
function saveNewVehicle() {
  const name = document.getElementById('v-name').value.trim(); if (!name) { toast('請輸入車輛名稱'); return; }
  const fuel = document.getElementById('v-fuel').value;
  S.vehicles.push({ id: newId(), name: name, icon: S.newVehIcon, color: S.newVehColor, defaultFuel: fuel });
  saveVehicles(); closeOverlay('vehicle-add-page'); toast('✅ 成功新增車輛！'); renderVehicles();
}

const MAINT_ITEMS = ['機油', '齒輪油', '空濾', '前輪', '後輪', '煞車油', '前煞車皮', '後煞車皮', '皮帶', '傳動保養', '大保養'];
let currentSelItems = [];
function toggleMaintItem(el, item) { el.classList.toggle('on'); if (currentSelItems.includes(item)) { currentSelItems = currentSelItems.filter(i => i !== item); } else { currentSelItems.push(item); } }
function renderShopHistory() {
  if (!S.settings.shopHistory) S.settings.shopHistory = [];
  document.getElementById('shop-history-container').innerHTML = S.settings.shopHistory.map((shop, i) => `<div class="shop-chip"><span onclick="document.getElementById('vm-shop').value='${shop}'">${shop}</span><span class="shop-chip-del" onclick="deleteShopHistory(${i})">✕</span></div>`).join('');
}
function deleteShopHistory(index) { S.settings.shopHistory.splice(index, 1); saveSettings(); renderShopHistory(); }

/* ══════════════════════════════════════════════════════
   設定頁與資料管理
   ══════════════════════════════════════════════════════ */
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
      <div class="set-row" onclick="doReset()"><span class="sn" style="color:var(--red)">⚠️ 清除所有資料</span><span class="arr" style="color:var(--red)">!</span></div>
  </div></div>`;
  document.getElementById('settings-content').innerHTML = html;
}

function openPlatformList() {
  document.getElementById('sub-title').textContent = '平台列表'; document.getElementById('sub-add-btn').style.display = 'none';
  document.getElementById('sub-body').innerHTML = `<div class="set-list">${S.platforms.map(p=>`<div class="set-row" onclick="openPlatformEdit('${p.id}')"><div class="plat-color-dot" style="background:${p.color}"></div><div class="sn"><div style="font-weight:600">${p.name}</div><div class="sn-sub">${p.active?'✅ 已啟用':'⭕ 已停用'}</div></div><span class="arr">›</span></div>`).join('')}</div><div style="margin-top:12px; font-size:11px; color:var(--t3); text-align:center;">💡 點擊平台可自訂顏色與啟用狀態</div>`;
  openOverlay('sub-page');
}
function openPlatformEdit(id) {
  const p = S.platforms.find(x=>x.id===id); if (!p) return;
  document.getElementById('sub-title').textContent = p.name; 
  document.getElementById('sub-body').innerHTML = `
    <div style="margin-bottom:16px; padding:12px; background:var(--sf2); border-radius:var(--rs); font-size:12px; color:var(--t2); line-height:1.6;"><strong>📝 結算與發薪規則：</strong><br>${p.ruleDesc ? p.ruleDesc.replace(/｜/g, '<br>') : ''}</div>
    <div class="fg" style="margin-bottom:16px"><label>自訂平台顏色</label><div style="display:flex;gap:8px"><input type="color" id="sp-color-pick" value="${p.color}" style="width:44px;height:40px;border-radius:var(--rs);border:1px solid var(--border);cursor:pointer;padding:2px"><input type="text" class="finp" id="sp-color" value="${p.color}" style="flex:1"></div></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding:12px;background:var(--sf2);border-radius:var(--rs)"><label style="font-size:14px;font-weight:600;flex:1;cursor:pointer" for="sp-active">啟用此平台</label><input type="checkbox" id="sp-active" ${p.active?'checked':''} style="width:20px;height:20px;cursor:pointer"></div>
    <div style="display:flex;gap:8px"><button onclick="openPlatformList()" style="flex:1;padding:12px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-size:14px;font-weight:600;cursor:pointer;">返回列表</button><button onclick="savePlatformEdit('${id}')" class="btn-acc" style="flex:2;padding:12px;font-size:14px;font-weight:700;border-radius:var(--rs)">儲存設定</button></div>`;
  document.getElementById('sp-color-pick').addEventListener('input', e => { document.getElementById('sp-color').value = e.target.value; });
}
function savePlatformEdit(id) {
  const p = S.platforms.find(x=>x.id===id); if (!p) return;
  p.color = document.getElementById('sp-color').value.trim() || p.color; p.active = document.getElementById('sp-active').checked;
  savePlatforms(); toast('✅ 平台已更新'); if (S.tab === 'home') renderHome(); renderSettings(); openPlatformList();
}
function openGoalSettings() {
  document.getElementById('sub-title').textContent = '目標設定'; document.getElementById('sub-add-btn').style.display = 'none'; const g = S.settings.goals||{};
  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>📅 週目標（NT$）</label><input type="number" class="finp" id="g-weekly" value="${g.weekly||0}" inputmode="decimal"></div>
    <div class="fg" style="margin-bottom:14px"><label>📆 月目標（NT$）</label><input type="number" class="finp" id="g-monthly" value="${g.monthly||0}" inputmode="decimal"></div>
    <button onclick="saveGoals()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">儲存目標</button>`;
  openOverlay('sub-page');
}
function saveGoals() { S.settings.goals = { weekly: pf(document.getElementById('g-weekly').value), monthly: pf(document.getElementById('g-monthly').value) }; saveSettings(); closeOverlay('sub-page'); renderSettings(); toast('✅ 目標已儲存'); }
function openAddReward() {
  document.getElementById('sub-title').textContent = '新增獎勵項目'; document.getElementById('sub-add-btn').style.display = 'none'; const platOpts = S.platforms.filter(p=>p.active).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('sub-body').innerHTML = `
    <div class="fg" style="margin-bottom:10px"><label>獎勵名稱</label><input type="text" class="finp" id="rw-name" placeholder="例：週末衝單獎勵"></div>
    <div class="fg" style="margin-bottom:10px"><label>適用平台</label><select class="fsel" id="rw-plat">${platOpts}</select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px"><div class="fg"><label>最低單數</label><input type="number" class="finp" id="rw-min" value="0" inputmode="numeric"></div><div class="fg"><label>上限單數（0=無限）</label><input type="number" class="finp" id="rw-max" value="0" inputmode="numeric"></div></div>
    <div class="fg" style="margin-bottom:14px"><label>獎勵金額（NT$）</label><input type="number" class="finp" id="rw-amt" value="0" inputmode="decimal"></div>
    <button onclick="saveNewReward()" class="btn-acc" style="width:100%;padding:12px;font-size:14px;font-weight:600;border-radius:var(--rs)">新增獎勵</button>`;
  openOverlay('sub-page');
}
function saveNewReward() {
  const name = document.getElementById('rw-name').value.trim(); if (!name) { toast('請輸入獎勵名稱'); return; }
  if (!S.settings.rewards) S.settings.rewards=[]; S.settings.rewards.push({ id: newId(), name, platformId: document.getElementById('rw-plat').value, minOrders: pf(document.getElementById('rw-min').value), maxOrders: pf(document.getElementById('rw-max').value), amount: pf(document.getElementById('rw-amt').value) });
  saveSettings(); closeOverlay('sub-page'); renderSettings(); toast('✅ 獎勵已新增');
}
async function deleteReward(i) { const ok = await customConfirm(`確定刪除「${S.settings.rewards[i]?.name}」？`); if (!ok) return; S.settings.rewards.splice(i,1); saveSettings(); renderSettings(); toast('已刪除'); }

function doBackup() {
  const data = { exportedAt:new Date().toISOString(), records:S.records, platforms:S.platforms, settings:S.settings, vehicles:S.vehicles, vehicleRecs:S.vehicleRecs };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `外送記帳_${todayStr()}.json`; a.click(); URL.revokeObjectURL(url); toast('✅ 備份完成');
}
function doRestore() {
  const fi = document.getElementById('restore-file');
  fi.onchange = async () => {
    const file = fi.files[0]; if(!file) return;
    try {
      const text = await file.text(); const data = JSON.parse(text); const ok = await customConfirm('確定用此備份<strong>覆蓋</strong>現有資料？'); if (!ok) return;
      if (data.records) { S.records=data.records; saveRecords(); } if (data.platforms) { S.platforms=data.platforms; savePlatforms(); } if (data.settings) { S.settings=data.settings; saveSettings(); }
      if (data.vehicles) { S.vehicles=data.vehicles; saveVehicles(); } if (data.vehicleRecs) { S.vehicleRecs=data.vehicleRecs; saveVehicleRecs(); }
      toast('✅ 還原成功'); renderSettings(); renderHome();
    } catch { toast('❌ 檔案格式錯誤'); }
    fi.value='';
  }; fi.click();
}
function doExportCSV() {
  const headers = ['日期','平台','接單數','行程收入','固定獎勵','臨時獎勵','小費','總收入','工時','上線','下線','備註'];
  const rows = S.records.map(r=>{ const p = getPlatform(r.platformId); return [r.date, p.name, r.orders||0, r.income||0, r.bonus||0, r.tempBonus||0, r.tips||0, recTotal(r), r.hours||0, r.punchIn||'', r.punchOut||'', r.note||''].join(','); });
  const csv = [headers.join(','), ...rows].join('\n'); const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`外送記帳_${todayStr()}.csv`; a.click(); URL.revokeObjectURL(url); toast('✅ CSV 匯出完成');
}
async function doReset() {
  const ok = await customConfirm('⚠️ 確定要<strong>清除所有記錄和設定</strong>嗎？<br>此動作無法復原！'); if (!ok) return;
  S.records=[]; S.settings={...DEFAULT_SETTINGS}; S.vehicles=[]; S.vehicleRecs=[]; saveRecords(); saveSettings(); saveVehicles(); saveVehicleRecs(); toast('已清除所有資料'); renderHome(); renderSettings();
}

/* ══════════════════════════════════════════════════════
   App 啟動初始化
   ══════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').then(r=>console.log('SW 已註冊')).catch(e=>console.log('SW 註冊失敗')); }); }

function init() {
  loadAll();
  if (!S.platforms || !S.platforms.length) { S.platforms = DEFAULT_PLATFORMS.map(p=>({...p})); savePlatforms(); }
  goPage('home');
}
init();

/* ══ 初始化結束 ══ */
